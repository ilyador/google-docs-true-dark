# Google Docs True Dark

An unpacked Chrome extension that applies a system-aware dark theme only on Google Docs document URLs.

## Install

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select this folder: `/Users/admin.ilya.dorman/Dev/google-docs-true-dark`.
5. If Chrome shows a site access prompt, allow it for Google Docs.

The extension follows your OS appearance with `prefers-color-scheme`. It does not run on Google Sheets, Drive, Slides, or Docs home pages outside `/document/*`.

## What It Does

- Scopes the content script to `https://docs.google.com/document/*`.
- Applies dark colors to Docs chrome, menus, dialogs, toolbar, rulers, comments, version history, sidebars, smart chips, and document pages.
- Adapts inline document colors by role: foreground text is lightened, pale backgrounds become dark tinted surfaces, and borders become dark dividers.
- Patches Docs canvas drawing calls in the page's main JavaScript world at `document_start`, so canvas-rendered text and page fills are recolored before Google Docs paints them.
- Keeps a bounded replay log for each canvas tile so switching back to light mode repaints existing canvas pixels with the original light colors.
- Leaves images, videos, canvas image draws, and background images uninverted.
- In light mode, the dark CSS no longer matches, inline style edits are restored, and the canvas hook stops recoloring new draw calls.

## Local Smoke Test

Open this file in Chrome:

`/Users/admin.ilya.dorman/Dev/google-docs-true-dark/test/fixture.html`

The fixture forces dark mode and includes Docs-like toolbar, menu, page content, comments, version history, inline colors, a photo, and canvas-rendered text.
