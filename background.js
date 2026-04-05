// ============================================================
// Workflow01 — Background Service
// Single-window workspace model with continuous tab tracking
// ============================================================

// In-memory map: windowId -> workspaceName (or null if unassigned)
let windowWorkspaceMap = {};

// Flag to prevent saving tabs while we're in the middle of switching
let isSwitching = false;

// ---- Badge Helpers ----

function updateBadge(windowId, workspaceName) {
  if (workspaceName) {
    const badgeText = workspaceName.substring(0, 3).toUpperCase();
    browser.action.setBadgeText({ text: badgeText, windowId });
    browser.action.setBadgeBackgroundColor({ color: "#0060df", windowId });
  } else {
    browser.action.setBadgeText({ text: "", windowId });
  }
}

// ---- Tab Persistence ----

async function saveTabsForWindow(windowId) {
  const workspaceName = windowWorkspaceMap[windowId];
  if (!workspaceName || isSwitching) return;

  try {
    const tabs = await browser.tabs.query({ windowId });
    // Filter out internal Firefox pages that can't be restored
    const urls = tabs
      .map(t => t.url)
      .filter(url => url && !url.startsWith("about:") && !url.startsWith("moz-extension://"));

    const data = await browser.storage.local.get("workspaces");
    const workspaces = data.workspaces || {};
    workspaces[workspaceName] = urls;
    await browser.storage.local.set({ workspaces });
  } catch (e) {
    // Window may have been closed mid-query, ignore
  }
}

// ---- Workspace Switching (Core Logic) ----

async function switchWorkspace(windowId, targetWorkspace) {
  isSwitching = true;

  try {
    const currentWorkspace = windowWorkspaceMap[windowId];

    // 1. Save current workspace's tabs before leaving
    if (currentWorkspace) {
      const currentTabs = await browser.tabs.query({ windowId });
      const currentUrls = currentTabs
        .map(t => t.url)
        .filter(url => url && !url.startsWith("about:") && !url.startsWith("moz-extension://"));

      const data = await browser.storage.local.get("workspaces");
      const workspaces = data.workspaces || {};
      workspaces[currentWorkspace] = currentUrls;
      await browser.storage.local.set({ workspaces });
    }

    // 2. Load target workspace's tabs
    const data = await browser.storage.local.get("workspaces");
    const workspaces = data.workspaces || {};
    const urls = workspaces[targetWorkspace] || [];

    // 3. Open new tabs first (or one blank tab if workspace is empty)
    let newTabs = [];
    if (urls.length > 0) {
      for (let i = 0; i < urls.length; i++) {
        const tab = await browser.tabs.create({
          windowId,
          url: urls[i],
          active: i === 0
        });
        newTabs.push(tab);
      }
    } else {
      const tab = await browser.tabs.create({ windowId, active: true });
      newTabs.push(tab);
    }

    // 4. Close all the OLD tabs (the ones from the previous workspace)
    const allTabs = await browser.tabs.query({ windowId });
    const newTabIds = new Set(newTabs.map(t => t.id));
    const oldTabIds = allTabs.filter(t => !newTabIds.has(t.id)).map(t => t.id);

    if (oldTabIds.length > 0) {
      await browser.tabs.remove(oldTabIds);
    }

    // 5. Update tracking and badge
    windowWorkspaceMap[windowId] = targetWorkspace;
    updateBadge(windowId, targetWorkspace);

    // 6. Persist the active workspace name
    await browser.storage.local.set({ activeWorkspace: targetWorkspace });

  } finally {
    isSwitching = false;
  }
}

// ---- Create New Workspace From Active Tab ----

async function createWorkspaceFromTab(windowId, newWorkspaceName, tabId) {
  isSwitching = true;

  try {
    const currentWorkspace = windowWorkspaceMap[windowId];
    const data = await browser.storage.local.get("workspaces");
    const workspaces = data.workspaces || {};

    // Get the tab that will migrate
    const migratingTab = await browser.tabs.get(tabId);
    const migratingUrl = migratingTab.url;

    // Remove this tab's URL from the old workspace and save
    if (currentWorkspace && workspaces[currentWorkspace]) {
      const idx = workspaces[currentWorkspace].indexOf(migratingUrl);
      if (idx !== -1) {
        workspaces[currentWorkspace].splice(idx, 1);
      }
    }

    // Create the new workspace with just this tab's URL
    const newUrls = (migratingUrl && !migratingUrl.startsWith("about:") && !migratingUrl.startsWith("moz-extension://"))
      ? [migratingUrl]
      : [];
    workspaces[newWorkspaceName] = newUrls;
    await browser.storage.local.set({ workspaces });

    // Now close all OTHER tabs and keep only the migrating one
    const allTabs = await browser.tabs.query({ windowId });
    const toClose = allTabs.filter(t => t.id !== tabId).map(t => t.id);
    if (toClose.length > 0) {
      await browser.tabs.remove(toClose);
    }

    // Update tracking
    windowWorkspaceMap[windowId] = newWorkspaceName;
    updateBadge(windowId, newWorkspaceName);
    await browser.storage.local.set({ activeWorkspace: newWorkspaceName });

  } finally {
    isSwitching = false;
  }
}

// ---- Message Listener ----

browser.runtime.onMessage.addListener(async (message) => {
  if (message.action === "switch_workspace") {
    await switchWorkspace(message.windowId, message.workspace);
    return { success: true };
  }

  if (message.action === "create_workspace_from_tab") {
    await createWorkspaceFromTab(message.windowId, message.workspace, message.tabId);
    return { success: true };
  }

  if (message.action === "get_current_workspace") {
    return { workspace: windowWorkspaceMap[message.windowId] || null };
  }

  if (message.action === "unassign_workspace") {
    // Used internally: mark window as unassigned without changing tabs
    windowWorkspaceMap[message.windowId] = null;
    updateBadge(message.windowId, null);
    await browser.storage.local.set({ activeWorkspace: null });
    return { success: true };
  }
});

// ---- Continuous Tab Tracking ----

browser.tabs.onCreated.addListener((tab) => {
  if (tab.windowId) saveTabsForWindow(tab.windowId);
});

browser.tabs.onRemoved.addListener((tabId, removeInfo) => {
  if (!removeInfo.isWindowClosing) {
    saveTabsForWindow(removeInfo.windowId);
  }
});

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only save when a URL actually finishes loading
  if (changeInfo.status === "complete") {
    saveTabsForWindow(tab.windowId);
  }
});

// ---- Window Lifecycle ----

browser.windows.onRemoved.addListener(async (windowId) => {
  // Save one final time before we lose the reference
  await saveTabsForWindow(windowId);
  delete windowWorkspaceMap[windowId];
});

// On startup: all windows are unassigned
browser.runtime.onStartup.addListener(() => {
  windowWorkspaceMap = {};
  browser.storage.local.set({ activeWorkspace: null });
});

// On install: initialize clean state
browser.runtime.onInstalled.addListener(() => {
  windowWorkspaceMap = {};
  browser.storage.local.set({ activeWorkspace: null });
});