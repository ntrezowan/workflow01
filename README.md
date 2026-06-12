# Workflow01

Single-window workspace manager for Firefox. Organize your tabs into named workspaces and switch between them instantly — without reloading.

[![Install](https://img.shields.io/badge/Install-Firefox%20Add--ons-FF7139?logo=firefox-browser&logoColor=white)](https://addons.mozilla.org/en-US/firefox/addon/workflow01/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Features

- **Zero-reload switching** — tabs are never closed or recreated when switching workspaces. Scroll position, form input, and media stay exactly where you left them.
- **Fresh workspace creation** — creating a workspace opens a single blank tab and switches to it. Nothing is stolen from your current workspace.
- **Inline rename** — hover any workspace row and click ✎ to rename in place.
- **Keyboard navigation** — arrow keys to move through the list, Enter to switch. No mouse required.
- **Active workspace highlight** — the popup always shows which workspace you're in, with tab count.
- **Confirm before delete** — no accidental workspace deletions.
- **Theme-aware icon** — split circle that adapts automatically: top-white/bottom-black on light toolbars, top-black/bottom-white on dark toolbars.
- **Keyboard shortcut** — `Ctrl+Shift+Y` (`Cmd+Shift+Y` on Mac).
- **Light and dark popup theme** — follows your system preference.
- **Restart persistence** — last active workspace is restored on Firefox restart. Other workspaces are rebuilt as hidden/unloaded tabs, loaded only when you visit them.

---

## How It Works

1. Click the Workflow01 icon (or press `Ctrl+Shift+Y`)
2. Type a workspace name and press **Enter** to create it
3. Your current tabs become that workspace — browse normally
4. To switch: click another workspace in the list (or arrow keys + Enter). Tabs are hidden instantly, target workspace tabs are shown. No reloads.
5. To create a new workspace: type a new name, press Enter. A fresh blank tab opens. Your previous workspace is untouched.

---

## Install

### From Firefox Add-ons

[addons.mozilla.org/en-US/firefox/addon/workflow01](https://addons.mozilla.org/en-US/firefox/addon/workflow01/)

### From source

1. Clone or download this repo
2. Open Firefox → `about:debugging#/runtime/this-firefox`
3. Click **Load Temporary Add-on…**
4. Select `manifest.json` from the repo folder

> **First use:** When you first switch a workspace, Firefox shows a one-time prompt: "An extension is hiding tabs." Click **Allow** — this is required for switching to work.

---

## Permissions

| Permission | Why it's needed |
|---|---|
| `tabs` | Read and manage tabs for workspace tracking |
| `tabHide` | Hide/show tabs when switching — without this every switch would reload all tabs |
| `storage` | Persist workspace data locally on your device |

No data is collected or sent anywhere. Everything stays on your machine.

---

## File Structure

```
workflow01/
├── manifest.json
├── background.js
├── popup.html
├── popup.js
└── icons/
    ├── icon-48.png          # Default fallback icon
    ├── icon-128.png
    ├── icon-day-48.png      # Light toolbar: top white, bottom black
    ├── icon-day-128.png
    ├── icon-night-48.png    # Dark toolbar: top black, bottom white
    └── icon-night-128.png
```

---

## Version History

### v3.2
- Fixed: tab duplication bug where switching caused the same tab to appear in multiple workspaces
- Fixed: spurious blank tabs appearing after workspace switch
- Fixed: `onCreated` listener double-assigning tabs created by internal operations
- Fixed: `onUpdated` debounced to prevent storage write races on rapid navigation

### v3.1
- Fixed: privileged URLs (`about:*`, `moz-extension://`, etc.) excluded from storage
- Fixed: empty workspace guard
- Fixed: restart reconciliation uses storage as source of truth
- Fixed: persist queue self-cleans after settling
- Added: "Switching…" overlay in popup during background operations
- Added: workspace name validation
- Added: keyboard navigation (arrow keys + Enter)
- Added: theme-aware split circle icon

### v3.0
- Complete rewrite: `tabs.hide()` / `tabs.show()` replaces close/recreate model
- Tabs no longer reload when switching workspaces
- New workspace creation no longer steals the active tab
- Removed export/import
- Added inline rename
- Compact popup design

### v2.0
- Initial public release

---

## License

[MIT](LICENSE)
