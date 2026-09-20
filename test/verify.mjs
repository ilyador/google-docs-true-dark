import assert from "node:assert/strict";
import fs from "node:fs";

const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const controller = fs.readFileSync(new URL("../src/theme-controller.js", import.meta.url), "utf8");
const canvas = fs.readFileSync(new URL("../src/docs-canvas.js", import.meta.url), "utf8");
const docsUi = fs.readFileSync(new URL("../src/docs-ui.css", import.meta.url), "utf8");
const sheets = fs.readFileSync(new URL("../src/sheets-dark.css", import.meta.url), "utf8");

new Function(controller);
new Function(canvas);

const allMatches = manifest.content_scripts.flatMap((entry) => entry.matches);
assert(allMatches.includes("https://docs.google.com/document/*"));
assert(allMatches.includes("https://docs.google.com/spreadsheets/*"));
assert(!allMatches.some((pattern) => pattern.includes("/presentation/") || pattern.includes("drive.google.com")));

assert(!controller.includes("[class*='button'"));
assert(!controller.includes("[class*=\"button\""));
assert(!controller.includes("restyleChrome"));
assert.match(controller, /app === "docs"/);
assert.match(controller, /restoreInlineStyles\(\)/);

assert.match(canvas, /patchRecordedMethod\(proto, originals, "drawImage", null\)/);
assert(!canvas.includes('patchMethod(proto, originals, "drawImage"'));
assert.match(canvas, /const gradientVariants = new WeakMap\(\)/);
assert.match(canvas, /function adaptCanvasStyle\(style, role\)/);
assert.match(canvas, /const isSheets = window\.location\.pathname\.includes\("\/spreadsheets\/"\)/);
assert.match(canvas, /isSheets && isNeutral && luminance > 0\.30/);

assert.match(docsUi, /#docs-titlebar-share-client-button\s*\{/);
assert.match(docsUi, /#docs-titlebar-share-client-button > :is/);
assert.match(sheets, /#docs-branding-logo-link \*/);
assert.match(sheets, /#waffle-rich-text-editor/);
assert.match(sheets, /#t-formula-bar-input/);
assert.match(sheets, /#formula-bar-dragger/);
assert(!sheets.includes("canvas {\n  filter: invert"));
assert.match(
  sheets,
  /:is\(\s*\.grid-table-container,[\s\S]*?\.grid4-inner-container,[\s\S]*?\.waffle-background-container\s*\)\s*\{\s*background: transparent !important;/
);

console.log("Manifest scope, JavaScript syntax, UI selector safety, and image-preservation checks passed.");
