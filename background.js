// Workflow01 — Background Service (v5.2)
// Firefox owns tab lifetime. Workflow01 owns only workspace labels and visibility.
// Switching workspaces never closes, recreates, discards, or intentionally reloads tabs.

const TAB_KEY = "workflow01.workspaceId";
const LEGACY_TAB_KEY = "workspace";
const SCHEMA_VERSION = 5;
const activeByWindow = new Map();
const busyWindows = new Set();

const now = () => Date.now();
const cleanName = (name) => String(name || "").trim();

function newId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") return `ws_${globalThis.crypto.randomUUID()}`;
  return `ws_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function emptyState() {
  return { schemaVersion: SCHEMA_VERSION, workspaces: {}, workspaceOrder: [], activeWorkspaceId: null };
}

async function saveState(state) {
  await browser.storage.local.set({
    schemaVersion: SCHEMA_VERSION,
    workspaces: state.workspaces,
    workspaceOrder: state.workspaceOrder,
    activeWorkspaceId: state.activeWorkspaceId || null,
  });
}

async function loadState() {
  const data = await browser.storage.local.get(null);

  if (data.workspaces && typeof data.workspaces === "object" && Array.isArray(data.workspaceOrder)) {
    const state = {
      schemaVersion: SCHEMA_VERSION,
      workspaces: data.workspaces,
      workspaceOrder: data.workspaceOrder.filter((id) => data.workspaces[id]),
      activeWorkspaceId: data.activeWorkspaceId || null,
    };
    if (state.activeWorkspaceId && !state.workspaces[state.activeWorkspaceId]) state.activeWorkspaceId = state.workspaceOrder[0] || null;
    return state;
  }

  if (Array.isArray(data.workspaceOrder)) {
    const state = emptyState();
    const map = {};
    for (const oldName of data.workspaceOrder) {
      const name = cleanName(oldName);
      if (!name || map[name]) continue;
      const id = newId();
      map[name] = id;
      state.workspaces[id] = { id, name, createdAt: now(), updatedAt: now() };
      state.workspaceOrder.push(id);
    }
    const oldActive = cleanName(data.activeWorkspace);
    state.activeWorkspaceId = oldActive && map[oldActive] ? map[oldActive] : (state.workspaceOrder[0] || null);
    await saveState(state);
    await browser.storage.local.set({ legacyWorkspaceNameToId: map });
    return state;
  }

  const state = emptyState();
  await saveState(state);
  return state;
}

async function workspaceIdByName(name) {
  const state = await loadState();
  const target = cleanName(name);
  for (const id of state.workspaceOrder) if (state.workspaces[id]?.name === target) return id;
  return null;
}

async function getTabWorkspaceId(tabId) {
  try {
    const id = await browser.sessions.getTabValue(tabId, TAB_KEY);
    if (id) return id;
  } catch (_) {}

  try {
    const legacyName = await browser.sessions.getTabValue(tabId, LEGACY_TAB_KEY);
    if (!legacyName) return null;
    const id = await workspaceIdByName(legacyName);
    if (id) {
      await setTabWorkspaceId(tabId, id);
      return id;
    }
  } catch (_) {}

  return null;
}

async function setTabWorkspaceId(tabId, workspaceId) {
  try { await browser.sessions.setTabValue(tabId, TAB_KEY, workspaceId); } catch (_) {}
}

async function clearTabWorkspaceId(tabId) {
  try { await browser.sessions.removeTabValue(tabId, TAB_KEY); } catch (_) {}
  try { await browser.sessions.removeTabValue(tabId, LEGACY_TAB_KEY); } catch (_) {}
}

async function tabs(query) { try { return await browser.tabs.query(query); } catch (_) { return []; } }
async function normalWindows() { try { return await browser.windows.getAll({ windowTypes: ["normal"] }); } catch (_) { return []; } }
function ownable(tab) { return tab && tab.id !== undefined && !tab.pinned; }

async function activeId() { return (await loadState()).activeWorkspaceId || null; }
async function setActiveId(id) {
  const state = await loadState();
  state.activeWorkspaceId = id && state.workspaces[id] ? id : null;
  await saveState(state);
  return state.activeWorkspaceId;
}

async function updateBadge(windowId, id) {
  const state = await loadState();
  const ws = id ? state.workspaces[id] : null;
  if (!ws) { await browser.action.setBadgeText({ text: "", windowId }).catch(() => {}); return; }
  await browser.action.setBadgeText({ text: ws.name.slice(0,3).toUpperCase(), windowId }).catch(() => {});
  await browser.action.setBadgeBackgroundColor({ color: "#0060df", windowId }).catch(() => {});
  if (browser.action.setBadgeTextColor) await browser.action.setBadgeTextColor({ color: "#ffffff", windowId }).catch(() => {});
}

async function activeForWindow(windowId) {
  if (activeByWindow.has(windowId)) return activeByWindow.get(windowId) || null;
  const id = await activeId();
  activeByWindow.set(windowId, id);
  await updateBadge(windowId, id);
  return id;
}

async function setActiveForWindow(windowId, id) {
  const active = await setActiveId(id);
  activeByWindow.set(windowId, active);
  await updateBadge(windowId, active);
  return active;
}

async function withBusy(windowId, fn) {
  if (busyWindows.has(windowId)) return { success: false, reason: "busy" };
  busyWindows.add(windowId);
  try { return await fn(); } finally { busyWindows.delete(windowId); }
}

async function tabsForWorkspace(windowId, id) {
  const out = [];
  for (const tab of await tabs({ windowId })) if (ownable(tab) && (await getTabWorkspaceId(tab.id)) === id) out.push(tab);
  return out;
}

async function showWorkspace(windowId, id) {
  const owned = await tabsForWorkspace(windowId, id);
  const ids = owned.map((tab) => tab.id);
  if (ids.length) await browser.tabs.show(ids).catch(() => {});
  return owned;
}

async function ensureWorkspaceTab(windowId, id) {
  const owned = await tabsForWorkspace(windowId, id);
  if (owned.length) return owned[0].id;
  await setActiveForWindow(windowId, id);
  const tab = await browser.tabs.create({ windowId, active: true });
  await setTabWorkspaceId(tab.id, id);
  return tab.id;
}

async function activateWorkspaceTab(windowId, id) {
  const owned = await tabsForWorkspace(windowId, id);
  const tab = owned.find((candidate) => !candidate.hidden) || owned[0];
  if (!tab) return null;
  await browser.tabs.show(tab.id).catch(() => {});
  await browser.tabs.update(tab.id, { active: true }).catch(() => {});
  return tab.id;
}

async function hideOtherKnownTabs(windowId, activeWorkspaceId) {
  const state = await loadState();
  const known = new Set(state.workspaceOrder);
  const toHide = [];
  for (const tab of await tabs({ windowId })) {
    if (!ownable(tab) || tab.hidden) continue;
    const owner = await getTabWorkspaceId(tab.id);
    if (owner && owner !== activeWorkspaceId && known.has(owner)) toHide.push(tab.id);
  }
  if (toHide.length) await browser.tabs.hide(toHide).catch(() => {});
}

async function createWorkspace(windowId, name) {
  return await withBusy(windowId, async () => {
    const workspaceName = cleanName(name);
    if (!workspaceName) return { success: false, reason: "empty" };
    const state = await loadState();
    for (const id of state.workspaceOrder) if (state.workspaces[id]?.name === workspaceName) return { success: false, reason: "exists" };

    const id = newId();
    const isFirst = state.workspaceOrder.length === 0;
    state.workspaces[id] = { id, name: workspaceName, createdAt: now(), updatedAt: now() };
    state.workspaceOrder.push(id);
    state.activeWorkspaceId = id;
    await saveState(state);
    await setActiveForWindow(windowId, id);

    if (isFirst) {
      const visible = (await tabs({ windowId })).filter((tab) => ownable(tab) && !tab.hidden);
      if (visible.length) for (const tab of visible) await setTabWorkspaceId(tab.id, id);
      else await ensureWorkspaceTab(windowId, id);
    } else {
      const tab = await browser.tabs.create({ windowId, active: true });
      await setTabWorkspaceId(tab.id, id);
      await browser.tabs.show(tab.id).catch(() => {});
    }
    await hideOtherKnownTabs(windowId, id);
    return { success: true };
  });
}

async function switchWorkspace(windowId, name) {
  return await withBusy(windowId, async () => {
    const id = await workspaceIdByName(name);
    if (!id) return { success: false, reason: "missing" };
    await setActiveForWindow(windowId, id);
    await showWorkspace(windowId, id);
    await ensureWorkspaceTab(windowId, id);
    await activateWorkspaceTab(windowId, id);
    await hideOtherKnownTabs(windowId, id);
    return { success: true };
  });
}

async function deleteWorkspace(windowId, name) {
  return await withBusy(windowId, async () => {
    const id = await workspaceIdByName(name);
    if (!id) return { success: false, reason: "missing" };
    const state = await loadState();
    const ownedTabs = await tabsForWorkspace(windowId, id);
    const tabIds = ownedTabs.map((tab) => tab.id);

    delete state.workspaces[id];
    state.workspaceOrder = state.workspaceOrder.filter((candidate) => candidate !== id);
    if (state.activeWorkspaceId === id) state.activeWorkspaceId = state.workspaceOrder[0] || null;
    await saveState(state);
    await setActiveForWindow(windowId, state.activeWorkspaceId);

    if (state.activeWorkspaceId) {
      await showWorkspace(windowId, state.activeWorkspaceId);
      await ensureWorkspaceTab(windowId, state.activeWorkspaceId);
      await activateWorkspaceTab(windowId, state.activeWorkspaceId);
    }

    for (const tabId of tabIds) await clearTabWorkspaceId(tabId);
    if (tabIds.length) await browser.tabs.remove(tabIds).catch(() => {});
    if (state.activeWorkspaceId) await hideOtherKnownTabs(windowId, state.activeWorkspaceId);
    return { success: true };
  });
}

async function renameWorkspace(windowId, oldName, newName) {
  return await withBusy(windowId, async () => {
    const id = await workspaceIdByName(oldName);
    const name = cleanName(newName);
    if (!id || !name) return { success: false, reason: "invalid" };
    const state = await loadState();
    for (const other of state.workspaceOrder) if (other !== id && state.workspaces[other]?.name === name) return { success: false, reason: "exists" };
    state.workspaces[id].name = name;
    state.workspaces[id].updatedAt = now();
    await saveState(state);
    if ((await activeForWindow(windowId)) === id) await updateBadge(windowId, id);
    return { success: true };
  });
}

async function countsByName(windowId) {
  const state = await loadState();
  const counts = {};
  for (const id of state.workspaceOrder) counts[id] = 0;
  for (const tab of await tabs({ windowId })) {
    if (!ownable(tab)) continue;
    const owner = await getTabWorkspaceId(tab.id);
    if (owner && Object.prototype.hasOwnProperty.call(counts, owner)) counts[owner]++;
  }
  const out = {};
  for (const id of state.workspaceOrder) if (state.workspaces[id]) out[state.workspaces[id].name] = counts[id] || 0;
  return out;
}

async function getState(windowId) {
  const state = await loadState();
  const id = await activeForWindow(windowId);
  return {
    active: id && state.workspaces[id] ? state.workspaces[id].name : null,
    order: state.workspaceOrder.map((workspaceId) => state.workspaces[workspaceId]).filter(Boolean).map((workspace) => workspace.name),
    counts: await countsByName(windowId),
  };
}

async function resetAll(windowId) {
  return await withBusy(windowId, async () => {
    for (const tab of await tabs({ windowId })) {
      if (!ownable(tab)) continue;
      await clearTabWorkspaceId(tab.id);
      if (tab.hidden) await browser.tabs.show(tab.id).catch(() => {});
    }
    await saveState(emptyState());
    activeByWindow.set(windowId, null);
    await updateBadge(windowId, null);
    return { success: true };
  });
}

browser.runtime.onMessage.addListener(async (message) => {
  switch (message.action) {
    case "get_state": return await getState(message.windowId);
    case "create_workspace": return await createWorkspace(message.windowId, message.workspace);
    case "switch_workspace": return await switchWorkspace(message.windowId, message.workspace);
    case "delete_workspace": return await deleteWorkspace(message.windowId, message.workspace);
    case "rename_workspace": return await renameWorkspace(message.windowId, message.oldName, message.newName);
    case "reset_all": return await resetAll(message.windowId);
    default: return { success: false, reason: "unknown_action" };
  }
});

browser.tabs.onCreated.addListener(async (tab) => {
  if (!tab || tab.windowId === undefined || tab.pinned || busyWindows.has(tab.windowId)) return;
  if (await getTabWorkspaceId(tab.id)) return;
  const id = await activeForWindow(tab.windowId);
  if (id) await setTabWorkspaceId(tab.id, id);
});

browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo || changeInfo.pinned === undefined) return;
  if (changeInfo.pinned) await clearTabWorkspaceId(tabId);
  else if (tab && tab.windowId !== undefined) {
    const id = await activeForWindow(tab.windowId);
    if (id) await setTabWorkspaceId(tabId, id);
  }
}, { properties: ["pinned"] });

browser.windows.onRemoved.addListener((windowId) => {
  activeByWindow.delete(windowId);
  busyWindows.delete(windowId);
});

async function bootstrap() {
  activeByWindow.clear();
  const id = await activeId();
  for (const win of await normalWindows()) {
    activeByWindow.set(win.id, id);
    await updateBadge(win.id, id);
    if (id) {
      await showWorkspace(win.id, id);
      await ensureWorkspaceTab(win.id, id);
      await activateWorkspaceTab(win.id, id);
      await hideOtherKnownTabs(win.id, id);
    }
  }
}

browser.runtime.onStartup.addListener(bootstrap);
browser.runtime.onInstalled.addListener(bootstrap);
