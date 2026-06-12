// ============================================================
// Workflow01 — Background Service (v3)
// Single-window workspace model using tabs.hide()/tabs.show().
//
// Core idea: every tab that belongs to ANY workspace lives in the
// same window. The active workspace's tabs are shown; all others are
// hidden. Switching = hide current set, show target set. Tabs are
// NEVER closed on switch, so nothing reloads and live state (scroll,
// forms, media) is preserved within a session.
//
// Persistence model:
//   storage.local.workspaces      -> { wsName: [url, ...] }   (for restart rebuild)
//   storage.local.workspaceOrder  -> [wsName, ...]            (stable display order)
//   storage.local.activeWorkspace -> wsName | null            (last active, for restart)
//
// In-memory (per session only):
//   tabWorkspace   -> Map<tabId, wsName>   live ownership of each tab
//   activeByWindow -> Map<windowId, wsName>
//
// On restart, tab IDs change, so we rebuild everything from stored
// URLs: the last-active workspace is recreated visible; all others
// are recreated hidden + discarded (exist, separated, ~0 CPU, load
// only when first visited).
// ============================================================

// tabId -> workspaceName
const tabWorkspace = new Map();
// windowId -> active workspaceName
const activeByWindow = new Map();

// Guards re-entrancy during structural operations (switch / create / restore).
// Per-window so independent windows don't block each other.
const busyWindows = new Set();

// ---- Storage helpers ----

async function getWorkspaces() {
  const data = await browser.storage.local.get(["workspaces", "workspaceOrder"]);
  const workspaces = data.workspaces || {};
  let order = data.workspaceOrder || Object.keys(workspaces);
  // Reconcile: drop stale, append missing.
  order = order.filter((n) => n in workspaces);
  for (const n of Object.keys(workspaces)) if (!order.includes(n)) order.push(n);
  return { workspaces, order };
}

async function setWorkspaces(workspaces, order) {
  await browser.storage.local.set({ workspaces, workspaceOrder: order });
}

async function setActiveWorkspace(name) {
  await browser.storage.local.set({ activeWorkspace: name });
}

// A URL is restorable only if Firefox can recreate it with tabs.create().
// Privileged pages (about:*, moz-extension://, view-source:, etc.) cannot be
// recreated and must never be persisted, or restart rebuild throws/silently
// opens blank tabs.
function isRestorableUrl(url) {
  if (!url) return false;
  return !(
    url.startsWith("about:") ||
    url.startsWith("moz-extension://") ||
    url.startsWith("chrome:") ||
    url.startsWith("resource:") ||
    url.startsWith("view-source:") ||
    url.startsWith("javascript:") ||
    url.startsWith("data:")
  );
}

// Serialize persistence per workspace so concurrent tab events don't clobber
// each other (read-modify-write race on storage.local). Queue entries are
// cleaned up once their chain settles so the map doesn't grow unbounded.
const persistQueue = new Map(); // wsName -> Promise chain
function persistWorkspaceUrls(wsName) {
  const prev = persistQueue.get(wsName) || Promise.resolve();
  const next = prev.then(() => persistWorkspaceUrlsImpl(wsName)).catch(() => {});
  persistQueue.set(wsName, next);
  next.finally(() => {
    // Only delete if no newer call has replaced this chain.
    if (persistQueue.get(wsName) === next) persistQueue.delete(wsName);
  });
  return next;
}

async function persistWorkspaceUrlsImpl(wsName) {
  const tabIds = [];
  for (const [tabId, ws] of tabWorkspace) if (ws === wsName) tabIds.push(tabId);

  const urls = [];
  for (const id of tabIds) {
    try {
      const t = await browser.tabs.get(id);
      if (isRestorableUrl(t.url)) urls.push(t.url);
    } catch (e) {
      tabWorkspace.delete(id); // tab gone
    }
  }
  const { workspaces, order } = await getWorkspaces();
  // Don't clobber a workspace that was deleted mid-flight.
  if (!(wsName in workspaces) && urls.length === 0) return;
  workspaces[wsName] = urls;
  if (!order.includes(wsName)) order.push(wsName);
  await setWorkspaces(workspaces, order);
}

// ---- Badge ----

function updateBadge(windowId, workspaceName) {
  if (workspaceName) {
    // Show first 3 chars uppercase. setBadgeTextColor ensures white text on
    // both light and dark toolbars regardless of Firefox's auto-contrast logic.
    browser.action.setBadgeText({ text: workspaceName.substring(0, 3).toUpperCase(), windowId });
    browser.action.setBadgeBackgroundColor({ color: "#0060df", windowId });
    // Force white text — without this Firefox may pick dark text on light themes
    // making the badge hard to read.
    if (browser.action.setBadgeTextColor) {
      browser.action.setBadgeTextColor({ color: "#ffffff", windowId });
    }
  } else {
    browser.action.setBadgeText({ text: "", windowId });
  }
}

