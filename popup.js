// Workflow01 — Popup UI (v5.2)
document.addEventListener("DOMContentLoaded", async () => {
  const listContainer = document.getElementById("workspace-list");
  const nameInput = document.getElementById("workspace-name");
  const currentNameEl = document.getElementById("current-name");
  const inputHint = document.getElementById("input-hint");
  const addButton = document.getElementById("add-workspace");
  const createPanel = document.getElementById("create-panel");
  const createGo = document.getElementById("create-go");
  const confirmOverlay = document.getElementById("confirm-overlay");
  const confirmMessage = document.getElementById("confirm-message");
  const confirmCancel = document.getElementById("confirm-cancel");
  const confirmOk = document.getElementById("confirm-ok");
  const resetLink = document.getElementById("reset-link");

  const currentWindow = await browser.windows.getCurrent();
  const windowId = currentWindow.id;
  let currentWorkspace = null;
  let order = [];
  let counts = {};
  let highlightIndex = -1;

  function setBanner() {
    currentNameEl.textContent = currentWorkspace || "None";
    currentNameEl.title = currentWorkspace || "None";
  }

  function setCreateOpen(open) {
    createPanel.classList.toggle("visible", open);
    addButton.classList.toggle("open", open);
    if (open) {
      nameInput.value = "";
      clearHint();
      setTimeout(() => nameInput.focus(), 0);
    }
  }

  function clearHint() {
    inputHint.textContent = "Press Enter to create";
    inputHint.classList.remove("input-error");
  }

  function setError(message) {
    inputHint.textContent = message;
    inputHint.classList.add("input-error");
  }

  function setBusy(label) {
    let el = document.getElementById("wf-busy");
    if (!el) {
      el = document.createElement("div");
      el.id = "wf-busy";
      el.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.25);z-index:300;display:flex;align-items:center;justify-content:center;font:menu;color:CanvasText;";
      document.body.appendChild(el);
    }
    el.textContent = label;
    el.style.display = "flex";
  }

  function clearBusy() {
    const el = document.getElementById("wf-busy");
    if (el) el.style.display = "none";
  }

  function validateName(name) {
    if (!name) return "Name cannot be empty.";
    if (name.length > 40) return "Name must be 40 characters or fewer.";
    if (/[\u0000-\u001f\u007f]/.test(name)) return "Name contains invalid characters.";
    if (!/[\p{L}\p{N}]/u.test(name)) return "Name must contain a letter or number.";
    return null;
  }

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

  async function refreshState() {
    const state = await browser.runtime.sendMessage({ action: "get_state", windowId });
    currentWorkspace = state.active || null;
    order = state.order || [];
    counts = state.counts || {};
    setBanner();
    return state;
  }

  async function renderList() {
    listContainer.innerHTML = "";
    await refreshState();

    if (!order.length) {
      const empty = document.createElement("div");
      empty.className = "empty-msg";
      empty.textContent = "No workspaces yet. Click + to create your first workspace.";
      listContainer.appendChild(empty);
      return;
    }

    order.forEach((name) => {
      const row = document.createElement("div");
      row.className = "workspace-row";
      if (name === currentWorkspace) row.classList.add("active");

      const nameEl = document.createElement("div");
      nameEl.className = "workspace-name";
      nameEl.textContent = name;
      nameEl.title = name;
      row.appendChild(nameEl);

      const countEl = document.createElement("div");
      countEl.className = "workspace-count";
      countEl.textContent = counts[name] || 0;
      countEl.title = `${counts[name] || 0} tab${(counts[name] || 0) === 1 ? "" : "s"}`;
      row.appendChild(countEl);

      const renameBtn = document.createElement("button");
      renameBtn.className = "row-btn rename-btn";
      renameBtn.textContent = "✎";
      renameBtn.title = "Rename";
      renameBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        startRename(row, nameEl, name);
      });
      row.appendChild(renameBtn);

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "row-btn delete-btn";
      deleteBtn.textContent = "×";
      deleteBtn.title = "Delete";
      deleteBtn.addEventListener("click", async (event) => {
        event.stopPropagation();
        const ok = await showConfirm(`Delete workspace "${name}"? This closes its tabs and cannot be undone.`, "Delete");
        if (!ok) return;
        setBusy("Deleting…");
        const response = await browser.runtime.sendMessage({ action: "delete_workspace", windowId, workspace: name });
        clearBusy();
        if (response.success) await renderList();
      });
      row.appendChild(deleteBtn);

      row.addEventListener("click", async () => {
        if (name === currentWorkspace) { window.close(); return; }
        setBusy("Switching…");
        const response = await browser.runtime.sendMessage({ action: "switch_workspace", windowId, workspace: name });
        if (response.success) window.close();
        else clearBusy();
      });

      listContainer.appendChild(row);
    });
  }

  async function createWorkspaceFromInput() {
    const name = nameInput.value.trim();
    const err = validateName(name);
    if (err) { setError(err); return; }
    if (order.includes(name)) { setError("A workspace with that name already exists."); return; }

    setBusy("Creating…");
    const response = await browser.runtime.sendMessage({ action: "create_workspace", windowId, workspace: name });
    clearBusy();

    if (response.success) window.close();
    else setError(response.reason === "exists" ? "A workspace with that name already exists." : "Could not create workspace.");
  }

  function startRename(row, oldNameEl, oldName) {
    const input = document.createElement("input");
    input.type = "text";
    input.value = oldName;
    input.className = "ws-input";
    input.style.height = "28px";
    oldNameEl.replaceWith(input);
    input.focus();
    input.select();
    let committed = false;

    async function commit() {
      if (committed) return;
      committed = true;
      const newName = input.value.trim();
      if (!newName || newName === oldName) { await renderList(); return; }
      if (order.includes(newName)) { input.style.borderColor = "Mark"; committed = false; return; }
      const err = validateName(newName);
      if (err) { input.style.borderColor = "Mark"; committed = false; return; }

      const response = await browser.runtime.sendMessage({ action: "rename_workspace", windowId, oldName, newName });
      if (response.success) await renderList();
      else { input.style.borderColor = "Mark"; committed = false; }
    }

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); commit(); }
      else if (event.key === "Escape") { renderList(); }
    });
    input.addEventListener("blur", commit);
  }

  addButton.addEventListener("click", () => setCreateOpen(!createPanel.classList.contains("visible")));
  createGo.addEventListener("click", createWorkspaceFromInput);
  nameInput.addEventListener("input", clearHint);
  nameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); createWorkspaceFromInput(); }
    else if (event.key === "Escape") { event.preventDefault(); setCreateOpen(false); }
  });

  document.addEventListener("keydown", (event) => {
    if (document.activeElement === nameInput) return;
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      setCreateOpen(true);
      return;
    }

    const rows = [...listContainer.querySelectorAll(".workspace-row")];
    if (!rows.length) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      highlightIndex = Math.min(highlightIndex + 1, rows.length - 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      highlightIndex = Math.max(highlightIndex - 1, 0);
    } else if (event.key === "Enter" && highlightIndex >= 0) {
      event.preventDefault();
      rows[highlightIndex].click();
      return;
    } else {
      return;
    }

    rows.forEach((row, index) => {
      row.style.outline = index === highlightIndex ? "2px solid AccentColor" : "";
      row.style.outlineOffset = index === highlightIndex ? "-2px" : "";
      if (index === highlightIndex) row.scrollIntoView({ block: "nearest" });
    });
  });

  resetLink.addEventListener("click", async (event) => {
    event.preventDefault();
    const ok = await showConfirm("Reset all workspaces? This clears every workspace and un-hides all tabs. Your tabs are kept. This cannot be undone.", "Reset");
    if (!ok) return;
    setBusy("Resetting…");
    await browser.runtime.sendMessage({ action: "reset_all", windowId });
    window.close();
  });

  await renderList();
});
