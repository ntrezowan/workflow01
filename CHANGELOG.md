# Changelog

## 5.3.3

- Added `browser_specific_settings.gecko_android.strict_min_version = "142.0"` to remove AMO Android data collection support warning.
- Kept desktop minimum at Firefox `140.0`.
- Kept existing AMO add-on ID `workflow01@remakr1.com`.


## 5.3.2

- Corrected AMO add-on ID to `workflow01@remakr1.com`.
- Kept Manifest V3 data collection declaration as `required: ["none"]`.

## 5.3.1

- Added required Manifest V3 Firefox add-on ID for AMO validation, but the generated ID did not match the existing AMO listing.
- Added `browser_specific_settings.gecko.data_collection_permissions.required = ["none"]`.

## 5.3.0

- Reworked workspace operations around transaction locking.
- Suppressed autosave during switch/create/delete/restore operations.
- Added safe replacement tab behavior to prevent closing the only Firefox window.
- Added startup restore of last active workspace.
- Changed new workspace creation so it starts blank and does not migrate the current tab.
- Changed active workspace deletion to switch to the previous workspace.
- Added private browsing exclusion with `incognito: not_allowed`.
- Kept pinned tabs workspace-specific.
- Added failed URL restore fallback to blank tab.
