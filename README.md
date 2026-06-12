# Workflow01

Single-window workspace manager for Firefox. Organize your tabs into named workspaces and switch between them instantly — without reloading.

[![Install from AMO](https://img.shields.io/badge/Install-Firefox%20Add--ons-FF7139?logo=firefox-browser&logoColor=white)](https://addons.mozilla.org/en-US/firefox/addon/workflow01/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Features

- **Zero-reload switching** — uses Firefox's native tab hide/show API. Switching workspaces never closes or recreates tabs. Your scroll position, form input, and media playback are exactly where you left them.
- **Live state preservation** — within a session, every tab stays alive in the background. Nothing reloads until Firefox itself decides to (e.g. memory pressure after long idle).
- **Fresh workspace creation** — creating a new workspace opens a single blank tab and switches to it. Nothing is stolen from your current workspace.
- **Inline rename** — hover any workspace row and click ✎ to rename in place.
- **Keyboard navigation** — Arrow keys to move through the workspace list, Enter to switch. No mouse required.
- **Active workspace highlight** — the popup always shows which workspace you're in, with tab count per workspace.
- **Confirm before delete** — no accidental workspace deletions.
- **Theme-aware icon** — split circle icon automatically adapts: top-white/bottom-black on light toolbars, top-black/bottom-white on dark toolbars.
- **Keyboard shortcut** — `Ctrl+Shift+Y` (`Cmd+Shift+Y` on Mac) to open the popup.
- **Light and dark theme** — popup follows your system preference automatically.
- **Restart persistence** — last active workspace is restored on Firefox restart. Other workspaces are rebuilt as hidden/discarded tabs (loaded lazily when first visited).

---

## How It Works

1. Click the Workflow01 icon in the toolbar (or press `Ctrl+Shift+Y`)
2. Type a workspace name and press **Enter** to create it
3. Your current tabs become that workspace — browse normally
4. To switch: click another workspace in the list (or use arrow keys + Enter). Your tabs are hidden instantly, the target workspace's tabs are shown. No reloads.
5. To create a new workspace: type a new name and press Enter. A fresh blank tab opens in the new workspace. Your previous workspace is untouched.

---

## Install

### From Firefox Add-ons (recommended)

[addons.mozilla.org/en-US/firefox/addon/workflow01](https://addons.mozilla.org/en-US/firefox/addon/workflow01/)

### From source (development / testing)

1. Clone or download this repo
2. Open Firefox → `about:debugging#/runtime/this-firefox`
3. Click **Load Temporary Add-on…**
4. Select `manifest.json` from the repo folder
5. The extension icon appears in your toolbar

> **First use:** When you first switch a workspace, Firefox shows a one-time prompt: *"An extension is hiding tabs."* Click **Allow** — this is required for the hide/show switching to work.

---

## Permissions

| Permission | Why it's needed |
|---|---|
| `tabs` | Read and manage tabs for workspace tracking |
| `tabHide` | Hide/show tabs when switching workspaces (the core mechanic — without this, switching would require closing and reloading every tab) |
| `storage` | Persist workspace data locally on your device |

**No data is collected or sent anywhere.** Everything stays on your machine.

---

## File Structure

```
workflow01/
├── manifest.json       # Extension manifest (MV3)
├── background.js       # Core logic: tab ownership, switching, persistence
├── popup.html          # Popup UI layout and styles
├── popup.js            # Popup interaction logic
└── icons/
    ├── icon-48.png         # Default icon (AMO listing / fallback)
    ├── icon-128.png        # Default icon (AMO listing / fallback)
    ├── icon-day-48.png     # Light toolbar variant (top white, bottom black)
    ├── icon-day-128.png
    ├── icon-night-48.png   # Dark toolbar variant (top black, bottom white)
    └── icon-night-128.png
```

---

## Architecture Notes

Workflow01 uses `tabs.hide()` / `tabs.show()` rather than closing and recreating tabs on workspace switches. All workspaces' tabs coexist in one window — active workspace tabs are visible, all others are hidden. This means:

- Tab IDs are stable within a session. Switching is instant and non-destructive.
- On restart, Firefox session-restores the last-active workspace's tabs visible. All other workspaces are materialized as hidden + discarded tabs (they exist but consume near-zero CPU until you visit them).
- Privileged pages (`about:`, `moz-extension://`, `view-source:`) are never persisted to storage, since Firefox can't recreate them via `tabs.create()`.

---

## Version History

### v3.1
- Fixed: privileged URLs (`about:*`, `moz-extension://`, etc.) no longer persisted to storage
- Fixed: empty workspace guard — if all tabs in a workspace are closed, a fresh blank tab is created automatically on next switch
- Fixed: bootstrap no longer blindly overwrites stored workspace URLs on restart (storage is now the source of truth, session restore is reconciled against it)
- Fixed: persist queue cleaned up after each operation (no unbounded map growth)
- Fixed: `strict_min_version` removed — clears both AMO validation warnings about `data_collection_permissions`
- Added: "Switching…" / "Creating…" overlay in popup while background operation completes
- Added: workspace name validation (max 40 chars, must contain a letter or number, no control characters)
- Added: keyboard navigation in popup (arrow keys + Enter)
- Added: theme-aware split circle icon via `theme_icons`

### v3.0
- Complete rewrite: switched from close/recreate model to `tabs.hide()` / `tabs.show()`
- Tabs no longer reload when switching workspaces
- New workspace creation no longer steals the active tab
- Removed export/import
- Added inline rename
- Compact popup row design

### v2.0
- Initial public release

---

## License

[MIT](LICENSE)
