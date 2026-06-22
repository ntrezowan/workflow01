/* Workflow01 5.3.2 - transactional single-window Firefox workspace manager. */
const STORAGE_KEY = "workflow01State";
const SCHEMA_VERSION = 3;
const SAFE_URL = "about:blank";
const NEW_TAB_URL = "about:newtab";
const AUTOSAVE_DELAY_MS = 800;
const STARTUP_RESTORE_DELAY_MS = 1500;
const api = typeof browser !== "undefined" ? browser : chrome;

let transactionDepth = 0;
let autosaveTimer = null;
let pendingAutosaveWindowId = null;
let startupRestoreStarted = false;

const now = () => Date.now();
const inTx = () => transactionDepth > 0;
const cleanName = (name) => String(name || "").trim();
const nameKey = (name) => cleanName(name).toLowerCase();
const isBlank = (url) => !url || url === SAFE_URL || url === NEW_TAB_URL;
const clone = (value) => JSON.parse(JSON.stringify(value));

function emptyState() {
  return { version: SCHEMA_VERSION, activeWorkspace: null, previousWorkspace: null, workspaceHistory: [], managedWindowId: null, workspaces: {}, lastError: null, updatedAt: now() };
}

function normalizeTab(tab, index = 0) {
  if (!tab) return null;
  return { url: String(tab.url || tab.pendingUrl || SAFE_URL), title: tab.title || "", pinned: Boolean(tab.pinned), muted: Boolean((tab.mutedInfo && tab.mutedInfo.muted) || tab.muted), active: Boolean(tab.active), index: Number.isInteger(tab.index) ? tab.index : index, failedRestore: Boolean(tab.failedRestore) };
}

function normalizeTabs(tabs) {
  const list = (tabs || []).map((tab, index) => normalizeTab(tab, index)).filter(Boolean);
  if (list.length && list.every((tab) => isBlank(tab.url))) return [];
  return list.map((tab, index) => Object.assign({}, tab, { index }));
}

function normalizeWorkspace(name, record) {
  const tabs = Array.isArray(record) ? record : Array.isArray(record && record.tabs) ? record.tabs : [];
  const normalized = normalizeTabs(tabs);
  const rawActive = Number.isInteger(record && record.activeTabIndex) ? record.activeTabIndex : tabs.findIndex((tab) => tab && tab.active);
  return { name, tabs: normalized, activeTabIndex: normalized.length ? Math.max(0, Math.min(rawActive < 0 ? 0 : rawActive, normalized.length - 1)) : 0, updatedAt: record && record.updatedAt ? record.updatedAt : now() };
}

function normalizeState(state) {
  const merged = Object.assign(emptyState(), state || {});
  merged.version = SCHEMA_VERSION;
  merged.workspaces = merged.workspaces && typeof merged.workspaces === "object" ? merged.workspaces : {};
  const normalized = {};
  for (const [key, record] of Object.entries(merged.workspaces)) {
    const wsName = cleanName(record && record.name ? record.name : key);
    if (!wsName || normalized[wsName]) continue;
    normalized[wsName] = normalizeWorkspace(wsName, record);
  }
  merged.workspaces = normalized;
  if (merged.activeWorkspace && !merged.workspaces[merged.activeWorkspace]) merged.activeWorkspace = null;
  if (merged.previousWorkspace && !merged.workspaces[merged.previousWorkspace]) merged.previousWorkspace = null;
  if (!Array.isArray(merged.workspaceHistory)) merged.workspaceHistory = [];
  merged.workspaceHistory = merged.workspaceHistory.filter((name) => merged.workspaces[name]);
  return merged;
}

