// Workflow01 — Background Service (v4.0)
//
// MODEL: every tab carries a persistent workspace label written with
// browser.sessions.setTabValue(). The label rides along with Firefox's own
// session restore, so we NEVER recreate tabs from URL lists and duplication
// is impossible. Active workspace's tabs are shown; all others are hidden.
//
// Pinned tabs are GLOBAL — never labeled, never hidden, shown everywhere.
//
// storage.local:
//   workspaceOrder  -> [name, ...]      (display order + the canonical list)
//   activeWorkspace -> name | null      (restored on startup)
// sessions (per-tab, survives restart):
//   "workspace" -> name                 (which workspace a tab belongs to)

const TAB_KEY = "workspace";

// windowId -> active workspace name (in-memory, current session)
const activeByWindow = new Map();
// Re-entrancy guard per window for structural ops.
const busyWindows = new Set();

// ---- storage.local: workspace list + active ----

async function getOrder() {
  const d = await browser.storage.local.get("workspaceOrder");
  return Array.isArray(d.workspaceOrder) ? d.workspaceOrder : [];
}
async function setOrder(order) {
  await browser.storage.local.set({ workspaceOrder: order });
}
async function addWorkspaceName(name) {
  const order = await getOrder();
  if (!order.includes(name)) { order.push(name); await setOrder(order); }
}
async function removeWorkspaceName(name) {
  const order = (await getOrder()).filter((n) => n !== name);
  await setOrder(order);
}
async function setActiveWorkspace(name) {
  await browser.storage.local.set({ activeWorkspace: name });
}
async function getActiveWorkspace() {
  const d = await browser.storage.local.get("activeWorkspace");
  return d.activeWorkspace || null;
}

// ---- per-tab label (sessions API) ----

async function getTabWorkspace(tabId) {
  try { return (await browser.sessions.getTabValue(tabId, TAB_KEY)) || null; }
  catch (e) { return null; }
}
async function setTabWorkspace(tabId, name) {
  try { await browser.sessions.setTabValue(tabId, TAB_KEY, name); } catch (e) {}
}
async function clearTabWorkspace(tabId) {
  try { await browser.sessions.removeTabValue(tabId, TAB_KEY); } catch (e) {}
}

// All non-pinned tabs in a window belonging to wsName.
async function tabsForWorkspace(windowId, wsName) {
  let tabs;
  try { tabs = await browser.tabs.query({ windowId }); }
  catch (e) { return []; }
  const out = [];
  for (const t of tabs) {
    if (t.pinned) continue;
    if ((await getTabWorkspace(t.id)) === wsName) out.push(t);
  }
  return out;
}

// ---- badge ----

function updateBadge(windowId, name) {
  if (name) {
    browser.action.setBadgeText({ text: name.substring(0, 3).toUpperCase(), windowId });
    browser.action.setBadgeBackgroundColor({ color: "#0060df", windowId });
    if (browser.action.setBadgeTextColor) browser.action.setBadgeTextColor({ color: "#ffffff", windowId });
  } else {
    browser.action.setBadgeText({ text: "", windowId });
  }
}

// ---- show / hide ----

async function showWorkspace(windowId, wsName) {
  const tabs = await tabsForWorkspace(windowId, wsName);
  if (tabs.length === 0) return null;
  const ids = tabs.map((t) => t.id);
  await browser.tabs.show(ids).catch(() => {});
  // activate the first one
  for (const id of ids) {
    try { await browser.tabs.update(id, { active: true }); return id; }
    catch (e) {}
  }
  return ids[0];
}

async function hideWorkspace(windowId, wsName) {
  const tabs = await tabsForWorkspace(windowId, wsName);
  const ids = tabs.filter((t) => !t.pinned).map((t) => t.id);
  if (ids.length) await browser.tabs.hide(ids).catch(() => {});
}

// Guarantee a workspace has at least one tab (windows can't be empty).
async function ensureTab(windowId, wsName, active) {
  const tabs = await tabsForWorkspace(windowId, wsName);
  if (tabs.length > 0) return tabs[0].id;
  const t = await browser.tabs.create({ windowId, active });
  await setTabWorkspace(t.id, wsName);
  return t.id;
}

