// ============================================================
// Workflow01 — Popup UI (v3)
// ============================================================

document.addEventListener("DOMContentLoaded", async () => {
  const listContainer = document.getElementById("workspace-list");
  const nameInput = document.getElementById("workspace-name");
  const currentBanner = document.getElementById("current-banner");
  const currentNameEl = document.getElementById("current-name");
  const inputHint = document.getElementById("input-hint");
  const confirmOverlay = document.getElementById("confirm-overlay");
  const confirmMessage = document.getElementById("confirm-message");
  const confirmCancel = document.getElementById("confirm-cancel");
  const confirmOk = document.getElementById("confirm-ok");

  const currentWindow = await browser.windows.getCurrent();
  const windowId = currentWindow.id;

  const state = await browser.runtime.sendMessage({ action: "get_state", windowId });
  let currentWorkspace = state.active;
  let order = state.order || [];
  let counts = state.counts || {};

  function refreshBanner() {
    if (currentWorkspace) {
      currentNameEl.textContent = currentWorkspace;
      currentBanner.classList.remove("unassigned");
    } else {
      currentNameEl.textContent = "None";
      currentBanner.classList.add("unassigned");
    }
  }
  refreshBanner();

  function showConfirm(message, okLabel = "Delete") {
    return new Promise((resolve) => {
      confirmMessage.textContent = message;
      confirmOk.textContent = okLabel;
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

  // Fix 6: show a lightweight "Switching..." state instead of the popup
  // freezing/closing silently while the background materializes discarded tabs.
  function setBusy(label) {
    let el = document.getElementById("wf-busy");
    if (!el) {
      el = document.createElement("div");
      el.id = "wf-busy";
      el.style.cssText =
        "position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:200;" +
        "display:flex;align-items:center;justify-content:center;font-size:13px;" +
        "font-weight:600;color:#fff;";
      document.body.appendChild(el);
    }
    el.textContent = label;
    el.style.display = "flex";
  }

  // Fix 7: workspace name validation. Returns an error string or null if valid.
  const MAX_NAME_LEN = 40;
  function validateName(name) {
    if (!name) return "Name cannot be empty.";
    if (name.length > MAX_NAME_LEN) return `Name must be ${MAX_NAME_LEN} characters or fewer.`;
    // Disallow control chars and names that are only punctuation/symbols.
    if (/[\u0000-\u001f\u007f]/.test(name)) return "Name contains invalid characters.";
    if (!/[\p{L}\p{N}]/u.test(name)) return "Name must contain a letter or number.";
    return null;
  }

  async function refreshState() {
    const st = await browser.runtime.sendMessage({ action: "get_state", windowId });
    currentWorkspace = st.active;
    order = st.order || [];
    counts = st.counts || {};
    return st;
  }

  async function renderList() {
    listContainer.innerHTML = "";
    await refreshState();

    if (order.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-msg";
      empty.textContent = "No workspaces yet. Type a name below to create one.";
      listContainer.appendChild(empty);
      return;
    }

    order.forEach((name) => {
      const count = counts[name] || 0;
      const item = document.createElement("div");
      item.className = "workspace-item";
      if (name === currentWorkspace) item.classList.add("active");

      const nameSpan = document.createElement("span");
      nameSpan.className = "workspace-name";
      nameSpan.textContent = name;
      nameSpan.title = name;
      item.appendChild(nameSpan);

      const tabCount = document.createElement("span");
      tabCount.className = "workspace-tabs";
      tabCount.textContent = count;
      tabCount.title = `${count} tab${count !== 1 ? "s" : ""}`;
      item.appendChild(tabCount);

      // Rename
      const renameBtn = document.createElement("button");
      renameBtn.className = "row-btn rename-btn";
      renameBtn.textContent = "✎";
      renameBtn.title = "Rename";
      renameBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        startRename(item, nameSpan, name);
      });
      item.appendChild(renameBtn);

      // Delete
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "row-btn delete-btn";
      deleteBtn.textContent = "×";
      deleteBtn.title = "Delete";
      deleteBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const ok = await showConfirm(`Delete workspace "${name}"? This closes its tabs and cannot be undone.`, "Delete");
        if (!ok) return;
        const resp = await browser.runtime.sendMessage({ action: "delete_workspace", windowId, workspace: name });
        if (resp.success) {
          await refreshState();
          refreshBanner();
          renderList();
        }
      });
      item.appendChild(deleteBtn);

      // Switch on row click
      item.addEventListener("click", async () => {
        if (name === currentWorkspace) { window.close(); return; }
        setBusy("Switching\u2026");
        await browser.runtime.sendMessage({ action: "switch_workspace", windowId, workspace: name });
        window.close();
      });

      listContainer.appendChild(item);
    });
  }

  function startRename(item, nameSpan, oldName) {
    const input = document.createElement("input");
    input.type = "text";
    input.value = oldName;
    input.className = "ws-input";
    input.style.cssText = "flex-grow:1; padding:2px 6px; font-size:13px;";
    nameSpan.replaceWith(input);
    input.focus();
    input.select();

    async function commit() {
      const newName = input.value.trim();
      if (!newName || newName === oldName) { renderList(); return; }
      if (order.includes(newName)) { input.style.borderColor = "#d73a49"; return; }
      const resp = await browser.runtime.sendMessage({
        action: "rename_workspace", windowId, oldName, newName
      });
      if (resp.success) {
        if (currentWorkspace === oldName) currentWorkspace = newName;
        refreshBanner();
      }
      renderList();
    }
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); commit(); }
      else if (e.key === "Escape") { renderList(); }
    });
    input.addEventListener("blur", commit);
  }

  nameInput.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter") return;
    const name = nameInput.value.trim();
    if (!name) return;

    if (order.includes(name)) {
      // Existing -> switch
      if (name === currentWorkspace) { window.close(); return; }
      setBusy("Switching\u2026");
      await browser.runtime.sendMessage({ action: "switch_workspace", windowId, workspace: name });
      window.close();
      return;
    }

    // Fix 7: validate before creating a new workspace.
    const err = validateName(name);
    if (err) {
      inputHint.textContent = err;
      inputHint.classList.add("input-error");
      return;
    }

    setBusy("Creating\u2026");
    const resp = await browser.runtime.sendMessage({ action: "create_workspace", windowId, workspace: name });
    if (resp.success) {
      window.close();
    } else {
      const el = document.getElementById("wf-busy");
      if (el) el.style.display = "none";
      inputHint.textContent = resp.reason === "exists"
        ? "A workspace with that name already exists."
        : "Could not create workspace.";
      inputHint.classList.add("input-error");
    }
  });

  nameInput.addEventListener("input", () => {
    inputHint.textContent = "Enter to create new or switch to existing";
    inputHint.classList.remove("input-error");
  });

  // Bonus: arrow-key navigation over the workspace list. Down/Up move a
  // highlight; Enter switches to the highlighted workspace. Lets you switch
  // without the mouse. Typing in the name box still takes priority.
  let highlightIndex = -1;
  function applyHighlight() {
    const items = [...listContainer.querySelectorAll(".workspace-item")];
    items.forEach((el, i) => {
      el.style.outline = i === highlightIndex ? "2px solid #0060df" : "";
      el.style.outlineOffset = i === highlightIndex ? "-2px" : "";
      if (i === highlightIndex) el.scrollIntoView({ block: "nearest" });
    });
  }
  document.addEventListener("keydown", async (e) => {
    const items = [...listContainer.querySelectorAll(".workspace-item")];
    if (items.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      highlightIndex = Math.min(highlightIndex + 1, items.length - 1);
      applyHighlight();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      highlightIndex = Math.max(highlightIndex - 1, 0);
      applyHighlight();
    } else if (e.key === "Enter" && highlightIndex >= 0 && document.activeElement !== nameInput) {
      e.preventDefault();
      items[highlightIndex].click();
    }
  });

  // Reset all — clears every workspace label and un-hides all tabs (recovery
  // from a corrupted state). Tabs are kept; only assignments are wiped.
  const resetLink = document.getElementById("reset-link");
  if (resetLink) {
    resetLink.addEventListener("click", async (e) => {
      e.preventDefault();
      const ok = await showConfirm(
        "Reset all workspaces? This clears every workspace and un-hides all tabs. Your tabs are kept. This cannot be undone.",
        "Reset"
      );
      if (!ok) return;
      await browser.runtime.sendMessage({ action: "reset_all", windowId });
      window.close();
    });
  }

  renderList();
});
