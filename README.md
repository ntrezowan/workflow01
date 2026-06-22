# Workflow01

Single-window workspace manager for Firefox. Save, switch, restore, and organize tabs into named workspaces.

## AMO validation fix in 5.3.3

This version uses the existing AMO add-on ID:

```json
"id": "workflow01@remakr1.com"
```

The previous package used the wrong ID and AMO rejected it with an ID mismatch.

## AMO manifest metadata

```json
"browser_specific_settings": {
  "gecko": {
    "id": "workflow01@remakr1.com",
    "strict_min_version": "140.0",
    "data_collection_permissions": {
      "required": ["none"]
    }
  },
  "gecko_android": {
    "strict_min_version": "142.0"
  }
}
```

## Behavior

- Restores the last active workspace on Firefox startup.
- Does not intentionally create a second Firefox window.
- Ignores private windows using `incognito: not_allowed`.
- Uses transaction locking during switch/create/delete/restore.
- Creates a safe replacement tab before removing visible tabs.
- Creating a new workspace does not move the current tab out of the previous workspace.
- New workspaces are logically empty but visually show a new tab.
- Deleting the active workspace switches to the previous workspace.
- Pinned tabs are workspace-specific.
- Failed privileged URL restore falls back to `about:blank`.

## Permissions

- `tabs`: read and manage tab URLs, tab titles, pinned state, muted state, and active tab order for workspace save/restore.
- `storage`: persist workspace data locally in Firefox extension storage.

No host permissions, no content scripts, no remote code, no analytics, no telemetry.

## License

MIT