// Hide every non-pinned visible tab in the window not owned by wsName.
// This is the single source of correctness — runs after every structural op.
async function reconcile(windowId, wsName) {
  let tabs;
  try { tabs = await browser.tabs.query({ windowId }); }
  catch (e) { return; }
  const stray = [];
  for (const t of tabs) {
    if (t.pinned || t.hidden) continue;
    if ((await getTabWorkspace(t.id)) !== wsName) stray.push(t.id);
  }
  if (stray.length) await browser.tabs.hide(stray).catch(() => {});
}

// ---- core ops ----

async function switchWorkspace(windowId, target) {
  if (busyWindows.has(windowId)) return;
  busyWindows.add(windowId);
  try {
    const current = activeByWindow.get(windowId) || null;
    if (current === target) return;

    await showWorkspace(windowId, target);
    await ensureTab(windowId, target, true);
    if (current && current !== target) await hideWorkspace(windowId, current);

    activeByWindow.set(windowId, target);
    updateBadge(windowId, target);
    await setActiveWorkspace(target);
    await reconcile(windowId, target);
  } finally {
    busyWindows.delete(windowId);
  }
}

async function createWorkspace(windowId, name) {
  if (busyWindows.has(windowId)) return { success: false };
  busyWindows.add(windowId);
  try {
    const order = await getOrder();
    if (order.includes(name)) return { success: false, reason: "exists" };
    await addWorkspaceName(name);

    const current = activeByWindow.get(windowId) || null;

    if (!current) {
      // First workspace in an unassigned window — adopt existing non-pinned tabs.
      const existing = await browser.tabs.query({ windowId });
      const ownable = existing.filter((t) => !t.pinned);
      if (ownable.length > 0) {
        for (const t of ownable) await setTabWorkspace(t.id, name);
      } else {
        const fresh = await browser.tabs.create({ windowId, active: true });
        await setTabWorkspace(fresh.id, name);
      }
    } else {
      // Split off: fresh blank tab, hide the old workspace.
      const fresh = await browser.tabs.create({ windowId, active: true });
      await setTabWorkspace(fresh.id, name);
      await hideWorkspace(windowId, current);
    }

    activeByWindow.set(windowId, name);
    updateBadge(windowId, name);
    await setActiveWorkspace(name);
    await reconcile(windowId, name);
    return { success: true };
  } finally {
    busyWindows.delete(windowId);
  }
}

async function deleteWorkspace(windowId, name) {
  if (busyWindows.has(windowId)) return { success: false };
  busyWindows.add(windowId);
  try {
    const wasActive = activeByWindow.get(windowId) === name;
    const tabs = await tabsForWorkspace(windowId, name);
    const ids = tabs.map((t) => t.id);

    await removeWorkspaceName(name);

    if (wasActive) {
      const order = await getOrder();
      const next = order[0] || null;
      if (next) {
        await showWorkspace(windowId, next);
        await ensureTab(windowId, next, true);
        activeByWindow.set(windowId, next);
        updateBadge(windowId, next);
        await setActiveWorkspace(next);
      } else {
        activeByWindow.set(windowId, null);
        updateBadge(windowId, null);
        await setActiveWorkspace(null);
      }
    }

    for (const id of ids) await clearTabWorkspace(id);
    if (ids.length) await browser.tabs.remove(ids).catch(() => {});
    if (wasActive) {
      const cur = activeByWindow.get(windowId);
      if (cur) await reconcile(windowId, cur);
    }
    return { success: true };
  } finally {
    busyWindows.delete(windowId);
  }
}

async function renameWorkspace(windowId, oldName, newName) {
  const order = await getOrder();
  if (!order.includes(oldName) || order.includes(newName)) return { success: false };
  await setOrder(order.map((n) => (n === oldName ? newName : n)));

  // Relabel every tab in this window that belonged to oldName.
  let tabs;
  try { tabs = await browser.tabs.query({ windowId }); } catch (e) { tabs = []; }
  for (const t of tabs) {
    if ((await getTabWorkspace(t.id)) === oldName) await setTabWorkspace(t.id, newName);
  }
  if (activeByWindow.get(windowId) === oldName) {
    activeByWindow.set(windowId, newName);
    updateBadge(windowId, newName);
    await setActiveWorkspace(newName);
  }
  return { success: true };
}

