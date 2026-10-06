import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const chrome = process.env.GDT_CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
if (!fs.existsSync(chrome)) {
  throw new Error(`Chrome not found at ${chrome}. Set GDT_CHROME to its executable path.`);
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "gdt-chrome-verify-"));
const browser = spawn(chrome, [
  "--headless=new",
  "--disable-gpu",
  "--password-store=basic",
  "--use-mock-keychain",
  "--no-first-run",
  "--no-default-browser-check",
  `--user-data-dir=${profile}`,
  "--remote-debugging-port=0",
  "--window-size=1440,900",
  "about:blank"
], { stdio: "ignore" });

let socket;
try {
  const portFile = path.join(profile, "DevToolsActivePort");
  await waitUntil(() => fs.existsSync(portFile), "Chrome debugging port");
  const port = Number(fs.readFileSync(portFile, "utf8").split("\n")[0]);
  let page;
  await waitUntil(async () => {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    page = targets.find((target) => target.type === "page");
    return Boolean(page);
  }, "Chrome page");

  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) {
      return;
    }
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) {
      reject(new Error(message.error.message));
    } else {
      resolve(message.result);
    }
  });

  function send(method, params = {}) {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async function evaluate(expression) {
    const result = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text);
    }
    return result.result.value;
  }

  async function navigate(fixture, query = "") {
    const url = new URL(fixture, import.meta.url).href + query;
    await send("Page.navigate", { url });
    await waitUntil(() => evaluate(`location.href === ${JSON.stringify(url)} && document.readyState === "complete"`), fixture);
    await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  }

  async function screenshot(name) {
    const result = await send("Page.captureScreenshot", { format: "png" });
    const output = path.join(os.tmpdir(), name);
    fs.writeFileSync(output, Buffer.from(result.data, "base64"));
    console.log(`Screenshot: ${output}`);
  }

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "dark" }]
  });
  await navigate("fixture.html");
  await waitUntil(() => evaluate('document.querySelector("style[data-gdt-doc-colors]")?.sheet.cssRules.length > 0'), "Docs color rules");
  const darkDoc = await evaluate(`(() => {
    const text = document.querySelector('.doc-line[style*="color: #202124"]');
    const page = document.querySelector('.kix-page');
    return {
      mode: document.documentElement.getAttribute('data-gdt-dark'),
      source: text.getAttribute('style'),
      color: getComputedStyle(text).color,
      displayColor: getComputedStyle(text).webkitTextFillColor,
      page: getComputedStyle(page).backgroundColor,
      imageFilter: getComputedStyle(document.querySelector('.photo-row img')).filter
    };
  })()`);
  assert.equal(darkDoc.mode, "on");
  assert.equal(darkDoc.source, "color: #202124;");
  assert.equal(darkDoc.color, "rgb(32, 33, 36)");
  assert.equal(darkDoc.displayColor, "rgb(232, 236, 242)");
  assert.equal(darkDoc.page, "rgb(23, 27, 34)");
  assert.equal(darkDoc.imageFilter, "none");
  const sourceBeforeTyping = await evaluate("document.querySelector('#editable-source').getAttribute('style')");
  await evaluate("document.querySelector('#editable-source').focus()");
  await send("Input.insertText", { text: " More text." });
  const typedDoc = await evaluate(`(() => {
    const editor = document.querySelector('#editable-source');
    return {
      text: editor.textContent,
      source: editor.getAttribute('style'),
      color: getComputedStyle(editor).color,
      displayColor: getComputedStyle(editor).webkitTextFillColor
    };
  })()`);
  assert.match(typedDoc.text, /More text\./);
  assert.equal(typedDoc.source, sourceBeforeTyping);
  assert.equal(typedDoc.color, "rgb(32, 33, 36)");
  assert.equal(typedDoc.displayColor, "rgb(232, 236, 242)");
  const docsDetails = await evaluate(`(() => ({
    selected: getComputedStyle(document.querySelector('.left-sidebar-container [aria-selected="true"]')).backgroundColor,
    options: getComputedStyle(document.querySelector('[aria-label="Tab options"]')).backgroundColor,
    icon: getComputedStyle(document.querySelector('[aria-label="Tab options"] path')).fill,
    disabledBackground: getComputedStyle(document.querySelector('[aria-label="Back"]')).backgroundColor,
    disabledOpacity: getComputedStyle(document.querySelector('[aria-label="Back"]')).opacity,
    underline: getComputedStyle(document.querySelector('.fixture-underline')).textDecorationColor,
    strike: getComputedStyle(document.querySelector('.fixture-strike')).textDecorationColor,
    decoration: getComputedStyle(document.querySelector('.fixture-decoration-border')).borderBottomColor,
    shortcut: getComputedStyle(document.querySelector('.goog-menuitem-accel')).color,
    track: getComputedStyle(document.querySelector('.goog-menu'), '::-webkit-scrollbar-track').backgroundColor,
    menuRow: getComputedStyle(document.querySelector('#fixture-menu-normal')).backgroundColor,
    menuContent: getComputedStyle(document.querySelector('#fixture-menu-normal .goog-menuitem-content')).backgroundColor,
    menuHover: getComputedStyle(document.querySelector('.goog-menuitem-highlight')).backgroundColor,
    menuShadow: getComputedStyle(document.querySelector('.goog-menu')).boxShadow,
    submenuRowShadow: getComputedStyle(document.querySelector('.goog-menuitem.goog-submenu')).boxShadow,
    disabledMenuRow: getComputedStyle(document.querySelector('#fixture-menu-disabled')).backgroundColor,
    disabledMenuLabel: getComputedStyle(document.querySelector('#fixture-menu-disabled .goog-menuitem-label')).color,
    disabledMenuFill: getComputedStyle(document.querySelector('#fixture-menu-disabled .goog-menuitem-label')).webkitTextFillColor,
    disabledMenuShortcut: getComputedStyle(document.querySelector('#fixture-menu-disabled .goog-menuitem-accel')).color,
    navBackground: getComputedStyle(document.querySelector('.docs-navigation-tab-button')).backgroundColor,
    navIconFilter: getComputedStyle(document.querySelector('.docs-navigation-tab-button .docs-icon-img')).filter,
    miniCircle: getComputedStyle(document.querySelector('.fixture-mini-chapter')).backgroundColor,
    miniIcon: getComputedStyle(document.querySelector('.fixture-mini-chapter-glyph')).backgroundColor,
    miniMask: getComputedStyle(document.querySelector('.fixture-mini-chapter-glyph')).webkitMaskImage
  }))()`);
  assert.equal(docsDetails.selected, "rgb(48, 56, 70)");
  assert.equal(docsDetails.options, "rgba(0, 0, 0, 0)");
  assert.equal(docsDetails.icon, "rgb(220, 227, 237)");
  assert.equal(docsDetails.disabledBackground, "rgba(0, 0, 0, 0)");
  assert.equal(docsDetails.disabledOpacity, "0.68");
  assert.equal(docsDetails.underline, "rgb(232, 236, 242)");
  assert.equal(docsDetails.strike, "rgb(174, 183, 196)");
  assert.equal(docsDetails.decoration, "rgb(174, 183, 196)");
  assert.equal(docsDetails.shortcut, "rgb(174, 183, 196)");
  assert.equal(docsDetails.track, "rgba(0, 0, 0, 0)");
  assert.equal(docsDetails.menuRow, "rgba(0, 0, 0, 0)");
  assert.equal(docsDetails.menuContent, "rgba(0, 0, 0, 0)");
  assert.equal(docsDetails.menuHover, "rgb(42, 48, 59)");
  assert.notEqual(docsDetails.menuShadow, "none");
  assert.equal(docsDetails.submenuRowShadow, "none");
  assert.equal(docsDetails.disabledMenuRow, "rgba(0, 0, 0, 0)");
  assert.equal(docsDetails.disabledMenuLabel, "rgb(152, 163, 179)");
  assert.equal(docsDetails.disabledMenuFill, docsDetails.disabledMenuLabel);
  assert.equal(docsDetails.disabledMenuShortcut, docsDetails.disabledMenuLabel);
  assert.equal(docsDetails.navBackground, "rgb(42, 48, 59)");
  assert.notEqual(docsDetails.navIconFilter, "none");
  assert.equal(docsDetails.miniCircle, "rgb(37, 43, 54)");
  assert.equal(docsDetails.miniIcon, "rgb(220, 227, 237)");
  assert.match(docsDetails.miniMask, /^url\(/);
  const hoverCenter = await evaluate(`(() => {
    const rect = document.querySelector('#fixture-menu-normal').getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...hoverCenter });
  assert.equal(await evaluate("getComputedStyle(document.querySelector('#fixture-menu-normal')).backgroundColor"), "rgb(42, 48, 59)");
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0 });
  const canvasLinePixels = () => evaluate(`(() => {
    const context = document.querySelector('#canvas-doc').getContext('2d');
    const pixel = (x, y) => context.getImageData(Math.round(x), y, 1, 1).data[0];
    return {
      underline: pixel(28 + context.measureText('Under').width + context.measureText(' ').width / 2, 146),
      strike: pixel(280 + context.measureText('Completed').width + context.measureText(' ').width / 2, 139),
      border: pixel(300, 185)
    };
  })()`);
  const canvasControlPixels = () => evaluate(`(() => {
    const context = document.querySelector('#canvas-checkboxes').getContext('2d');
    const pixel = (x, y) => context.getImageData(x, y, 1, 1).data[0];
    const tickArea = context.getImageData(64, 21, 9, 10).data;
    let tickMin = 255;
    let tickMax = 0;
    for (let i = 0; i < tickArea.length; i += 4) {
      tickMin = Math.min(tickMin, tickArea[i]);
      tickMax = Math.max(tickMax, tickArea[i]);
    }
    return {
      empty: pixel(18, 25),
      checked: pixel(60, 25),
      tickMin,
      tickMax,
      ordinaryShape: pixel(110, 25),
      coloredShape: pixel(150, 25),
      background: pixel(25, 25)
    };
  })()`);
  const darkCanvasLines = await canvasLinePixels();
  assert(darkCanvasLines.underline > darkCanvasLines.border + 50, JSON.stringify(darkCanvasLines));
  assert(darkCanvasLines.strike > darkCanvasLines.border + 50, JSON.stringify(darkCanvasLines));
  const darkControls = await canvasControlPixels();
  assert(darkControls.empty > darkControls.ordinaryShape + 60, JSON.stringify(darkControls));
  assert(darkControls.checked > darkControls.ordinaryShape + 60, JSON.stringify(darkControls));
  assert(darkControls.tickMax > darkControls.ordinaryShape + 60, JSON.stringify(darkControls));
  assert(darkControls.background < 40, JSON.stringify(darkControls));
  const originalDecorationSources = await evaluate(`({
    underline: document.querySelector('.fixture-underline').getAttribute('style'),
    strike: document.querySelector('.fixture-strike').getAttribute('style')
  })`);
  await screenshot("gdt-docs-dark-verify.png");

  const changedSource = await evaluate(`(() => {
    const text = document.querySelector('.doc-line[style*="color: #202124"]');
    text.style.color = '#3c4043';
    return text.getAttribute('style');
  })()`);
  await waitUntil(() => evaluate(`getComputedStyle(document.querySelector('.doc-line')).webkitTextFillColor === 'rgb(232, 236, 242)'`), "updated Docs display color");
  assert.equal(await evaluate("document.querySelector('.doc-line').getAttribute('style')"), changedSource);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.doc-line')).color"), "rgb(60, 64, 67)");

  await send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "light" }]
  });
  await waitUntil(() => evaluate("document.documentElement.getAttribute('data-gdt-dark') === 'off'"), "Docs light mode");
  const lightDoc = await evaluate(`(() => ({
    source: document.querySelector('.doc-line').getAttribute('style'),
    color: getComputedStyle(document.querySelector('.doc-line')).color,
    displayColor: getComputedStyle(document.querySelector('.doc-line')).webkitTextFillColor,
    rulesRemoved: !document.querySelector('style[data-gdt-doc-colors]')
  }))()`);
  assert.equal(lightDoc.source, changedSource);
  assert.equal(lightDoc.color, "rgb(60, 64, 67)");
  assert.equal(lightDoc.displayColor, "rgb(60, 64, 67)");
  assert(lightDoc.rulesRemoved);
  const lightDocsDetails = await evaluate(`(() => ({
    selected: getComputedStyle(document.querySelector('.left-sidebar-container [aria-selected="true"]')).backgroundColor,
    underline: getComputedStyle(document.querySelector('.fixture-underline')).textDecorationColor,
    strike: getComputedStyle(document.querySelector('.fixture-strike')).textDecorationColor,
    menuRow: getComputedStyle(document.querySelector('#fixture-menu-normal')).backgroundColor,
    disabledMenuLabel: getComputedStyle(document.querySelector('#fixture-menu-disabled .goog-menuitem-label')).color,
    disabledMenuFill: getComputedStyle(document.querySelector('#fixture-menu-disabled .goog-menuitem-label')).webkitTextFillColor,
    navBackground: getComputedStyle(document.querySelector('.docs-navigation-tab-button')).backgroundColor,
    navIconFilter: getComputedStyle(document.querySelector('.docs-navigation-tab-button .docs-icon-img')).filter,
    miniCircle: getComputedStyle(document.querySelector('.fixture-mini-chapter')).backgroundColor,
    miniIcon: getComputedStyle(document.querySelector('.fixture-mini-chapter-glyph')).backgroundColor
  }))()`);
  assert.equal(lightDocsDetails.selected, "rgb(54, 95, 150)");
  assert.equal(lightDocsDetails.underline, "rgb(32, 33, 36)");
  assert.equal(lightDocsDetails.strike, "rgb(32, 33, 36)");
  assert.equal(lightDocsDetails.menuRow, "rgb(241, 243, 244)");
  assert.equal(lightDocsDetails.disabledMenuLabel, "rgb(32, 33, 36)");
  assert.equal(lightDocsDetails.disabledMenuFill, lightDocsDetails.disabledMenuLabel);
  assert.equal(lightDocsDetails.navBackground, "rgb(232, 234, 237)");
  assert.equal(lightDocsDetails.navIconFilter, "none");
  assert.equal(lightDocsDetails.miniCircle, "rgb(232, 234, 237)");
  assert.equal(lightDocsDetails.miniIcon, "rgb(68, 71, 70)");
  const lightCanvasLines = await canvasLinePixels();
  assert(lightCanvasLines.border > lightCanvasLines.underline + 60, JSON.stringify(lightCanvasLines));
  assert(lightCanvasLines.border > lightCanvasLines.strike + 35, JSON.stringify(lightCanvasLines));
  const lightControls = await canvasControlPixels();
  assert(Math.abs(lightControls.empty - lightControls.ordinaryShape) < 3, JSON.stringify(lightControls));
  assert(Math.abs(lightControls.checked - lightControls.ordinaryShape) < 3, JSON.stringify(lightControls));
  assert(Math.abs(lightControls.tickMin - lightControls.ordinaryShape) < 3, JSON.stringify(lightControls));
  assert(lightControls.background > 240, JSON.stringify(lightControls));
  assert.equal(lightControls.coloredShape, darkControls.coloredShape);
  const lightDecorationSources = await evaluate(`({
    underline: document.querySelector('.fixture-underline').getAttribute('style'),
    strike: document.querySelector('.fixture-strike').getAttribute('style')
  })`);
  assert.deepEqual(lightDecorationSources, originalDecorationSources);
  await screenshot("gdt-docs-light-verify.png");

  await send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "dark" }]
  });
  await waitUntil(() => evaluate("document.documentElement.getAttribute('data-gdt-dark') === 'on'"), "Docs dark mode restored");
  const restoredCanvasLines = await canvasLinePixels();
  assert(restoredCanvasLines.underline > restoredCanvasLines.border + 50, JSON.stringify(restoredCanvasLines));
  assert(restoredCanvasLines.strike > restoredCanvasLines.border + 50, JSON.stringify(restoredCanvasLines));
  const restoredControls = await canvasControlPixels();
  assert(restoredControls.empty > restoredControls.ordinaryShape + 60, JSON.stringify(restoredControls));
  assert(restoredControls.checked > restoredControls.ordinaryShape + 60, JSON.stringify(restoredControls));
  await navigate("spreadsheets/extension-fixture.html");
  const sheet = await evaluate(`(() => {
    const editor = document.querySelector('#waffle-rich-text-editor');
    return {
      app: document.documentElement.getAttribute('data-gdt-app'),
      mode: document.documentElement.getAttribute('data-gdt-dark'),
      source: editor.getAttribute('style'),
      color: getComputedStyle(editor).color,
      displayColor: getComputedStyle(editor).webkitTextFillColor,
      runColor: getComputedStyle(editor.firstElementChild).color,
      runDisplayColor: getComputedStyle(editor.firstElementChild).webkitTextFillColor,
      sidebar: getComputedStyle(document.querySelector('.docs-tiled-sidebar')).backgroundColor,
      comment: getComputedStyle(document.querySelector('.docos-docoview')).backgroundColor,
      imageFilter: getComputedStyle(document.querySelector('#sheet-image')).filter,
      docsRules: Boolean(document.querySelector('style[data-gdt-doc-colors]'))
    };
  })()`);
  assert.equal(sheet.app, "sheets");
  assert.equal(sheet.mode, "on");
  assert.equal(sheet.source, "background-color: rgb(255, 255, 255); color: rgb(0, 0, 0);");
  assert.equal(sheet.color, "rgb(0, 0, 0)");
  assert.equal(sheet.displayColor, "rgb(232, 236, 242)");
  assert.equal(sheet.runColor, "rgb(0, 0, 0)");
  assert.equal(sheet.runDisplayColor, "rgb(232, 236, 242)");
  assert.equal(sheet.sidebar, "rgb(23, 26, 33)");
  assert.equal(sheet.comment, "rgb(35, 42, 53)");
  assert.equal(sheet.imageFilter, "none");
  assert.equal(sheet.docsRules, false);
  const fillToolbarColors = () => evaluate(`(() => {
    const container = document.querySelector('.waffleMagicFillContainerWithAutofill');
    const left = container.querySelector('.waffleMagicFillOverGridMagicButton');
    const right = container.querySelector('.waffleMagicFillMagicFillAutofillButtonContainer');
    return {
      container: getComputedStyle(container).backgroundColor,
      left: getComputedStyle(left).backgroundColor,
      leftImage: getComputedStyle(left).backgroundImage,
      leftText: getComputedStyle(left.querySelector('.waffleMagicFillMagicFillText')).color,
      leftIcon: getComputedStyle(left.querySelector('path')).fill,
      rightIcon: getComputedStyle(right.querySelector('path')).fill,
      divider: getComputedStyle(container.querySelector('.waffleMagicFillAutofillDivider')).backgroundColor
    };
  })()`);
  const darkFill = await fillToolbarColors();
  assert.equal(darkFill.container, "rgb(35, 42, 53)");
  assert.equal(darkFill.left, "rgba(0, 0, 0, 0)");
  assert.equal(darkFill.leftText, "rgb(232, 236, 242)");
  assert.equal(darkFill.leftIcon, "rgb(232, 236, 242)");
  assert.equal(darkFill.rightIcon, "rgb(232, 236, 242)");
  assert.equal(darkFill.divider, "rgb(75, 86, 103)");
  const leftFillBounds = await evaluate(`(() => {
    const rect = document.querySelector('.waffleMagicFillOverGridMagicButton').getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...leftFillBounds });
  const hoveredFill = await fillToolbarColors();
  assert.equal(hoveredFill.left, "rgb(42, 48, 59)");
  assert.equal(hoveredFill.leftImage, "none");
  assert.equal(hoveredFill.leftText, darkFill.leftText);
  assert.equal(hoveredFill.leftIcon, darkFill.leftIcon);
  assert.equal(hoveredFill.rightIcon, darkFill.rightIcon);
  await screenshot("gdt-sheets-fill-hover-verify.png");
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0 });
  const sheetRunSource = await evaluate("document.querySelector('#waffle-rich-text-editor span').getAttribute('style')");
  await evaluate("document.querySelector('#waffle-rich-text-editor').focus()");
  await send("Input.insertText", { text: " More text." });
  const typedSheet = await evaluate(`(() => {
    const editor = document.querySelector('#waffle-rich-text-editor');
    return {
      text: editor.textContent,
      source: editor.getAttribute('style'),
      runSource: editor.querySelector('span').getAttribute('style')
    };
  })()`);
  assert.match(typedSheet.text, /More text\./);
  assert.equal(typedSheet.source, sheet.source);
  assert.equal(typedSheet.runSource, sheetRunSource);
  const fontMenu = await evaluate(`(() => {
    const menu = document.querySelector('.fixture-font-menu');
    return {
      background: getComputedStyle(menu).backgroundColor,
      track: getComputedStyle(menu, '::-webkit-scrollbar-track').backgroundColor,
      corner: getComputedStyle(menu, '::-webkit-scrollbar-corner').backgroundColor,
      arrow: getComputedStyle(menu.querySelector('.goog-submenu-arrow')).color,
      scrollable: menu.scrollHeight > menu.clientHeight
    };
  })()`);
  assert.equal(fontMenu.background, "rgb(35, 42, 53)");
  assert.equal(fontMenu.track, "rgba(0, 0, 0, 0)");
  assert.equal(fontMenu.corner, "rgba(0, 0, 0, 0)");
  assert.equal(fontMenu.arrow, "rgb(174, 183, 196)");
  assert(fontMenu.scrollable);
  await screenshot("gdt-sheets-font-menu-verify.png");

  await navigate("spreadsheets/extension-fixture.html", "?formula");
  const formulaColors = await evaluate(`(() => {
    const editor = document.querySelector('#waffle-rich-text-editor');
    const reference = editor.querySelector('[style*="color:#e89100"]');
    const ordinary = editor.querySelector('.default-formula-text-color');
    return {
      referenceSource: reference.getAttribute('style'),
      referenceColor: getComputedStyle(reference).color,
      referenceDisplayColor: getComputedStyle(reference).webkitTextFillColor,
      ordinaryDisplayColor: getComputedStyle(ordinary).webkitTextFillColor
    };
  })()`);
  assert.equal(formulaColors.referenceSource, "color:#e89100;");
  assert.equal(formulaColors.referenceColor, "rgb(232, 145, 0)");
  assert.equal(formulaColors.referenceDisplayColor, "rgb(232, 145, 0)");
  assert.equal(formulaColors.ordinaryDisplayColor, "rgb(232, 236, 242)");
  await screenshot("gdt-sheets-formula-verify.png");

  await send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "light" }]
  });
  await waitUntil(() => evaluate("document.documentElement.getAttribute('data-gdt-dark') === 'off'"), "Sheets light mode");
  const lightSheet = await evaluate(`(() => {
    const editor = document.querySelector('#waffle-rich-text-editor');
    return {
      source: editor.getAttribute('style'),
      color: getComputedStyle(editor).color,
      displayColor: getComputedStyle(editor).webkitTextFillColor,
      menu: getComputedStyle(document.querySelector('.fixture-font-menu')).backgroundColor,
      sidebar: getComputedStyle(document.querySelector('.docs-tiled-sidebar')).backgroundColor
    };
  })()`);
  assert.equal(lightSheet.source, sheet.source);
  assert.equal(lightSheet.color, "rgb(0, 0, 0)");
  assert.equal(lightSheet.displayColor, "rgb(0, 0, 0)");
  assert.equal(lightSheet.menu, "rgb(255, 255, 255)");
  assert.equal(lightSheet.sidebar, "rgb(240, 244, 249)");
  const lightFill = await fillToolbarColors();
  assert.equal(lightFill.container, "rgb(248, 250, 253)");
  assert.equal(lightFill.left, "rgb(248, 250, 253)");
  assert.equal(lightFill.leftText, "rgb(31, 31, 31)");
  assert.equal(lightFill.leftIcon, "rgb(31, 31, 31)");
  assert.equal(lightFill.rightIcon, "rgb(31, 31, 31)");
  assert.equal(lightFill.divider, "rgb(218, 218, 218)");
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...leftFillBounds });
  const lightHoveredFill = await fillToolbarColors();
  assert.match(lightHoveredFill.leftImage, /^linear-gradient\(/);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0 });
  await screenshot("gdt-sheets-light-verify.png");

  await send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "dark" }]
  });

  await navigate("share-fixture.html");
  await waitUntil(() => evaluate("document.querySelector('.fixture-share-panel')?.getAttribute('data-gdt-share-surface') === 'panel'"), "Share surface theme");
  await waitUntil(() => evaluate("document.querySelector('.fixture-suggestion-content')?.getAttribute('data-gdt-share-surface') === 'control'"), "Share suggestion theme");
  await waitUntil(() => evaluate("document.querySelector('.fixture-access-row')?.hasAttribute('data-gdt-share-divider')"), "Share divider theme");
  await waitUntil(() => evaluate("document.querySelector('.fixture-restricted-icon')?.getAttribute('data-gdt-share-surface') === 'icon'"), "Share access icon theme");
  const darkShare = await evaluate(`(() => ({
    panel: getComputedStyle(document.querySelector('.fixture-share-panel')).backgroundColor,
    title: getComputedStyle(document.querySelector('h2')).color,
    primary: getComputedStyle(document.querySelector('.primary')).backgroundColor,
    mailField: getComputedStyle(document.querySelector('.I9OJHe')).backgroundColor,
    mailInput: getComputedStyle(document.querySelector('#fixture-mail-input')).backgroundColor,
    mailLabel: getComputedStyle(document.querySelector('.snByac')).backgroundColor,
    mailLabelText: getComputedStyle(document.querySelector('.o8tTsf')).color,
    mailLabelInner: getComputedStyle(document.querySelector('.o8tTsf')).backgroundColor,
    suggestions: getComputedStyle(document.querySelector('.fixture-suggestions')).backgroundColor,
    suggestionRow: getComputedStyle(document.querySelector('[role="option"]')).backgroundColor,
    suggestionInner: getComputedStyle(document.querySelector('.fixture-suggestion-content')).backgroundColor,
    suggestionText: getComputedStyle(document.querySelector('.fixture-suggestion-content')).color,
    suggestionAvatar: getComputedStyle(document.querySelector('.fixture-suggestion-avatar')).backgroundColor,
    divider: getComputedStyle(document.querySelector('.fixture-access-row')).borderTopColor,
    accessIcon: getComputedStyle(document.querySelector('.fixture-restricted-icon')).backgroundColor,
    pseudoPlaceholder: getComputedStyle(document.querySelector('.fixture-pseudo-field .YMNIz'), '::after').backgroundColor,
    nestedPlaceholder: getComputedStyle(document.querySelector('.fixture-nested-placeholder')).backgroundColor
  }))()`);
  assert.equal(darkShare.panel, "rgb(32, 36, 45)");
  assert.equal(darkShare.title, "rgb(232, 236, 242)");
  assert.equal(darkShare.primary, "rgb(11, 87, 208)");
  assert.equal(darkShare.mailField, darkShare.panel);
  assert.equal(darkShare.mailInput, "rgba(0, 0, 0, 0)");
  assert.equal(darkShare.mailLabel, "rgb(32, 36, 45)");
  assert.equal(darkShare.mailLabelText, "rgb(174, 183, 196)");
  assert.equal(darkShare.mailLabelInner, "rgb(32, 36, 45)");
  assert.equal(darkShare.suggestions, "rgb(32, 36, 45)");
  assert.equal(darkShare.suggestionRow, "rgb(32, 36, 45)");
  assert.equal(darkShare.suggestionInner, "rgb(32, 36, 45)");
  assert.equal(darkShare.suggestionText, "rgb(232, 236, 242)");
  assert.equal(darkShare.suggestionAvatar, "rgb(88, 105, 186)");
  assert.equal(darkShare.divider, "rgb(70, 80, 95)");
  assert.equal(darkShare.accessIcon, "rgb(48, 56, 70)");
  assert.equal(darkShare.pseudoPlaceholder, darkShare.panel);
  assert.equal(darkShare.nestedPlaceholder, darkShare.panel);
  const floatingLabel = await evaluate(`(() => {
    const field = document.querySelector('.I9OJHe');
    field.setAttribute('data-floating', 'true');
    const color = getComputedStyle(field.querySelector('.snByac')).backgroundColor;
    field.removeAttribute('data-floating');
    return color;
  })()`);
  assert.equal(floatingLabel, darkShare.mailField);
  await evaluate(`(() => {
    const option = document.createElement('li');
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', 'true');
    option.innerHTML = '<div class="fixture-suggestion-content">New suggestion</div>';
    document.querySelector('.fixture-suggestions').append(option);
  })()`);
  await waitUntil(() => evaluate(`document.querySelector('[role="option"][aria-selected="true"] .fixture-suggestion-content')?.getAttribute('data-gdt-share-surface') === 'control'`), "dynamic Share suggestion theme");
  const selectedSuggestion = await evaluate(`(() => ({
    row: getComputedStyle(document.querySelector('[role="option"][aria-selected="true"]')).backgroundColor,
    content: getComputedStyle(document.querySelector('[role="option"][aria-selected="true"] .fixture-suggestion-content')).backgroundColor
  }))()`);
  assert.equal(selectedSuggestion.row, "rgb(48, 56, 70)");
  assert.equal(selectedSuggestion.content, "rgb(48, 56, 70)");
  await screenshot("gdt-share-dark-verify.png");

  await send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "light" }]
  });
  await waitUntil(() => evaluate("document.documentElement.getAttribute('data-gdt-share-dark') === 'off'"), "Share light mode");
  const lightShare = await evaluate(`(() => ({
    mode: document.documentElement.getAttribute('data-gdt-share-dark'),
    panel: getComputedStyle(document.querySelector('.fixture-share-panel')).backgroundColor,
    title: getComputedStyle(document.querySelector('h2')).color,
    mailField: getComputedStyle(document.querySelector('.I9OJHe')).backgroundColor,
    mailInput: getComputedStyle(document.querySelector('#fixture-mail-input')).backgroundColor,
    mailLabel: getComputedStyle(document.querySelector('.snByac')).backgroundColor,
    suggestions: getComputedStyle(document.querySelector('.fixture-suggestions')).backgroundColor,
    suggestionRow: getComputedStyle(document.querySelector('[role="option"]')).backgroundColor,
    suggestionInner: getComputedStyle(document.querySelector('.fixture-suggestion-content')).backgroundColor,
    divider: getComputedStyle(document.querySelector('.fixture-access-row')).borderTopColor,
    accessIcon: getComputedStyle(document.querySelector('.fixture-restricted-icon')).backgroundColor,
    pseudoPlaceholder: getComputedStyle(document.querySelector('.fixture-pseudo-field .YMNIz'), '::after').backgroundColor,
    nestedPlaceholder: getComputedStyle(document.querySelector('.fixture-nested-placeholder')).backgroundColor,
    marked: document.querySelectorAll('[data-gdt-share-surface], [data-gdt-share-divider]').length
  }))()`);
  assert.equal(lightShare.mode, "off");
  assert.equal(lightShare.panel, "rgb(255, 255, 255)");
  assert.equal(lightShare.title, "rgb(32, 33, 36)");
  assert.equal(lightShare.mailField, "rgb(255, 255, 255)");
  assert.equal(lightShare.mailInput, "rgb(255, 255, 255)");
  assert.equal(lightShare.mailLabel, "rgb(255, 255, 255)");
  assert.equal(lightShare.suggestions, "rgb(241, 246, 255)");
  assert.equal(lightShare.suggestionRow, "rgb(241, 246, 255)");
  assert.equal(lightShare.suggestionInner, "rgb(241, 246, 255)");
  assert.equal(lightShare.divider, "rgb(255, 255, 255)");
  assert.equal(lightShare.accessIcon, "rgb(244, 246, 251)");
  assert.equal(lightShare.pseudoPlaceholder, "rgb(255, 255, 255)");
  assert.equal(lightShare.nestedPlaceholder, "rgb(255, 255, 255)");
  assert.equal(lightShare.marked, 0);
  await screenshot("gdt-share-light-verify.png");

  console.log("Chrome dark/light rendering, Docs/Sheets source-style preservation, and nested Share checks passed.");
} finally {
  socket?.close();
  if (browser.exitCode === null && browser.signalCode === null) {
    const stopped = new Promise((resolve) => browser.once("exit", resolve));
    browser.kill();
    await stopped;
  }
  fs.rmSync(profile, { recursive: true, force: true });
}

async function waitUntil(check, label) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      if (await check()) {
        return;
      }
    } catch (_error) {
      // The page may still be navigating.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label}`);
}
