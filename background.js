// Workflow01 — Background Service (v3.2)
//
// Model: every tab from every workspace lives in the same window.
// Active workspace tabs are visible; all others are hidden.
// Switching = tabs.hide(current) + tabs.show(target). Nothing reloads.
//
// Storage (survives restart):
//   workspaces     -> { name: [url, ...] }
//   workspaceOrder -> [name, ...]
//   activeWorkspace -> name | null
//
// In-memory (current session only):
//   tabWorkspace   -> Map<tabId, workspaceName>
//   activeByWindow -> Map<windowId, workspaceName>

const tabWorkspace   = new Map();
const activeByWindow = new Map();

// Blocks re-entrant structural ops per window.
const busyWindows = new Set();

// Tabs being created by internal ops. Claimed here before tabs.create()
// returns so the onCreated listener never double-assigns them.
const pendingTabIds = new Set();

// ---- Storage ----

async function getWorkspaces() {
  const data = await browser.storage.local.get(["workspaces", "workspaceOrder"]);
  const workspaces = data.workspaces || {};
  let order = data.workspaceOrder || Object.keys(workspaces);
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

// Only URLs Firefox can recreate via tabs.create() should ever be persisted.
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

// Serialized per-workspace persist queue — prevents concurrent storage
// read/write races. Queue entries clean themselves up when settled.
const persistQueue = new Map();
function persistWorkspaceUrls(wsName) {
  const prev = persistQueue.get(wsName) || Promise.resolve();
  const next = prev.then(() => _persistImpl(wsName)).catch(() => {});
  persistQueue.set(wsName, next);
  next.finally(() => { if (persistQueue.get(wsName) === next) persistQueue.delete(wsName); });
  return next;
}

async function _persistImpl(wsName) {
  const tabIds = [];
  for (const [tabId, ws] of tabWorkspace) if (ws === wsName) tabIds.push(tabId);
  const urls = [];
  for (const id of tabIds) {
    try {
      const t = await browser.tabs.get(id);
      if (isRestorableUrl(t.url)) urls.push(t.url);
    } catch (e) {
      tabWorkspace.delete(id);
    }
  }
  const { workspaces, order } = await getWorkspaces();
  if (!(wsName in workspaces) && urls.length === 0) return;
  workspaces[wsName] = urls;
  if (!order.includes(wsName)) order.push(wsName);
  await setWorkspaces(workspaces, order);
}

// ---- Badge ----

function updateBadge(windowId, workspaceName) {
  if (workspaceName) {
    browser.action.setBadgeText({ text: workspaceName.substring(0, 3).toUpperCase(), windowId });
    browser.action.setBadgeBackgroundColor({ color: "#0060df", windowId });
    if (browser.action.setBadgeTextColor) {
      browser.action.setBadgeTextColor({ color: "#ffffff", windowId });
    }
  } else {
    browser.action.setBadgeText({ text: "", windowId });
  }
}

// ---- Tab helpers ----

function tabIdsForWorkspace(wsName) {
  const ids = [];
  for (const [tabId, ws] of tabWorkspace) if (ws === wsName) ids.push(tabId);
  return ids;
}

async function liveTabIdsForWorkspace(wsName) {
  const ids = tabIdsForWorkspace(wsName);
  const alive = [];
  for (const id of ids) {
    try { await browser.tabs.get(id); alive.push(id); }
    catch (e) { tabWorkspace.delete(id); }
  }
  return alive;
}

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
    for (const id of ids) {
      try { await browser.tabs.update(id, { active: true }); return id; }
      catch (e) { tabWorkspace.delete(id); }
    }
  }
  return ids[0];
}

async function hideWorkspaceTabs(wsName) {
  const ids = tabIdsForWorkspace(wsName);
  if (ids.length === 0) return;
  await browser.tabs.hide(ids).catch(() => {});
}

// Build real tabs for a workspace from its stored URLs.
// hidden=true creates them discarded (unloaded) — they load only when visited.
async function materializeWorkspace(windowId, wsName, { hidden }) {
  const { workspaces } = await getWorkspaces();
  const urls = (workspaces[wsName] || []).filter(isRestorableUrl);

  if (urls.length === 0) {
    const t = await browser.tabs.create({ windowId, active: !hidden });
    tabWorkspace.set(t.id, wsName);
    if (hidden) await browser.tabs.hide(t.id).catch(() => {});
    return;
  }

  const created = [];
  for (let i = 0; i < urls.length; i++) {
    let t = null;
    try {
      t = await browser.tabs.create({
        windowId, url: urls[i],
        active: !hidden && i === 0,
        discarded: hidden,
        title: hidden ? urls[i] : undefined
      });
    } catch (e) {
      try {
        t = await browser.tabs.create({ windowId, url: urls[i], active: false });
        if (hidden) await browser.tabs.hide(t.id).catch(() => {});
      } catch (_) {}
    }
    if (t) {
      pendingTabIds.delete(t.id);
      tabWorkspace.set(t.id, wsName);
      created.push(t);
    }
  }
  if (hidden) await browser.tabs.hide(created.map((t) => t.id)).catch(() => {});
}

// ---- Core operations ----

