// ============================================================
// Workflow01 — Popup UI
// ============================================================

document.addEventListener("DOMContentLoaded", async () => {
  const listContainer = document.getElementById("workspace-list");
  const nameInput = document.getElementById("workspace-name");
  const currentBanner = document.getElementById("current-banner");
  const currentNameEl = document.getElementById("current-name");
  const confirmOverlay = document.getElementById("confirm-overlay");
  const confirmMessage = document.getElementById("confirm-message");
  const confirmCancel = document.getElementById("confirm-cancel");
  const confirmOk = document.getElementById("confirm-ok");
  const btnExport = document.getElementById("btn-export");
  const btnImport = document.getElementById("btn-import");
  const importFile = document.getElementById("import-file");

  // Get current window
  const currentWindow = await browser.windows.getCurrent();
  const windowId = currentWindow.id;

  // Get current workspace for this window
  const resp = await browser.runtime.sendMessage({ action: "get_current_workspace", windowId });
  const currentWorkspace = resp.workspace;

  // ---- Update banner ----
  if (currentWorkspace) {
    currentNameEl.textContent = currentWorkspace;
    currentBanner.classList.remove("unassigned");
  } else {
    currentNameEl.textContent = "None";
    currentBanner.classList.add("unassigned");
  }

  // ---- Confirm dialog helper ----
  function showConfirm(message, isDanger = true) {
    return new Promise((resolve) => {
      confirmMessage.textContent = message;
      confirmOk.className = isDanger ? "btn-danger" : "btn-primary";
      confirmOk.textContent = isDanger ? "Delete" : "Switch";
      confirmOverlay.classList.add("visible");

      function cleanup() {
        confirmOverlay.classList.remove("visible");
        confirmCancel.removeEventListener("click", onCancel);
        confirmOk.removeEventListener("click", onOk);
      }
      function onCancel() { cleanup(); resolve(false); }
      function onOk() { cleanup(); resolve(true); }

      confirmCancel.addEventListener("click", onCancel);
      confirmOk.addEventListener("click", onOk);
    });
  }

  // ---- Render workspace list ----
  async function renderList() {
    listContainer.innerHTML = "";
    const data = await browser.storage.local.get("workspaces");
    const workspaces = data.workspaces || {};

    const entries = Object.keys(workspaces).sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase())
    );

    if (entries.length === 0) {
      const emptyMsg = document.createElement("div");
      emptyMsg.style.cssText = "font-size: 13px; color: #777; padding: 8px 0;";
      emptyMsg.textContent = "No workspaces yet. Type a name below to create one.";
      listContainer.appendChild(emptyMsg);
      return;
    }

    entries.forEach((name) => {
      const urls = workspaces[name] || [];
      const item = document.createElement("div");
      item.className = "workspace-item";

      // Highlight the active workspace
      if (name === currentWorkspace) {
        item.classList.add("active");
      }

      // Info column
      const info = document.createElement("div");
      info.className = "workspace-info";

      const nameSpan = document.createElement("span");
      nameSpan.className = "workspace-name";
      nameSpan.textContent = name;
      info.appendChild(nameSpan);

      const tabCount = document.createElement("span");
      tabCount.className = "workspace-tabs";
      tabCount.textContent = `${urls.length} tab${urls.length !== 1 ? "s" : ""}`;
      info.appendChild(tabCount);

      item.appendChild(info);

      // Delete button
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "delete-btn";
      deleteBtn.textContent = "×";
      deleteBtn.title = "Delete workspace";

      deleteBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const confirmed = await showConfirm(`Delete workspace "${name}"? This cannot be undone.`, true);
        if (!confirmed) return;

        const d = await browser.storage.local.get("workspaces");
        const ws = d.workspaces || {};
        delete ws[name];
        await browser.storage.local.set({ workspaces: ws });

        // If we just deleted the active workspace, unassign the window
        if (name === currentWorkspace) {
          await browser.runtime.sendMessage({ action: "unassign_workspace", windowId });
        }

        renderList();
      });

      item.appendChild(deleteBtn);

      // Click to switch
      item.addEventListener("click", async () => {
        if (name === currentWorkspace) return; // Already here

        // Confirm switch if current workspace has tabs
        if (currentWorkspace) {
          const ok = await showConfirm(`Switch from "${currentWorkspace}" to "${name}"? Current tabs will be saved.`, false);
          if (!ok) return;
        }

        await browser.runtime.sendMessage({ action: "switch_workspace", windowId, workspace: name });
        window.close();
      });

      listContainer.appendChild(item);
    });
  }

  // ---- Input handler: create new or switch to existing ----
  nameInput.addEventListener("keypress", async (e) => {
    if (e.key !== "Enter") return;
    const name = nameInput.value.trim();
    if (!name) return;

    const data = await browser.storage.local.get("workspaces");
    const workspaces = data.workspaces || {};

    if (workspaces[name]) {
      // Workspace exists — switch to it
      if (name === currentWorkspace) {
        window.close();
        return;
      }
      await browser.runtime.sendMessage({ action: "switch_workspace", windowId, workspace: name });
      window.close();
    } else {
      // New workspace — get the active tab and migrate it
      const [activeTab] = await browser.tabs.query({ active: true, windowId });

      if (activeTab && currentWorkspace) {
        // Migrate active tab to new workspace
        await browser.runtime.sendMessage({
          action: "create_workspace_from_tab",
          windowId,
          workspace: name,
          tabId: activeTab.id
        });
      } else {
        // No current workspace (unassigned window) — just assign this window as the new workspace
        workspaces[name] = [];
        await browser.storage.local.set({ workspaces });
        await browser.runtime.sendMessage({ action: "switch_workspace", windowId, workspace: name });
      }

      window.close();
    }
  });

  // ---- Export ----
  btnExport.addEventListener("click", async () => {
    const data = await browser.storage.local.get("workspaces");
    const workspaces = data.workspaces || {};
    const json = JSON.stringify(workspaces, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "workflow01-workspaces.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  // ---- Import ----
  btnImport.addEventListener("click", () => {
    importFile.click();
  });

  importFile.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const imported = JSON.parse(text);

      if (typeof imported !== "object" || Array.isArray(imported)) {
        alert("Invalid file format. Expected a JSON object of workspaces.");
        return;
      }

      // Merge with existing (imported workspaces overwrite same-name ones)
      const data = await browser.storage.local.get("workspaces");
      const workspaces = data.workspaces || {};
      Object.assign(workspaces, imported);
      await browser.storage.local.set({ workspaces });

      renderList();
    } catch (err) {
      alert("Failed to import: " + err.message);
    }
  });

  // ---- Initial render ----
  renderList();
});