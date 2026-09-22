import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const controller = fs.readFileSync(new URL("../src/theme-controller.js", import.meta.url), "utf8");
const canvas = fs.readFileSync(new URL("../src/docs-canvas.js", import.meta.url), "utf8");
const docsUi = fs.readFileSync(new URL("../src/docs-ui.css", import.meta.url), "utf8");
const sheets = fs.readFileSync(new URL("../src/sheets-dark.css", import.meta.url), "utf8");
const shareController = fs.readFileSync(new URL("../src/share-controller.js", import.meta.url), "utf8");
const shareCss = fs.readFileSync(new URL("../src/share-dark.css", import.meta.url), "utf8");

new Function(controller);
new Function(canvas);
new Function(shareController);

const allMatches = manifest.content_scripts.flatMap((entry) => entry.matches);
assert.equal(manifest.host_permissions, undefined);
assert(allMatches.includes("https://docs.google.com/document/*"));
assert(allMatches.includes("https://docs.google.com/spreadsheets/*"));
assert(!allMatches.some((pattern) => pattern.includes("/presentation/") || pattern.includes("drive.google.com")));
assert(allMatches.includes("https://docs.google.com/drivesharing/*"));

assert(!controller.includes("[class*='button'"));
assert(!controller.includes("[class*=\"button\""));
assert(!controller.includes("restyleChrome"));
assert.match(controller, /app === "docs"/);
assert.match(controller, /function registerColorRule\(element\)/);
assert.match(controller, /colorStyle\.sheet\.insertRule\(rule\)/);
assert.match(controller, /function clearColorRules\(\)/);
assert(!controller.includes("element.style.setProperty"));
assert(!controller.includes("styleMemory"));

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
assert.match(sheets, /\.input-box:has\(> #waffle-rich-text-editor\)/);
assert.match(sheets, /\[style\*=";color:#000"\]/);
assert.match(sheets, /#t-formula-bar-input/);
assert.match(sheets, /#formula-bar-dragger/);
assert(!sheets.includes("  .goog-submenu,\n"));
assert.match(sheets, /\.goog-submenu-arrow/);
assert.match(sheets, /\.waffle-formula-preview-decorator/);
assert(!sheets.includes("canvas {\n  filter: invert"));
assert.match(
  sheets,
  /:is\(\s*\.grid-table-container,[\s\S]*?\.grid4-inner-container,[\s\S]*?\.waffle-background-container\s*\)\s*\{\s*background: transparent !important;/
);
assert.match(shareController, /\(document\|spreadsheets\)/);
assert.match(shareController, /data-gdt-share-dark/);
assert.match(shareController, /data-gdt-share-surface/);
assert.match(shareCss, /html\[data-gdt-share-dark="on"\]/);
assert.match(shareCss, /\[data-gdt-share-surface="panel"\]/);
assert(!shareCss.includes('html[data-gdt-share-dark="on"] body *'));

function runShareController(referrer, frameUrl, inFrame = true) {
  const attributes = new Map();
  const media = { matches: true, addEventListener(_type, listener) { this.listener = listener; } };
  const window = { top: inFrame ? {} : null, matchMedia: () => media, addEventListener() {} };
  if (!inFrame) window.top = window;
  vm.runInNewContext(shareController, {
    window,
    location: new URL(frameUrl),
    document: {
      referrer,
      documentElement: { setAttribute: (name, value) => attributes.set(name, value) },
      addEventListener() {}
    },
    URL,
    URLSearchParams
  });
  return { attributes, media };
}

const shareUrl = "https://docs.google.com/drivesharing/driveshare?foreignService=ritz&origin=https%3A%2F%2Fdocs.google.com";
const shareFromSheets = runShareController("https://docs.google.com/spreadsheets/d/example/edit", shareUrl);
assert.equal(shareFromSheets.attributes.get("data-gdt-share-dark"), "on");
shareFromSheets.media.matches = false;
shareFromSheets.media.listener();
assert.equal(shareFromSheets.attributes.get("data-gdt-share-dark"), "off");
assert.equal(runShareController("https://docs.google.com/document/d/example/edit", shareUrl).attributes.get("data-gdt-share-dark"), "on");
assert.equal(runShareController("", shareUrl).attributes.get("data-gdt-share-dark"), "on");
assert.equal(runShareController("https://drive.google.com/drive/u/0/my-drive", "https://docs.google.com/drivesharing/driveshare?foreignService=drive").attributes.size, 0);
assert.equal(runShareController("https://drive.google.com/drive/u/0/my-drive", shareUrl).attributes.size, 0);
assert.equal(runShareController("https://docs.google.com/spreadsheets/d/example/edit", shareUrl, false).attributes.size, 0);

console.log("Manifest scope, JavaScript syntax, UI selector safety, and image-preservation checks passed.");