async function switchWorkspace(windowId, targetWorkspace) {
  if (busyWindows.has(windowId)) return;
  busyWindows.add(windowId);
  try {
    const current = activeByWindow.get(windowId) || null;
    if (current === targetWorkspace) return;

    const liveTarget = await liveTabIdsForWorkspace(targetWorkspace);
    if (liveTarget.length === 0) {
      await materializeWorkspace(windowId, targetWorkspace, { hidden: false });
    } else {
      await showWorkspaceTabs(targetWorkspace, true);
    }

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

async function createWorkspace(windowId, newWorkspaceName) {
  if (busyWindows.has(windowId)) return { success: false };
  busyWindows.add(windowId);
  try {
    const { workspaces, order } = await getWorkspaces();
    if (newWorkspaceName in workspaces) return { success: false, reason: "exists" };

    workspaces[newWorkspaceName] = [];
    order.push(newWorkspaceName);
    await setWorkspaces(workspaces, order);

    const current = activeByWindow.get(windowId) || null;

    if (!current) {
      // First workspace in an unassigned window — adopt existing tabs.
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

    // New workspace from an existing one — open a blank tab, hide the old set.
    const fresh = await browser.tabs.create({ windowId, active: true });
    tabWorkspace.set(fresh.id, newWorkspaceName);
    await hideWorkspaceTabs(current);

    activeByWindow.set(windowId, newWorkspaceName);
    updateBadge(windowId, newWorkspaceName);
    await setActiveWorkspace(newWorkspaceName);
    return { success: true };
  } finally {
    busyWindows.delete(windowId);
  }
}

async function deleteWorkspace(windowId, wsName) {
  if (busyWindows.has(windowId)) return { success: false };
  busyWindows.add(windowId);
  try {
    const { workspaces, order } = await getWorkspaces();
    const wasActive = activeByWindow.get(windowId) === wsName;
    const ids = tabIdsForWorkspace(wsName);

    delete workspaces[wsName];
    const newOrder = order.filter((n) => n !== wsName);
    await setWorkspaces(workspaces, newOrder);

    if (wasActive) {
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

// ---- Message handler ----

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
      return { active: activeByWindow.get(message.windowId) || null, order };
    }
    default:
      return { success: false, reason: "unknown_action" };
  }
});

// ---- Tab event listeners ----

browser.tabs.onCreated.addListener((tab) => {
  // Skip tabs already owned by an internal op.
  if (tabWorkspace.has(tab.id)) return;
  if (pendingTabIds.has(tab.id)) return;
  if (busyWindows.has(tab.windowId)) return;
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

const _updateTimers = new Map();
browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "complete" && changeInfo.url === undefined) return;
  const ws = tabWorkspace.get(tabId);
  if (!ws) return;
  if (_updateTimers.has(ws)) clearTimeout(_updateTimers.get(ws));
  _updateTimers.set(ws, setTimeout(() => {
    _updateTimers.delete(ws);
    persistWorkspaceUrls(ws);
  }, 500));
});

browser.windows.onRemoved.addListener((windowId) => {
  activeByWindow.delete(windowId);
});

// ---- Bootstrap (startup + install) ----

async function bootstrap() {
  tabWorkspace.clear();
  activeByWindow.clear();

  const { workspaces, order } = await getWorkspaces();
  const data = await browser.storage.local.get("activeWorkspace");
  const lastActive = data.activeWorkspace || null;

  let win;
  try { win = await browser.windows.getLastFocused({ windowTypes: ["normal"] }); }
  catch (e) { return; }
  const windowId = win.id;

  if (order.length === 0) {
    activeByWindow.set(windowId, null);
    updateBadge(windowId, null);
    return;
  }

  const target = (lastActive && lastActive in workspaces) ? lastActive : order[0];

  // Adopt whatever Firefox session-restored into this window.
  // Storage is the source of truth — reconcile against it rather than
  // blindly trusting the restored tab set, which can be partial.
  const existingTabs = await browser.tabs.query({ windowId });
  const storedUrls = new Set(workspaces[target] || []);
  const restoredUrls = new Set();

  for (const t of existingTabs) {
    tabWorkspace.set(t.id, target);
    if (isRestorableUrl(t.url)) restoredUrls.add(t.url);
  }

  // Recreate any stored URLs that session restore missed.
  const missing = [...storedUrls].filter((u) => !restoredUrls.has(u));
  for (const url of missing) {
    try {
      const t = await browser.tabs.create({ windowId, url, active: false, discarded: true });
      tabWorkspace.set(t.id, target);
    } catch (e) {
      try {
        const t = await browser.tabs.create({ windowId, url, active: false });
        tabWorkspace.set(t.id, target);
      } catch (_) {}
    }
  }

  await ensureWorkspaceHasTab(windowId, target, true);

  // Materialize all other workspaces as hidden + discarded.
  for (const name of order) {
    if (name === target) continue;
    await materializeWorkspace(windowId, name, { hidden: true });
  }

  activeByWindow.set(windowId, target);
  updateBadge(windowId, target);
  await setActiveWorkspace(target);
  await persistWorkspaceUrls(target);
}

browser.runtime.onStartup.addListener(bootstrap);
browser.runtime.onInstalled.addListener(bootstrap);