async function getState() {
  const data = await api.storage.local.get(null);
  let state = data[STORAGE_KEY];
  if (!state) {
    state = emptyState();
    if (data.workspaces && typeof data.workspaces === "object") {
      for (const [name, record] of Object.entries(data.workspaces)) {
        const wsName = cleanName(name);
        if (wsName) state.workspaces[wsName] = normalizeWorkspace(wsName, record);
      }
    }
    if (typeof data.activeWorkspace === "string" && state.workspaces[data.activeWorkspace]) state.activeWorkspace = data.activeWorkspace;
    await setState(state);
  }
  return normalizeState(state);
}

async function setState(state) { await api.storage.local.set({ [STORAGE_KEY]: normalizeState(state) }); }
async function setError(message) { const state = await getState(); state.lastError = message ? { message: String(message), at: now() } : null; await setState(state); }

async function withTransaction(label, fn) {
  transactionDepth++;
  try {
    const before = await getState();
    before.transaction = { label, startedAt: now() };
    await setState(before);
    const result = await fn();
    const after = await getState();
    delete after.transaction;
    after.updatedAt = now();
    await setState(after);
    return result;
  } finally {
    transactionDepth = Math.max(0, transactionDepth - 1);
  }
}

async function getWindow(windowId) { if (!windowId) return null; try { return await api.windows.get(windowId, { populate: false }); } catch (_) { return null; } }
async function usableWindow(windowId) { const win = await getWindow(windowId); return Boolean(win && win.type === "normal" && !win.incognito); }

async function candidateWindow(preferredWindowId = null) {
  if (preferredWindowId && await usableWindow(preferredWindowId)) return await getWindow(preferredWindowId);
  const state = await getState();
  if (state.managedWindowId && await usableWindow(state.managedWindowId)) return await getWindow(state.managedWindowId);
  try { const focused = await api.windows.getLastFocused({ populate: false, windowTypes: ["normal"] }); if (focused && !focused.incognito) return focused; } catch (_) {}
  const wins = await api.windows.getAll({ populate: false, windowTypes: ["normal"] });
  return wins.find((win) => !win.incognito) || null;
}

async function queryTabs(windowId) { const tabs = await api.tabs.query({ windowId }); return tabs.filter((tab) => !tab.incognito).sort((a, b) => a.index - b.index); }

async function captureWindow(windowId) {
  const tabs = await queryTabs(windowId);
  const records = tabs.map((tab, index) => normalizeTab(tab, index)).filter(Boolean);
  const normalized = normalizeTabs(records);
  const activeRaw = Math.max(0, records.findIndex((tab) => tab.active));
  return { tabs: normalized, activeTabIndex: normalized.length ? Math.min(activeRaw, normalized.length - 1) : 0, updatedAt: now() };
}

async function saveActiveFromWindow(windowId) {
  if (inTx() || !windowId || !(await usableWindow(windowId))) return;
  const state = await getState();
  if (!state.activeWorkspace || !state.workspaces[state.activeWorkspace]) return;
  state.workspaces[state.activeWorkspace] = Object.assign({}, state.workspaces[state.activeWorkspace], await captureWindow(windowId), { name: state.activeWorkspace });
  state.managedWindowId = windowId;
  state.updatedAt = now();
  await setState(state);
}

function scheduleAutosave(windowId) {
  if (inTx()) return;
  pendingAutosaveWindowId = windowId || pendingAutosaveWindowId;
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(async () => {
    autosaveTimer = null;
    const target = pendingAutosaveWindowId;
    pendingAutosaveWindowId = null;
    try { if (target) await saveActiveFromWindow(target); } catch (error) { await setError(`Autosave failed: ${error.message || error}`); }
  }, AUTOSAVE_DELAY_MS);
}

async function safeTab(windowId) { return await api.tabs.create({ windowId, url: SAFE_URL, active: true }); }

async function removeTabsExcept(windowId, keepIds = []) {
  const keep = new Set(keepIds.filter(Boolean));
  const removeIds = (await queryTabs(windowId)).filter((tab) => !keep.has(tab.id)).map((tab) => tab.id);
  if (removeIds.length) await api.tabs.remove(removeIds);
}

