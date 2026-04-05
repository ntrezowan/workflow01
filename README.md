# Workflow01

Single-window workspace manager for Firefox. Save, switch, and organize your tabs into named workspaces.

[![Install from AMO](https://img.shields.io/badge/Install-Firefox%20Add--ons-FF7139?logo=firefox-browser&logoColor=white)](https://addons.mozilla.org/en-US/firefox/addon/workflow01/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Features

- **Single-window workspace switching** — no extra windows cluttering your taskbar. Tabs are replaced in the same window when you switch.
- **Continuous automatic tab tracking** — tabs are saved every time you open, close, or navigate. No manual saving needed.
- **"No workspace" default on startup** — Firefox starts clean. You pick which workspace to load.
- **Active tab migration** — create a new workspace from your current tab. It moves to the new workspace and gets removed from the old one.
- **Active workspace highlight** — the popup always shows which workspace you're currently in.
- **Tab count per workspace** — see how many tabs each workspace has at a glance.
- **Confirm before delete** — no accidental workspace deletions.
- **Confirm before switch** — current tabs are saved before switching.
- **Export / Import** — back up your workspaces as JSON or move them between machines.
- **Keyboard shortcut** — `Ctrl+Shift+Y` (`Cmd+Shift+Y` on Mac) to open the popup.
- **Light and dark theme** — follows your system preference automatically.

---

## How It Works

1. Click the Workflow01 icon in the toolbar (or press `Ctrl+Shift+Y`)
2. Type a workspace name and press **Enter** to create one
3. Your current window becomes that workspace — browse normally
4. To switch: click another workspace name in the list. Your current tabs are saved, then replaced with the target workspace's tabs.
5. To split a tab into a new workspace: while on the tab you want to move, type a new workspace name and press Enter. That tab migrates to the new workspace.

---

## Install

### From Firefox Add-ons (recommended)

Install directly from [addons.mozilla.org/en-US/firefox/addon/workflow01](https://addons.mozilla.org/en-US/firefox/addon/workflow01/)

### From source (for development / testing)

1. Clone or download this repo
2. Open Firefox and go to `about:debugging#/runtime/this-firefox`
3. Click **"Load Temporary Add-on..."**
4. Select the `manifest.json` file from the repo folder
5. The extension icon appears in your toolbar

---

## Permissions

| Permission | Why it's needed |
|---|---|
| `tabs` | Read and manage tab URLs for saving and restoring workspaces |
| `storage` | Persist workspace data locally on your device |

**No data is collected or sent anywhere.** Everything stays on your machine. See the [Privacy Policy](https://addons.mozilla.org/en-US/firefox/addon/workflow01/) on AMO.

---

## File Structure

```
workflow01/
├── manifest.json    # Extension manifest (MV3)
├── background.js    # Core logic: tab tracking, workspace switching
├── popup.html       # Popup UI layout and styles
├── popup.js         # Popup interaction logic
└── icons/
    ├── icon-48.png
    └── icon-128.png
```

---

## Export / Import

- Click **📤 Export** in the popup to download all workspaces as a `.json` file
- Click **📥 Import** to load a previously exported file (imported workspaces merge with existing ones — same names get overwritten)

---

## License

[MIT](LICENSE)
