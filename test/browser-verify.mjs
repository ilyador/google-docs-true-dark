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
      page: getComputedStyle(page).backgroundColor,
      imageFilter: getComputedStyle(document.querySelector('.photo-row img')).filter
    };
  })()`);
  assert.equal(darkDoc.mode, "on");
  assert.equal(darkDoc.source, "color: #202124;");
  assert.equal(darkDoc.color, "rgb(232, 236, 242)");
  assert.equal(darkDoc.page, "rgb(23, 27, 34)");
  assert.equal(darkDoc.imageFilter, "none");
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
    track: getComputedStyle(document.querySelector('.goog-menu'), '::-webkit-scrollbar-track').backgroundColor
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
  await waitUntil(() => evaluate(`getComputedStyle(document.querySelector('.doc-line')).color === 'rgb(232, 236, 242)'`), "updated Docs color");
  assert.equal(await evaluate("document.querySelector('.doc-line').getAttribute('style')"), changedSource);

  await send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "light" }]
  });
  await waitUntil(() => evaluate("document.documentElement.getAttribute('data-gdt-dark') === 'off'"), "Docs light mode");
  const lightDoc = await evaluate(`(() => ({
    source: document.querySelector('.doc-line').getAttribute('style'),
    color: getComputedStyle(document.querySelector('.doc-line')).color,
    rulesRemoved: !document.querySelector('style[data-gdt-doc-colors]')
  }))()`);
  assert.equal(lightDoc.source, changedSource);
  assert.equal(lightDoc.color, "rgb(60, 64, 67)");
  assert(lightDoc.rulesRemoved);
  const lightDocsDetails = await evaluate(`(() => ({
    selected: getComputedStyle(document.querySelector('.left-sidebar-container [aria-selected="true"]')).backgroundColor,
    underline: getComputedStyle(document.querySelector('.fixture-underline')).textDecorationColor,
    strike: getComputedStyle(document.querySelector('.fixture-strike')).textDecorationColor
  }))()`);
  assert.equal(lightDocsDetails.selected, "rgb(54, 95, 150)");
  assert.equal(lightDocsDetails.underline, "rgb(32, 33, 36)");
  assert.equal(lightDocsDetails.strike, "rgb(32, 33, 36)");
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
      sidebar: getComputedStyle(document.querySelector('.docs-tiled-sidebar')).backgroundColor,
      comment: getComputedStyle(document.querySelector('.docos-docoview')).backgroundColor,
      imageFilter: getComputedStyle(document.querySelector('#sheet-image')).filter,
      docsRules: Boolean(document.querySelector('style[data-gdt-doc-colors]'))
    };
  })()`);
  assert.equal(sheet.app, "sheets");
  assert.equal(sheet.mode, "on");
  assert.equal(sheet.source, "background-color: rgb(255, 255, 255); color: rgb(0, 0, 0);");
  assert.equal(sheet.color, "rgb(232, 236, 242)");
  assert.equal(sheet.sidebar, "rgb(23, 26, 33)");
  assert.equal(sheet.comment, "rgb(35, 42, 53)");
  assert.equal(sheet.imageFilter, "none");
  assert.equal(sheet.docsRules, false);
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

  await send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "light" }]
  });
  await waitUntil(() => evaluate("document.documentElement.getAttribute('data-gdt-dark') === 'off'"), "Sheets light mode");
  const lightSheet = await evaluate(`(() => {
    const editor = document.querySelector('#waffle-rich-text-editor');
    return {
      source: editor.getAttribute('style'),
      color: getComputedStyle(editor).color,
      menu: getComputedStyle(document.querySelector('.fixture-font-menu')).backgroundColor,
      sidebar: getComputedStyle(document.querySelector('.docs-tiled-sidebar')).backgroundColor
    };
  })()`);
  assert.equal(lightSheet.source, sheet.source);
  assert.equal(lightSheet.color, "rgb(0, 0, 0)");
  assert.equal(lightSheet.menu, "rgb(255, 255, 255)");
  assert.equal(lightSheet.sidebar, "rgb(240, 244, 249)");
  await screenshot("gdt-sheets-light-verify.png");

  await send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "dark" }]
  });

  await navigate("share-fixture.html");
  await waitUntil(() => evaluate("document.querySelector('.fixture-share-panel')?.getAttribute('data-gdt-share-surface') === 'panel'"), "Share surface theme");
  const darkShare = await evaluate(`(() => ({
    panel: getComputedStyle(document.querySelector('.fixture-share-panel')).backgroundColor,
    title: getComputedStyle(document.querySelector('h2')).color,
    primary: getComputedStyle(document.querySelector('.primary')).backgroundColor,
    mailInput: getComputedStyle(document.querySelector('.fixture-mail-field input')).backgroundColor,
    mailPlaceholder: getComputedStyle(document.querySelector('.fixture-mail-placeholder')).backgroundColor,
    mailPlaceholderColor: getComputedStyle(document.querySelector('.fixture-mail-placeholder')).color,
    pseudoPlaceholder: getComputedStyle(document.querySelector('.YMNIz'), '::after').backgroundColor,
    nestedPlaceholder: getComputedStyle(document.querySelector('.fixture-nested-placeholder')).backgroundColor
  }))()`);
  assert.equal(darkShare.panel, "rgb(32, 36, 45)");
  assert.equal(darkShare.title, "rgb(232, 236, 242)");
  assert.equal(darkShare.primary, "rgb(11, 87, 208)");
  assert.equal(darkShare.mailInput, "rgb(23, 27, 34)");
  assert.equal(darkShare.mailPlaceholder, "rgb(23, 27, 34)");
  assert.equal(darkShare.mailPlaceholderColor, "rgb(174, 183, 196)");
  assert.equal(darkShare.pseudoPlaceholder, "rgb(23, 27, 34)");
  assert.equal(darkShare.nestedPlaceholder, "rgb(23, 27, 34)");
  await screenshot("gdt-share-dark-verify.png");

  await send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "light" }]
  });
  await waitUntil(() => evaluate("document.documentElement.getAttribute('data-gdt-share-dark') === 'off'"), "Share light mode");
  const lightShare = await evaluate(`(() => ({
    mode: document.documentElement.getAttribute('data-gdt-share-dark'),
    panel: getComputedStyle(document.querySelector('.fixture-share-panel')).backgroundColor,
    title: getComputedStyle(document.querySelector('h2')).color,
    mailPlaceholder: getComputedStyle(document.querySelector('.fixture-mail-placeholder')).backgroundColor,
    pseudoPlaceholder: getComputedStyle(document.querySelector('.YMNIz'), '::after').backgroundColor,
    nestedPlaceholder: getComputedStyle(document.querySelector('.fixture-nested-placeholder')).backgroundColor,
    marked: document.querySelectorAll('[data-gdt-share-surface]').length
  }))()`);
  assert.equal(lightShare.mode, "off");
  assert.equal(lightShare.panel, "rgb(255, 255, 255)");
  assert.equal(lightShare.title, "rgb(32, 33, 36)");
  assert.equal(lightShare.mailPlaceholder, "rgb(255, 255, 255)");
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
