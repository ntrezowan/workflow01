# Workflow01 v5.2 — Firefox Submission Changelog

## User-visible changes

- Updated popup styling to look closer to native Firefox panels.
- Removed custom color/image treatment from the current-workspace banner.
- Current workspace now appears as a simple text block with smaller text.
- Workspace rows are larger for easier clicking.
- Kept the `+` button create-workspace flow.

## Behavior retained

- Creating a new workspace after the first workspace opens a fresh blank tab and does not move the active tab out of the current workspace.
- Switching workspaces uses Firefox tab visibility: tabs are shown or hidden, not closed and recreated.
- Workspace switching does not intentionally reload or discard tabs.
- Existing tabs remain in their assigned workspaces when switching between workspaces such as `f5` and `ansible`.
- Pinned tabs remain global and visible in all workspaces because Firefox does not allow pinned tabs to be hidden.

## Reviewer notes

- The extension uses only local WebExtension APIs: `tabs`, `tabHide`, `storage`, and `sessions`.
- The extension does not transmit user data outside Firefox.
- The extension does not use remote code.
- The extension does not use minified, obfuscated, generated, or bundled JavaScript.
- The extension does not intentionally discard tabs or reload tabs during workspace switching.