// Tab counts per workspace, computed from ACTUAL live tagged tabs (never drifts).
async function getCounts(windowId) {
  const order = await getOrder();
  const counts = {};
  for (const n of order) counts[n] = 0;
  let tabs;
  try { tabs = await browser.tabs.query({ windowId }); } catch (e) { tabs = []; }
  for (const t of tabs) {
    if (t.pinned) continue;
    const ws = await getTabWorkspace(t.id);
    if (ws && ws in counts) counts[ws]++;
  }
  return counts;
}

// One-time reset: clear all workspace data and labels in this window.
async function resetAll(windowId) {
  let tabs;
  try { tabs = await browser.tabs.query({ windowId }); } catch (e) { tabs = []; }
  for (const t of tabs) {
    await clearTabWorkspace(t.id);
    if (t.hidden) await browser.tabs.show(t.id).catch(() => {});
  }
  await browser.storage.local.set({ workspaceOrder: [], activeWorkspace: null });
  activeByWindow.set(windowId, null);
  updateBadge(windowId, null);
  return { success: true };
}

// ---- messages ----

browser.runtime.onMessage.addListener(async (m) => {
  switch (m.action) {
    case "switch_workspace": await switchWorkspace(m.windowId, m.workspace); return { success: true };
    case "create_workspace": return await createWorkspace(m.windowId, m.workspace);
    case "delete_workspace": return await deleteWorkspace(m.windowId, m.workspace);
    case "rename_workspace": return await renameWorkspace(m.windowId, m.oldName, m.newName);
    case "reset_all": return await resetAll(m.windowId);
    case "get_state": {
      const order = await getOrder();
      const counts = await getCounts(m.windowId);
      return { active: activeByWindow.get(m.windowId) || null, order, counts };
    }
    default: return { success: false, reason: "unknown_action" };
  }
});

// ---- tab events ----

// New tab opened by the user -> label it with the active workspace (unless pinned).
browser.tabs.onCreated.addListener(async (tab) => {
  if (busyWindows.has(tab.windowId)) return;       // internal op labels its own tabs
  if (tab.pinned) return;                           // pinned = global
  if (await getTabWorkspace(tab.id)) return;        // already labeled
  const ws = activeByWindow.get(tab.windowId);
  if (ws) await setTabWorkspace(tab.id, ws);
});

// Pin/unpin transitions.
browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.pinned === undefined) return;
  if (changeInfo.pinned) {
    await clearTabWorkspace(tabId);                 // became global
  } else {
    const ws = tab && activeByWindow.get(tab.windowId);
    if (ws) await setTabWorkspace(tabId, ws);       // joins active workspace
  }
}, { properties: ["pinned"] });

browser.windows.onRemoved.addListener((windowId) => activeByWindow.delete(windowId));

// ---- bootstrap (startup + install) ----
// We DO NOT recreate tabs. Firefox already restored them with their labels
// intact (sessions API). We just read labels and hide everything except the
// last-active workspace.

async function bootstrap() {
  activeByWindow.clear();

  let win;
  try { win = await browser.windows.getLastFocused({ windowTypes: ["normal"] }); }
  catch (e) { return; }
  const windowId = win.id;

  const order = await getOrder();
  if (order.length === 0) {
    activeByWindow.set(windowId, null);
    updateBadge(windowId, null);
    return;
  }

  const lastActive = await getActiveWorkspace();
  const target = (lastActive && order.includes(lastActive)) ? lastActive : order[0];

  // Any restored tab with no label and not pinned: it's an orphan from before
  // the extension existed, or a fresh session tab — assign it to target so it
  // isn't stranded invisible.
  let tabs;
  try { tabs = await browser.tabs.query({ windowId }); } catch (e) { tabs = []; }
  for (const t of tabs) {
    if (t.pinned) continue;
    const ws = await getTabWorkspace(t.id);
    if (!ws) await setTabWorkspace(t.id, target);
  }

  await ensureTab(windowId, target, true);
  await showWorkspace(windowId, target);

  // Hide every other workspace's tabs.
  for (const name of order) {
    if (name === target) continue;
    await hideWorkspace(windowId, name);
  }

  activeByWindow.set(windowId, target);
  updateBadge(windowId, target);
  await setActiveWorkspace(target);
  await reconcile(windowId, target);
}

browser.runtime.onStartup.addListener(bootstrap);
browser.runtime.onInstalled.addListener(bootstrap);
