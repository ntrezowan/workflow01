# Workflow01

Single-window workspace manager for Firefox. Organize live tabs into named workspaces and switch between them without closing, recreating, or intentionally reloading tabs.

## Interface

- Native-looking Firefox popup using system colors instead of custom gradients.
- Simple current-workspace text block with smaller text and no banner color/image.
- Larger workspace rows for easier clicking.
- Click `+` to reveal the create-workspace form.
- Press `Enter` in the create form to create a workspace.
- Press `Escape` in the create form to hide it.
- Use arrow keys to highlight workspaces and `Enter` to switch.

## Behavior

- First workspace adopts currently visible non-pinned tabs.
- Later workspaces open one blank tab and do not steal tabs from the current workspace.
- Switching workspaces only hides and shows tabs.
- Workflow01 does not close, recreate, intentionally reload, or discard tabs.
- Pinned tabs are global because Firefox does not allow extensions to hide pinned tabs.

## Permissions

| Permission | Why it is needed |
|---|---|
| `tabs` | Read and manage browser tabs for workspace assignment and switching. |
| `tabHide` | Hide and show workspace tabs without closing or recreating tabs. |
| `storage` | Store workspace metadata and active workspace locally. |
| `sessions` | Store each tab's workspace ID on the tab so ownership can survive Firefox session restore. |

Workflow01 does not transmit user data outside Firefox.

## Local testing

1. Open Firefox.
2. Go to `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on…**.
4. Select `manifest.json` from the project folder.
5. If Firefox asks to allow hidden tabs, choose **Allow**.

## Version 5.2 changes

- Replaced the custom blue current-workspace banner with a simple native-style text block.
- Removed decorative image/gradient treatment from the current workspace area.
- Increased workspace row size for easier clicking.
- Kept the `+` create-workspace flow.
- Kept v5 workspace behavior: no tab stealing, no close/recreate switching, stable workspace IDs.

## License

MIT