// ---- Tab set helpers ----

function tabIdsForWorkspace(wsName) {
  const ids = [];
  for (const [tabId, ws] of tabWorkspace) if (ws === wsName) ids.push(tabId);
  return ids;
}

// Validate that the live tab IDs we think belong to a workspace still exist
// (they can vanish if the user closed them while the workspace was hidden, or
// after a race). Returns the surviving IDs and prunes dead ones from the map.
async function liveTabIdsForWorkspace(wsName) {
  const ids = tabIdsForWorkspace(wsName);
  const alive = [];
  for (const id of ids) {
    try {
      await browser.tabs.get(id);
      alive.push(id);
    } catch (e) {
      tabWorkspace.delete(id);
    }
  }
  return alive;
}

// A window can never have zero visible tabs. If a workspace's live set is empty
// (everything was closed), give it one fresh blank tab so switching to it always
// leaves a valid active tab.
async function ensureWorkspaceHasTab(windowId, wsName, active) {
  const alive = await liveTabIdsForWorkspace(wsName);
  if (alive.length > 0) return alive[0];
  const t = await browser.tabs.create({ windowId, active });
  tabWorkspace.set(t.id, wsName);
  await persistWorkspaceUrls(wsName);
  return t.id;
}

async function showWorkspaceTabs(wsName, activate = true) {
  const ids = tabIdsForWorkspace(wsName);
  if (ids.length === 0) return null;
  await browser.tabs.show(ids).catch(() => {});
  if (activate) {
    // Activate the first still-existing tab of the set.
    for (const id of ids) {
      try {
        await browser.tabs.update(id, { active: true });
        return id;
      } catch (e) {
        tabWorkspace.delete(id);
      }
    }
  }
  return ids[0];
}

async function hideWorkspaceTabs(wsName) {
  const ids = tabIdsForWorkspace(wsName);
  if (ids.length === 0) return;
  // Can't hide the active tab; activation is handled before this is called.
  await browser.tabs.hide(ids).catch(() => {});
}

// ---- Core: switch ----

async function switchWorkspace(windowId, targetWorkspace) {
  if (busyWindows.has(windowId)) return;
  busyWindows.add(windowId);
  try {
    const current = activeByWindow.get(windowId) || null;
    if (current === targetWorkspace) return;

    // Materialize target from storage if it has no live tabs yet (lazy restore).
    const liveTarget = await liveTabIdsForWorkspace(targetWorkspace);
    if (liveTarget.length === 0) {
      await materializeWorkspace(windowId, targetWorkspace, { hidden: false });
    } else {
      await showWorkspaceTabs(targetWorkspace, true);
    }
    // Guarantee at least one tab exists and is active for the target.
    await ensureWorkspaceHasTab(windowId, targetWorkspace, true);

    // Hide the previous workspace's tabs (after target is active).
    if (current && current !== targetWorkspace) {
      await hideWorkspaceTabs(current);
    }

    activeByWindow.set(windowId, targetWorkspace);
    updateBadge(windowId, targetWorkspace);
    await setActiveWorkspace(targetWorkspace);
  } finally {
    busyWindows.delete(windowId);
  }
}

// Create real tabs for a workspace from its stored URLs.
// hidden=true => tabs are created discarded + hidden (lazy, ~0 CPU).
async function materializeWorkspace(windowId, wsName, { hidden }) {
  const { workspaces } = await getWorkspaces();
  // Filter out any privileged URLs that may exist in legacy (v3.0) stored data.
  const urls = (workspaces[wsName] || []).filter(isRestorableUrl);

  if (urls.length === 0) {
    // Empty workspace -> one blank tab so the set is never empty.
    const t = await browser.tabs.create({ windowId, active: !hidden });
    tabWorkspace.set(t.id, wsName);
    if (hidden) await browser.tabs.hide(t.id).catch(() => {});
    return;
  }

  const created = [];
  for (let i = 0; i < urls.length; i++) {
    try {
      const t = await browser.tabs.create({
        windowId,
        url: urls[i],
        active: !hidden && i === 0,
        discarded: hidden,          // lazy: don't load until shown/visited
        title: hidden ? urls[i] : undefined
      });
      tabWorkspace.set(t.id, wsName);
      created.push(t);
    } catch (e) {
      // discarded+title combo can be rejected for some URLs; retry plain.
      try {
        const t = await browser.tabs.create({ windowId, url: urls[i], active: false });
        tabWorkspace.set(t.id, wsName);
        if (hidden) await browser.tabs.hide(t.id).catch(() => {});
        created.push(t);
      } catch (_) { /* skip unrestorable url */ }
    }
  }
  if (hidden) {
    await browser.tabs.hide(created.map((t) => t.id)).catch(() => {});
  }
}

