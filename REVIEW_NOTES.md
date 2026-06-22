# AMO Reviewer Notes

No build step is required. The submitted extension package is made directly from readable source files.

No minification, obfuscation, bundling, remote code, generated JavaScript, third-party libraries, analytics, telemetry, or network calls are used.

The extension stores workspace data locally using `browser.storage.local`.

The extension declares the existing AMO add-on ID:

```json
"id": "workflow01@remakr1.com"
```

The extension declares no data collection or transmission:

```json
"data_collection_permissions": {
  "required": ["none"]
}
```

The extension declares private browsing exclusion:

```json
"incognito": "not_allowed"
```

Permissions:

- `tabs`: required to read tab URLs/titles and restore tabs into workspaces.
- `storage`: required to persist workspace data locally.

No host permissions are requested. No content scripts are used.

## Android compatibility note

The manifest sets `browser_specific_settings.gecko_android.strict_min_version` to `142.0` because Firefox built-in data collection consent support starts at Firefox for Android 142.