function creatableUrl(url) {
  if (!url) return SAFE_URL;
  if (url === SAFE_URL || url === NEW_TAB_URL) return url;
  if (/^(https?|ftp):\/\//i.test(url)) return url;
  return SAFE_URL;
}

async function updateTab(tabId, record, active) {
  const props = { url: creatableUrl(record && record.url), active: Boolean(active), pinned: Boolean(record && record.pinned), muted: Boolean(record && record.muted) };
  try { return await api.tabs.update(tabId, props); }
  catch (_) { return await api.tabs.update(tabId, { url: SAFE_URL, active: Boolean(active), pinned: false, muted: false }); }
}

async function createTab(windowId, record, active, index) {
  const url = creatableUrl(record && record.url);
  const props = { windowId, url, active: Boolean(active), pinned: Boolean(record && record.pinned), muted: Boolean(record && record.muted), index };
  if (!active && !props.pinned && url !== SAFE_URL && url !== NEW_TAB_URL) { props.discarded = true; if (record && record.title) props.title = record.title; }
  try { return await api.tabs.create(props); }
  catch (_) { delete props.discarded; delete props.title; props.url = SAFE_URL; props.pinned = false; props.muted = false; return await api.tabs.create(props); }
}

async function restoreIntoWindow(windowId, workspace, existingSafeTabId = null) {
  const tabs = Array.isArray(workspace && workspace.tabs) ? workspace.tabs : [];
  if (!tabs.length) {
    if (existingSafeTabId) return await api.tabs.update(existingSafeTabId, { url: NEW_TAB_URL, active: true, pinned: false, muted: false });
    await api.tabs.create({ windowId, url: NEW_TAB_URL, active: true });
    return;
  }
  const desiredActive = Math.max(0, Math.min(workspace.activeTabIndex || 0, tabs.length - 1));
  const keep = existingSafeTabId || (await safeTab(windowId)).id;
  await updateTab(keep, tabs[0], desiredActive === 0);
  for (let i = 1; i < tabs.length; i++) await createTab(windowId, tabs[i], desiredActive === i, i);
  const all = await queryTabs(windowId);
  const active = all.find((tab) => tab.index === desiredActive) || all[desiredActive];
  if (active) await api.tabs.update(active.id, { active: true });
}

function pushHistory(state, previousName) {
  if (!previousName || !state.workspaces[previousName]) return;
  state.workspaceHistory = (state.workspaceHistory || []).filter((name) => name !== previousName && state.workspaces[name]);
  state.workspaceHistory.unshift(previousName);
  state.workspaceHistory = state.workspaceHistory.slice(0, 20);
  state.previousWorkspace = previousName;
}

function pickPrevious(state, exclude = null) {
  for (const name of state.workspaceHistory || []) if (name !== exclude && state.workspaces[name]) return name;
  if (state.previousWorkspace && state.previousWorkspace !== exclude && state.workspaces[state.previousWorkspace]) return state.previousWorkspace;
  return Object.keys(state.workspaces).find((name) => name !== exclude) || null;
}

async function postRestoreSave(windowId, workspaceName) {
  const state = await getState();
  if (!workspaceName || !state.workspaces[workspaceName]) return;
  state.workspaces[workspaceName] = Object.assign({}, state.workspaces[workspaceName], await captureWindow(windowId), { name: workspaceName });
  state.managedWindowId = windowId;
  state.updatedAt = now();
  await setState(state);
}

async function switchWorkspace(name, preferredWindowId = null) {
  const target = cleanName(name);
  if (!target) throw new Error("Workspace name is required.");
  return await withTransaction("switchWorkspace", async () => {
    const state = await getState();
    if (!state.workspaces[target]) throw new Error(`Workspace does not exist: ${target}`);
    const win = await candidateWindow(preferredWindowId);
    if (!win) throw new Error("No normal Firefox window is available.");
    if (state.activeWorkspace && state.workspaces[state.activeWorkspace] && state.activeWorkspace !== target) {
      state.workspaces[state.activeWorkspace] = Object.assign({}, state.workspaces[state.activeWorkspace], await captureWindow(win.id));
      pushHistory(state, state.activeWorkspace);
    }
    const safe = await safeTab(win.id);
    await removeTabsExcept(win.id, [safe.id]);
    state.activeWorkspace = target;
    state.managedWindowId = win.id;
    await setState(state);
    await restoreIntoWindow(win.id, state.workspaces[target], safe.id);
    await postRestoreSave(win.id, target);
    return await publicState();
  });
}

async function createWorkspace(name, preferredWindowId = null) {
  const wsName = cleanName(name);
  if (!wsName) throw new Error("Workspace name is required.");
  return await withTransaction("createWorkspace", async () => {
    const state = await getState();
    const dup = Object.keys(state.workspaces).find((name) => nameKey(name) === nameKey(wsName));
    if (dup) throw new Error(`Workspace already exists: ${dup}`);
    const win = await candidateWindow(preferredWindowId);
    if (!win) throw new Error("No normal Firefox window is available.");
    if (state.activeWorkspace && state.workspaces[state.activeWorkspace]) {
      state.workspaces[state.activeWorkspace] = Object.assign({}, state.workspaces[state.activeWorkspace], await captureWindow(win.id));
      pushHistory(state, state.activeWorkspace);
    }
    state.workspaces[wsName] = { name: wsName, tabs: [], activeTabIndex: 0, updatedAt: now() };
    state.activeWorkspace = wsName;
    state.managedWindowId = win.id;
    await setState(state);
    const safe = await safeTab(win.id);
    await removeTabsExcept(win.id, [safe.id]);
    await restoreIntoWindow(win.id, state.workspaces[wsName], safe.id);
    return await publicState();
  });
}

async function deleteWorkspace(name, preferredWindowId = null) {
  const wsName = cleanName(name);
  if (!wsName) throw new Error("Workspace name is required.");
  return await withTransaction("deleteWorkspace", async () => {
    const state = await getState();
    if (!state.workspaces[wsName]) throw new Error(`Workspace does not exist: ${wsName}`);
    const wasActive = state.activeWorkspace === wsName;
    const target = wasActive ? pickPrevious(state, wsName) : state.activeWorkspace;
    delete state.workspaces[wsName];
    state.workspaceHistory = (state.workspaceHistory || []).filter((name) => name !== wsName && state.workspaces[name]);
    if (state.previousWorkspace === wsName) state.previousWorkspace = pickPrevious(state, wsName);
    const win = await candidateWindow(preferredWindowId);
    if (!wasActive || !win) { state.activeWorkspace = target || null; await setState(state); return await publicState(); }
    const safe = await safeTab(win.id);
    await removeTabsExcept(win.id, [safe.id]);
    if (target && state.workspaces[target]) {
      state.activeWorkspace = target;
      state.managedWindowId = win.id;
      await setState(state);
      await restoreIntoWindow(win.id, state.workspaces[target], safe.id);
      await postRestoreSave(win.id, target);
    } else {
      state.activeWorkspace = null;
      state.previousWorkspace = null;
      state.managedWindowId = win.id;
      await setState(state);
      await api.tabs.update(safe.id, { url: NEW_TAB_URL, active: true, pinned: false, muted: false });
    }
    return await publicState();
  });
}

async function renameWorkspace(oldName, newName) {
  const oldClean = cleanName(oldName), newClean = cleanName(newName);
  if (!oldClean || !newClean) throw new Error("Workspace names are required.");
  return await withTransaction("renameWorkspace", async () => {
    const state = await getState();
    if (!state.workspaces[oldClean]) throw new Error(`Workspace does not exist: ${oldClean}`);
    const dup = Object.keys(state.workspaces).find((name) => nameKey(name) === nameKey(newClean));
    if (dup && dup !== oldClean) throw new Error(`Workspace already exists: ${dup}`);
    state.workspaces[newClean] = Object.assign({}, state.workspaces[oldClean], { name: newClean, updatedAt: now() });
    if (newClean !== oldClean) delete state.workspaces[oldClean];
    if (state.activeWorkspace === oldClean) state.activeWorkspace = newClean;
    if (state.previousWorkspace === oldClean) state.previousWorkspace = newClean;
    state.workspaceHistory = (state.workspaceHistory || []).map((name) => name === oldClean ? newClean : name);
    await setState(state);
    return await publicState();
  });
}

async function importWorkspaces(payload) {
  return await withTransaction("importWorkspaces", async () => {
    const state = await getState();
    const source = payload && payload.workspaces ? payload.workspaces : payload;
    if (!source || typeof source !== "object") throw new Error("Import file does not contain workspaces.");
    for (const [name, record] of Object.entries(source)) {
      const wsName = cleanName(record && record.name ? record.name : name);
      if (wsName) state.workspaces[wsName] = normalizeWorkspace(wsName, record);
    }
    await setState(state);
    return await publicState();
  });
}

async function publicState() {
  const state = await getState();
  const names = Object.keys(state.workspaces).sort((a, b) => a.localeCompare(b));
  return { version: state.version, activeWorkspace: state.activeWorkspace, previousWorkspace: state.previousWorkspace, workspaces: clone(state.workspaces), names, lastError: state.lastError };
}

async function restoreLastActive() {
  if (startupRestoreStarted) return;
  startupRestoreStarted = true;
  setTimeout(async () => {
    try {
      const state = await getState();
      if (!state.activeWorkspace || !state.workspaces[state.activeWorkspace]) return;
      const win = await candidateWindow(state.managedWindowId);
      if (win && !win.incognito) await switchWorkspace(state.activeWorkspace, win.id);
    } catch (error) { await setError(`Startup restore failed: ${error.message || error}`); }
    finally { startupRestoreStarted = false; }
  }, STARTUP_RESTORE_DELAY_MS);
}

api.runtime.onInstalled.addListener(async () => { try { await setState(await getState()); } catch (error) { await setError(`Install initialization failed: ${error.message || error}`); } });
api.runtime.onStartup.addListener(() => restoreLastActive());
api.tabs.onCreated.addListener((tab) => { if (!inTx() && tab && tab.windowId) scheduleAutosave(tab.windowId); });
api.tabs.onRemoved.addListener((tabId, info) => { if (!inTx() && info && info.windowId) scheduleAutosave(info.windowId); });
api.tabs.onActivated.addListener((info) => { if (!inTx() && info && info.windowId) scheduleAutosave(info.windowId); });
api.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (inTx()) return;
  if (!changeInfo.url && changeInfo.status !== "complete" && changeInfo.pinned === undefined && changeInfo.mutedInfo === undefined) return;
  if (tab && tab.windowId) scheduleAutosave(tab.windowId);
});

api.runtime.onMessage.addListener((message) => {
  const run = async () => {
    const action = message && message.action;
    const windowId = message && message.windowId;
    if (action === "getState") return await publicState();
    if (action === "createWorkspace") return await createWorkspace(message.name, windowId);
    if (action === "switchWorkspace") return await switchWorkspace(message.name, windowId);
    if (action === "deleteWorkspace") return await deleteWorkspace(message.name, windowId);
    if (action === "renameWorkspace") return await renameWorkspace(message.oldName, message.newName);
    if (action === "exportWorkspaces") return await getState();
    if (action === "importWorkspaces") return await importWorkspaces(message.data);
    if (action === "saveNow") { if (windowId) await saveActiveFromWindow(windowId); return await publicState(); }
    throw new Error(`Unknown action: ${action}`);
  };
  return run().catch(async (error) => {
    await setError(error.message || String(error));
    return { error: error.message || String(error), state: await publicState() };
  });
});