// ---- Core: create new workspace (fresh blank tab, steals nothing) ----

async function createWorkspace(windowId, newWorkspaceName) {
  if (busyWindows.has(windowId)) return { success: false };
  busyWindows.add(windowId);
  try {
    const { workspaces, order } = await getWorkspaces();
    if (newWorkspaceName in workspaces) return { success: false, reason: "exists" };

    // Register empty workspace.
    workspaces[newWorkspaceName] = [];
    order.push(newWorkspaceName);
    await setWorkspaces(workspaces, order);

    const current = activeByWindow.get(windowId) || null;

    if (!current) {
      // FIRST workspace in an unassigned window: adopt the tabs already open
      // here so the user doesn't lose what they had. (Rule #4's "fresh blank
      // tab" applies when splitting off from an EXISTING workspace, below.)
      const existing = await browser.tabs.query({ windowId });
      if (existing.length > 0) {
        for (const t of existing) tabWorkspace.set(t.id, newWorkspaceName);
      } else {
        const fresh = await browser.tabs.create({ windowId, active: true });
        tabWorkspace.set(fresh.id, newWorkspaceName);
      }
      activeByWindow.set(windowId, newWorkspaceName);
      updateBadge(windowId, newWorkspaceName);
      await setActiveWorkspace(newWorkspaceName);
      await persistWorkspaceUrls(newWorkspaceName);
      return { success: true };
    }

    // Splitting off a NEW workspace while inside an existing one:
    // brand-new blank tab owned by the new workspace; steal nothing.
    const fresh = await browser.tabs.create({ windowId, active: true });
    tabWorkspace.set(fresh.id, newWorkspaceName);

    // Hide the previous workspace's tabs — untouched, just hidden.
    await hideWorkspaceTabs(current);

    activeByWindow.set(windowId, newWorkspaceName);
    updateBadge(windowId, newWorkspaceName);
    await setActiveWorkspace(newWorkspaceName);
    return { success: true };
  } finally {
    busyWindows.delete(windowId);
  }
}

// ---- Delete workspace ----

async function deleteWorkspace(windowId, wsName) {
  if (busyWindows.has(windowId)) return { success: false };
  busyWindows.add(windowId);
  try {
    const { workspaces, order } = await getWorkspaces();
    const wasActive = activeByWindow.get(windowId) === wsName;

    // Close that workspace's live tabs.
    const ids = tabIdsForWorkspace(wsName);

    delete workspaces[wsName];
    const newOrder = order.filter((n) => n !== wsName);
    await setWorkspaces(workspaces, newOrder);

    if (wasActive) {
      // Move to another workspace if one exists, else unassign.
      const next = newOrder[0] || null;
      if (next) {
        if (tabIdsForWorkspace(next).length === 0) {
          await materializeWorkspace(windowId, next, { hidden: false });
        } else {
          await showWorkspaceTabs(next, true);
        }
        activeByWindow.set(windowId, next);
        updateBadge(windowId, next);
        await setActiveWorkspace(next);
      } else {
        activeByWindow.set(windowId, null);
        updateBadge(windowId, null);
        await setActiveWorkspace(null);
      }
    }

    for (const id of ids) tabWorkspace.delete(id);
    if (ids.length > 0) await browser.tabs.remove(ids).catch(() => {});
    return { success: true };
  } finally {
    busyWindows.delete(windowId);
  }
}

// ---- Rename workspace ----

async function renameWorkspace(windowId, oldName, newName) {
  const { workspaces, order } = await getWorkspaces();
  if (!(oldName in workspaces) || newName in workspaces) return { success: false };
  workspaces[newName] = workspaces[oldName];
  delete workspaces[oldName];
  const newOrder = order.map((n) => (n === oldName ? newName : n));
  await setWorkspaces(workspaces, newOrder);

  for (const [tabId, ws] of tabWorkspace) if (ws === oldName) tabWorkspace.set(tabId, newName);
  if (activeByWindow.get(windowId) === oldName) {
    activeByWindow.set(windowId, newName);
    updateBadge(windowId, newName);
    await setActiveWorkspace(newName);
  }
  return { success: true };
}

// ---- Messages ----

