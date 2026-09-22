# Google Docs & Sheets True Dark

An unpacked Chrome extension that applies a system-aware dark theme to Google Docs documents and Google Sheets spreadsheets.

## Install

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select this folder: `/Users/admin.ilya.dorman/Dev/google-docs-true-dark`.
5. If Chrome shows a site access prompt, allow it for Google Docs and Sheets.

The extension follows your OS appearance with `prefers-color-scheme`. It runs on `/document/*`, `/spreadsheets/*`, and their embedded `/drivesharing/*` Share panels; Drive, Slides, Forms, and the Docs/Sheets home screens are not themed.

## What It Does

- Scopes content scripts to `https://docs.google.com/document/*` and `https://docs.google.com/spreadsheets/*`.
- Applies dark colors to Docs chrome, menus, dialogs, toolbar, rulers, comments, version history, sidebars, smart chips, and document pages.
- Covers Sheets chrome, menus, formula bar, grid, sheet tabs, comments, dialogs, and tiled/companion sidebars.
- Themes the temporary Sheets cell editor, formula preview, and Share panel without changing saved cell formatting.
- Adapts document and spreadsheet canvas colors by role: foreground text is lightened, pale backgrounds become dark tinted surfaces, and borders become dark dividers.
- Patches 2D canvas drawing calls in the page's main JavaScript world at `document_start`, so Docs and Sheets colors are mapped before Google paints them.
- Keeps a bounded replay log for each canvas tile so switching back to light mode repaints existing canvas pixels with the original light colors.
- Leaves images, videos, charts rendered through `drawImage`, and background images uninverted.
- Restricts inline color adaptation to the Docs editor. It does not rewrite Sheets cell-editor styles, avoiding accidental persistence of dark-mode colors into sheet data.
- In light mode, dark CSS stops matching, scoped Docs inline edits are restored, and the canvas hook stops recoloring new draw calls.

## Local Smoke Test

Open these files in Chrome:

`/Users/admin.ilya.dorman/Dev/google-docs-true-dark/test/fixture.html`

`/Users/admin.ilya.dorman/Dev/google-docs-true-dark/test/spreadsheets/extension-fixture.html`

`/Users/admin.ilya.dorman/Dev/google-docs-true-dark/test/share-fixture.html`

The fixtures cover Docs/Sheets chrome, semantic canvas colors, the active cell and formula preview, sidebars, the Share panel, and an image drawn without recoloring. Add `?gdt_force_dark=1` to the Docs or Sheets fixture to force dark mode, `&formula=1` to the Sheets fixture to show formula editing, or `?dark=1` to the Share fixture. Light-mode fixtures omit those dark-mode parameters.