browser.runtime.onMessage.addListener(async (message) => {
  switch (message.action) {
    case "switch_workspace":
      await switchWorkspace(message.windowId, message.workspace);
      return { success: true };
    case "create_workspace":
      return await createWorkspace(message.windowId, message.workspace);
    case "delete_workspace":
      return await deleteWorkspace(message.windowId, message.workspace);
    case "rename_workspace":
      return await renameWorkspace(message.windowId, message.oldName, message.newName);
    case "get_state": {
      const { order } = await getWorkspaces();
      return {
        active: activeByWindow.get(message.windowId) || null,
        order
      };
    }
    default:
      return { success: false, reason: "unknown_action" };
  }
});

// ---- Live tracking: keep stored URLs current for restart rebuilds ----

browser.tabs.onCreated.addListener((tab) => {
  // During switch/create/restore we assign ownership explicitly; don't race it.
  if (busyWindows.has(tab.windowId)) return;
  if (tabWorkspace.has(tab.id)) return;
  const ws = activeByWindow.get(tab.windowId);
  if (ws) {
    tabWorkspace.set(tab.id, ws);
    persistWorkspaceUrls(ws);
  }
});

browser.tabs.onRemoved.addListener((tabId, removeInfo) => {
  const ws = tabWorkspace.get(tabId);
  tabWorkspace.delete(tabId);
  if (ws && !removeInfo.isWindowClosing) persistWorkspaceUrls(ws);
});

browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "complete" && changeInfo.url === undefined) return;
  const ws = tabWorkspace.get(tabId);
  if (ws) persistWorkspaceUrls(ws);
});

// If a tab is detached/moved between windows we keep its ownership; the
// single-window model means this is an edge case we tolerate rather than support.

// ---- Window lifecycle ----

browser.windows.onRemoved.addListener((windowId) => {
  activeByWindow.delete(windowId);
});

// ---- Restart / install bootstrap ----

async function bootstrap() {
  tabWorkspace.clear();
  activeByWindow.clear();

  const { workspaces, order } = await getWorkspaces();
  const data = await browser.storage.local.get("activeWorkspace");
  const lastActive = data.activeWorkspace || null;

  // Operate on the current (last-focused) normal window.
  let win;
  try {
    win = await browser.windows.getLastFocused({ windowTypes: ["normal"] });
  } catch (e) {
    return;
  }
  const windowId = win.id;

  if (order.length === 0) {
    activeByWindow.set(windowId, null);
    updateBadge(windowId, null);
    return;
  }

  const target = (lastActive && lastActive in workspaces) ? lastActive : order[0];

  // Firefox has already restored some set of tabs into this window. We treat
  // STORAGE as the source of truth for what belongs to the target workspace,
  // not the restored tab set (session restore can be partial, or include tabs
  // from a session when the extension was disabled). We adopt restored tabs
  // into target for display, but we do NOT let an incomplete restore shrink
  // target's stored URL list — that would be permanent data loss.
  const existingTabs = await browser.tabs.query({ windowId });
  const storedTargetUrls = new Set(workspaces[target] || []);
  const restoredUrls = new Set();

  for (const t of existingTabs) {
    tabWorkspace.set(t.id, target);
    if (isRestorableUrl(t.url)) restoredUrls.add(t.url);
  }

  // If the restore is missing URLs that storage says belong to target, recreate
  // those as hidden+discarded so nothing is lost. If restore has EXTRA urls not
  // in storage, keep them (user may have added tabs just before quitting) — we
  // union rather than trust either side blindly.
  const missingTargetUrls = [...storedTargetUrls].filter((u) => !restoredUrls.has(u));
  for (const url of missingTargetUrls) {
    try {
      const t = await browser.tabs.create({ windowId, url, active: false, discarded: true });
      tabWorkspace.set(t.id, target);
    } catch (e) {
      try {
        const t = await browser.tabs.create({ windowId, url, active: false });
        tabWorkspace.set(t.id, target);
      } catch (_) { /* unrestorable, skip */ }
    }
  }

  // Ensure target has at least one tab.
  await ensureWorkspaceHasTab(windowId, target, true);

  // Materialize every OTHER workspace as hidden + discarded.
  for (const name of order) {
    if (name === target) continue;
    await materializeWorkspace(windowId, name, { hidden: true });
  }

  activeByWindow.set(windowId, target);
  updateBadge(windowId, target);
  await setActiveWorkspace(target);
  // Persist the union (restored + recreated) so storage reflects reality, but
  // only AFTER we've recreated missing tabs — so we never write a shrunk list.
  await persistWorkspaceUrls(target);
}

browser.runtime.onStartup.addListener(bootstrap);
browser.runtime.onInstalled.addListener(bootstrap);
