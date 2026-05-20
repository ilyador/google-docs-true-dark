(() => {
  "use strict";

  if (window.__gdtContentLoaded) {
    return;
  }
  window.__gdtContentLoaded = true;

  const ROOT_ATTR = "data-gdt-dark";
  const PAGE_MODE_ATTR = "data-gdt-page-dark";
  const FIXTURE_ATTR = "data-gdt-fixture";
  const FORCE_PARAM = "gdt_force_dark";
  const RUNTIME_STYLE_ID = "gdt-runtime-chrome-css";
  const MAX_INLINE_ELEMENTS_PER_SCAN = 20000;
  const MEDIA = window.matchMedia("(prefers-color-scheme: dark)");
  const forcedDark = getForcedDark();
  const colorTools = createColorTools();
  const touchedElements = new Set();
  const styleMemory = new WeakMap();
  const chromeTouchedElements = new Set();
  const chromeStyleMemory = new WeakMap();
  const scanQueue = new Set();
  let scanFrame = 0;
  let chromeFrame = 0;
  let darkEnabled = false;
  let observer = null;

  install();

  function install() {
    ensureRuntimeCss();
    applyMode();

    if (typeof MEDIA.addEventListener === "function") {
      MEDIA.addEventListener("change", applyMode);
    } else if (typeof MEDIA.addListener === "function") {
      MEDIA.addListener(applyMode);
    }

    if (document.documentElement) {
      observer = new MutationObserver(handleMutations);
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["style", "class"]
      });
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        ensureRuntimeCss();
        scheduleScan(document.documentElement);
        scheduleChromeRestyle();
      }, { once: true });
    } else {
      scheduleScan(document.documentElement);
      scheduleChromeRestyle();
    }
  }

  function getForcedDark() {
    try {
      return new URLSearchParams(window.location.search).has(FORCE_PARAM) ||
        document.documentElement.hasAttribute(FIXTURE_ATTR);
    } catch (_error) {
      return document.documentElement.hasAttribute(FIXTURE_ATTR);
    }
  }

  function isDark() {
    return forcedDark || MEDIA.matches;
  }

  function applyMode() {
    darkEnabled = isDark();
    const root = document.documentElement;
    if (!root) {
      return;
    }

    root.setAttribute(ROOT_ATTR, darkEnabled ? "on" : "off");
    root.setAttribute(PAGE_MODE_ATTR, darkEnabled ? "1" : "0");
    document.dispatchEvent(new CustomEvent("gdt-dark-mode-change", { detail: { dark: darkEnabled } }));

    if (darkEnabled) {
      ensureRuntimeCss();
      scheduleScan(root);
      queueChromeRestyles();
      requestRepaint();
    } else {
      restoreInlineStyles();
      restoreChromeStyles();
      requestRepaint();
    }
  }

  function handleMutations(records) {
    if (!darkEnabled) {
      return;
    }

    for (const record of records) {
      if (record.type === "attributes") {
        if (record.target instanceof HTMLElement) {
          scheduleScan(record.target);
          scheduleChromeRestyle();
        }
        continue;
      }

      for (const node of record.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          scheduleScan(node);
          scheduleChromeRestyle();
        }
      }
    }
  }

  function ensureRuntimeCss() {
    const root = document.documentElement;
    if (!root) {
      return;
    }

    let style = document.getElementById(RUNTIME_STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = RUNTIME_STYLE_ID;
      style.textContent = `
html[data-gdt-dark="on"] {
  --gdt-topbar: #171a21;
  --gdt-topbar-text: #eaf0f8;
  --gdt-topbar-line: #343b47;
  --gdt-topbar-hover: rgba(120, 168, 255, 0.12);
}

html[data-gdt-dark="on"] :is(#docs-titlebar,#docs-titlebar-container,.docs-titlebar,.docs-titlebar-buttons,.docs-titlebar-badges) {
  background-color: var(--gdt-topbar) !important;
  border-color: var(--gdt-topbar-line) !important;
  box-shadow: none !important;
  color: var(--gdt-topbar-text) !important;
}

html[data-gdt-dark="on"] :is(.docs-title-input,.docs-title-input-label,.docs-title-input-label-inner,.docs-title-input-wrapper,.docs-title-widget,.docs-title-outer,.docs-title-inner,.docs-title-inline-rename,.docs-titlebar-badge,.docs-titlebar-badge-container) {
  background: transparent !important;
  background-color: transparent !important;
  border: 0 !important;
  box-shadow: none !important;
  color: var(--gdt-topbar-text) !important;
  opacity: 1 !important;
  outline: none !important;
}

html[data-gdt-dark="on"] :is(#docs-menubar,.docs-menubar,.docs-menubar-container) {
  background-color: transparent !important;
  box-shadow: none !important;
}

html[data-gdt-dark="on"] :is(#docs-menubar,.docs-menubar,.docs-menubar-container) :is(.menu-button,.goog-control,.goog-control-caption,[role="menuitem"]) {
  background-color: transparent !important;
  border-color: transparent !important;
  box-shadow: none !important;
  color: var(--gdt-topbar-text) !important;
  opacity: 1 !important;
}

html[data-gdt-dark="on"] :is(#docs-menubar,.docs-menubar,.docs-menubar-container) :is(.menu-button:hover,.goog-control-hover,.goog-control-open,[role="menuitem"]:hover) {
  background-color: var(--gdt-topbar-hover) !important;
}

html[data-gdt-dark="on"] :is(#docs-titlebar,#docs-titlebar-container,.docs-titlebar,.docs-titlebar-buttons,.docs-titlebar-badges) :is(button,[role="button"],.jfk-button,.goog-button,.docs-material-button,.docs-gm3-button,.docs-gm3-icon-button,.docs-gm3-menu-button,.docs-titlebar-button) {
  background-color: transparent !important;
  border: 0 !important;
  box-shadow: none !important;
  color: var(--gdt-topbar-text) !important;
  opacity: 1 !important;
  outline: none !important;
}

html[data-gdt-dark="on"] :is(#docs-titlebar,#docs-titlebar-container,.docs-titlebar,.docs-titlebar-buttons,.docs-titlebar-badges) :is(.docs-icon-img,.docs-icon-img-container) {
  filter: var(--gdt-icon-filter) !important;
  opacity: 1 !important;
}

html[data-gdt-dark="on"] :is(#docs-titlebar,#docs-titlebar-container,.docs-titlebar,.docs-titlebar-buttons,.docs-titlebar-badges) :is(.docs-icon-masked-image) {
  background-color: var(--gdt-topbar-text) !important;
  color: var(--gdt-topbar-text) !important;
  opacity: 1 !important;
}

html[data-gdt-dark="on"] :is(#docs-titlebar-share-client-button,#scb-quick-actions-menu-button,.docs-titlebar-share-client-button,.docs-titlebar-share-button,.share-client-button,.scb-button,.scb-split-button) {
  background-color: transparent !important;
  border: 0 !important;
  box-shadow: none !important;
  color: var(--gdt-topbar-text) !important;
  opacity: 1 !important;
  outline: none !important;
}

html[data-gdt-dark="on"] :is(.docs-logo,.docs-homescreen-icon,.docs-homescreen-icon-container,[aria-label*="docs home" i],[aria-label*="google docs" i],[class*="docs-logo" i],[class*="docs-home" i],[class*="product-logo" i]) {
  background-color: transparent !important;
  box-shadow: none !important;
}
      `;
    }

    const container = document.head || root;
    if (style.parentNode !== container || container.lastElementChild !== style) {
      container.appendChild(style);
    }
  }

  function queueChromeRestyles() {
    for (const delay of [0, 80, 240, 700, 1500, 3000, 6000]) {
      window.setTimeout(() => {
        ensureRuntimeCss();
        scheduleChromeRestyle();
      }, delay);
    }
  }

  function scheduleChromeRestyle() {
    if (!darkEnabled || chromeFrame) {
      return;
    }

    chromeFrame = window.requestAnimationFrame(() => {
      chromeFrame = 0;
      ensureRuntimeCss();
    });
  }

  function restyleChrome() {
    if (!darkEnabled || !document.documentElement) {
      return;
    }

    const titleAreas = collectElements([
      "#docs-titlebar",
      "#docs-titlebar-container",
      ".docs-titlebar",
      ".docs-titlebar-buttons",
      ".docs-titlebar-badges"
    ]);

    for (const area of titleAreas) {
      applyChromeStyle(area, {
        "background-color": "#171a21",
        "border-color": "#343b47",
        "box-shadow": "none",
        "color": "#eef3fb"
      });

      const controls = area.querySelectorAll("button, [role='button'], .jfk-button, .goog-button, .docs-material-button, .docs-gm3-button, .docs-gm3-icon-button, .docs-gm3-menu-button, .docs-titlebar-button, [class*='button' i]");
      for (const control of controls) {
        if (control instanceof HTMLElement) {
          restyleTitleControl(control);
        }
      }
    }

    for (const titleElement of collectElements([
      ".docs-title-input",
      ".docs-title-input-label",
      ".docs-title-input-label-inner",
      ".docs-title-input-wrapper",
      ".docs-title-widget",
      ".docs-title-outer",
      ".docs-title-inner",
      ".docs-title-inline-rename",
      ".docs-titlebar-badge",
      ".docs-titlebar-badge-container",
      "[class*='docs-title-input' i]",
      "[class*='docs-titlebar-badge' i]"
    ])) {
      applyChromeStyle(titleElement, {
        "background-color": "transparent",
        "border-color": "transparent",
        "box-shadow": "none",
        "color": "#eef3fb",
        "opacity": "1",
        "outline-color": "transparent"
      });
    }

    const menuAreas = collectElements(["#docs-menubar", ".docs-menubar", ".docs-menubar-container"]);
    for (const area of menuAreas) {
      applyChromeStyle(area, {
        "background-color": "transparent",
        "box-shadow": "none"
      });
      const items = area.querySelectorAll(".menu-button, .goog-control, .goog-control-caption, [role='menuitem']");
      for (const item of items) {
        if (item instanceof HTMLElement) {
          applyChromeStyle(item, {
            "background-color": "transparent",
            "border-color": "transparent",
            "box-shadow": "none",
            "color": "#eef3fb",
            "opacity": "1"
          });
        }
      }
    }

    for (const control of findNamedControls(["history", "comment", "meet", "call", "star", "move", "document status", "saved", "cloud", "gemini"])) {
      restyleTitleControl(control);
    }

    for (const control of findNamedControls(["share"])) {
      restyleShareControl(control);
    }
  }

  function restyleTitleControl(control) {
    if (!(control instanceof HTMLElement)) {
      return;
    }

    if (isDocsLogoControl(control)) {
      return;
    }

    if (matchesAnyName(control, ["share"])) {
      restyleShareControl(control);
      return;
    }

    applyChromeStyle(control, {
      "background-color": "transparent",
      "border-color": "transparent",
      "box-shadow": "none",
      "color": "#eaf0f8",
      "opacity": "1"
    });

    restyleControlDescendants(control, "#eaf0f8", false);
  }

  function restyleShareControl(control) {
    if (!(control instanceof HTMLElement) || isDocsLogoControl(control)) {
      return;
    }

    applyChromeStyle(control, {
      "background-color": "transparent",
      "border-color": "transparent",
      "box-shadow": "none",
      "color": "#eaf0f8",
      "opacity": "1"
    });

    const descendants = control.querySelectorAll("*");
    for (const descendant of descendants) {
      if (!(descendant instanceof HTMLElement || descendant instanceof SVGElement)) {
        continue;
      }
      applyChromeStyle(descendant, {
        "color": "#eaf0f8",
        "opacity": "1"
      });
      if (descendant instanceof HTMLElement) {
        applyChromeStyle(descendant, {
          "border-top-color": "#eaf0f8",
          "border-bottom-color": "#eaf0f8"
        });
      }
    }

    restyleControlDescendants(control, "#eaf0f8", false);
  }

  function restyleControlDescendants(control, color, forceWhiteSprites) {
    if (isDocsLogoControl(control)) {
      return;
    }

    const iconElements = control.querySelectorAll(".docs-icon, .docs-icon-img, .docs-icon-img-container, .docs-icon-masked-image, svg, path");
    for (const icon of iconElements) {
      if (!(icon instanceof HTMLElement || icon instanceof SVGElement)) {
        continue;
      }

      applyChromeStyle(icon, {
        "color": color,
        "opacity": "1"
      });

      if (icon instanceof HTMLElement && (icon.classList.contains("docs-icon-img") || icon.classList.contains("docs-icon-img-container"))) {
        applyChromeStyle(icon, {
          "filter": forceWhiteSprites ? "brightness(0) invert(1)" : "var(--gdt-icon-filter)"
        });
      }

      if (icon instanceof HTMLElement && icon.classList.contains("docs-icon-masked-image")) {
        applyChromeStyle(icon, {
          "background-color": color
        });
      }

      if (icon instanceof SVGElement) {
        applyChromeStyle(icon, {
          "stroke": "currentColor"
        });
        if (icon.localName !== "path" || icon.getAttribute("fill") !== "none") {
          applyChromeStyle(icon, {
            "fill": "currentColor"
          });
        }
      }
    }
  }

  function findNamedControls(names) {
    const selectors = [];
    for (const name of names) {
      selectors.push(`[aria-label*="${cssString(name)}" i]`);
      selectors.push(`[data-tooltip*="${cssString(name)}" i]`);
      selectors.push(`[title*="${cssString(name)}" i]`);
    }

    const controls = new Set();
    for (const element of collectElements(selectors)) {
      const control = closestChromeControl(element);
      if (control) {
        controls.add(control);
      }
    }
    return controls;
  }

  function closestChromeControl(element) {
    if (!(element instanceof HTMLElement)) {
      return null;
    }

    const control = element.closest("button, [role='button'], .jfk-button, .goog-button, .docs-material-button, .docs-gm3-button, .docs-gm3-icon-button, .docs-gm3-menu-button, .docs-titlebar-button, .share-client-button, .scb-button, .scb-split-button");
    if (control instanceof HTMLElement) {
      return control;
    }
    return element;
  }

  function isDocsLogoControl(element) {
    const text = [
      element.getAttribute("aria-label"),
      element.getAttribute("data-tooltip"),
      element.getAttribute("title"),
      element.id,
      element.className
    ].join(" ").toLowerCase();

    return text.includes("docs home") ||
      text.includes("google docs") ||
      text.includes("docs logo") ||
      text.includes("docs-homescreen") ||
      text.includes("docs-home") ||
      text.includes("docs-logo") ||
      text.includes("product-logo");
  }

  function matchesAnyName(element, names) {
    const text = [
      element.getAttribute("aria-label"),
      element.getAttribute("data-tooltip"),
      element.getAttribute("title"),
      element.id,
      element.className,
      element.textContent
    ].join(" ").toLowerCase();
    return names.some((name) => text.includes(name));
  }

  function collectElements(selectors) {
    const elements = new Set();
    for (const selector of selectors) {
      try {
        for (const element of document.querySelectorAll(selector)) {
          if (element instanceof HTMLElement || element instanceof SVGElement) {
            elements.add(element);
          }
        }
      } catch (_error) {
        // Ignore selectors unsupported by an older embedded frame.
      }
    }
    return elements;
  }

  function applyChromeStyle(element, declarations) {
    if (!(element instanceof HTMLElement || element instanceof SVGElement)) {
      return;
    }

    let memory = chromeStyleMemory.get(element);
    if (!memory) {
      memory = Object.create(null);
      chromeStyleMemory.set(element, memory);
    }

    for (const [property, value] of Object.entries(declarations)) {
      if (!memory[property]) {
        memory[property] = {
          original: element.style.getPropertyValue(property),
          priority: element.style.getPropertyPriority(property)
        };
      }
      element.style.setProperty(property, value, "important");
    }

    chromeTouchedElements.add(element);
  }

  function restoreChromeStyles() {
    for (const element of chromeTouchedElements) {
      const memory = chromeStyleMemory.get(element);
      if (!memory || !element.isConnected) {
        continue;
      }

      for (const [property, record] of Object.entries(memory)) {
        if (record.original) {
          element.style.setProperty(property, record.original, record.priority || "");
        } else {
          element.style.removeProperty(property);
        }
      }
    }
    chromeTouchedElements.clear();
  }

  function cssString(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
  }

  function scheduleScan(root) {
    if (!darkEnabled || !root) {
      return;
    }

    const element = root.nodeType === Node.ELEMENT_NODE ? root : root.parentElement;
    if (!element) {
      return;
    }

    scanQueue.add(element);
    if (scanFrame) {
      return;
    }

    scanFrame = window.requestAnimationFrame(flushScanQueue);
  }

  function flushScanQueue() {
    scanFrame = 0;
    if (!darkEnabled) {
      scanQueue.clear();
      return;
    }

    const roots = Array.from(scanQueue);
    scanQueue.clear();

    for (const root of roots) {
      scanInlineStyles(root);
    }
  }

  function scanInlineStyles(root) {
    if (!(root instanceof Element) || shouldSkipElement(root)) {
      return;
    }

    let processed = 0;
    if (root instanceof HTMLElement && root.hasAttribute("style")) {
      adaptInlineElement(root);
      processed += 1;
    }

    const styledNodes = root.querySelectorAll("[style]");
    for (const element of styledNodes) {
      if (processed >= MAX_INLINE_ELEMENTS_PER_SCAN) {
        break;
      }
      if (element instanceof HTMLElement && !shouldSkipElement(element)) {
        adaptInlineElement(element);
        processed += 1;
      }
    }
  }

  function shouldSkipElement(element) {
    const tag = element.localName;
    return tag === "img" ||
      tag === "picture" ||
      tag === "video" ||
      tag === "canvas" ||
      tag === "iframe" ||
      tag === "object" ||
      tag === "embed" ||
      element.closest("[data-gdt-skip]");
  }

  function adaptInlineElement(element) {
    const style = element.style;
    if (!style) {
      return;
    }

    const props = [
      ["color", "foreground"],
      ["background-color", "background"],
      ["border-color", "border"],
      ["border-top-color", "border"],
      ["border-right-color", "border"],
      ["border-bottom-color", "border"],
      ["border-left-color", "border"],
      ["outline-color", "border"],
      ["text-decoration-color", "foreground"],
      ["column-rule-color", "border"],
      ["fill", "foreground"],
      ["stroke", "border"]
    ];

    let memory = styleMemory.get(element);

    for (const [property, role] of props) {
      const current = style.getPropertyValue(property);
      if (!current) {
        continue;
      }

      if (!memory) {
        memory = Object.create(null);
        styleMemory.set(element, memory);
      }

      const record = memory[property];
      if (record && current === record.lastApplied) {
        continue;
      }

      const adapted = colorTools.adaptCssColor(current, role);
      if (!adapted || adapted === current) {
        continue;
      }

      const priority = style.getPropertyPriority(property);
      memory[property] = {
        original: current,
        lastApplied: adapted,
        priority
      };
      touchedElements.add(element);
      style.setProperty(property, adapted, priority);
    }
  }

  function restoreInlineStyles() {
    for (const element of touchedElements) {
      const memory = styleMemory.get(element);
      if (!memory || !element.isConnected) {
        continue;
      }

      for (const property of Object.keys(memory)) {
        const record = memory[property];
        if (element.style.getPropertyValue(property) === record.lastApplied) {
          element.style.setProperty(property, record.original, record.priority || "");
        }
      }
    }
    touchedElements.clear();
  }

  function requestRepaint() {
    for (const delay of [0, 80, 240, 700]) {
      window.setTimeout(() => {
        window.dispatchEvent(new Event("resize"));
        window.dispatchEvent(new Event("scroll"));
        document.dispatchEvent(new Event("selectionchange"));
      }, delay);
    }
  }

  function createColorTools() {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const cache = new Map();

    function adaptCssColor(value, role) {
      const normalized = normalizeColor(value);
      if (!normalized) {
        return null;
      }
      const cacheKey = `${role}:${normalized.r},${normalized.g},${normalized.b},${normalized.a}`;
      if (cache.has(cacheKey)) {
        return cache.get(cacheKey);
      }

      const adapted = adaptRgb(normalized, role);
      const css = toCssColor(adapted);
      cache.set(cacheKey, css);
      return css;
    }

    function normalizeColor(value) {
      if (!value || typeof value !== "string") {
        return null;
      }
      const trimmed = value.trim();
      const lower = trimmed.toLowerCase();
      if (
        lower === "transparent" ||
        lower === "currentcolor" ||
        lower === "inherit" ||
        lower === "initial" ||
        lower === "unset" ||
        lower === "none" ||
        lower.includes("var(") ||
        lower.includes("url(") ||
        lower.includes("gradient(")
      ) {
        return null;
      }

      try {
        context.fillStyle = "#000000";
        context.fillStyle = trimmed;
        const normalized = context.fillStyle;
        if (normalized === "#000000" && !looksBlack(trimmed)) {
          return null;
        }
        return parseCanvasColor(normalized);
      } catch (_error) {
        return null;
      }
    }

    function looksBlack(value) {
      const lower = value.toLowerCase().replace(/\s+/g, "");
      return lower === "black" ||
        lower === "#000" ||
        lower === "#000000" ||
        lower === "rgb(0,0,0)" ||
        lower === "rgba(0,0,0,1)";
    }

    function parseCanvasColor(value) {
      if (value.startsWith("#")) {
        const hex = value.slice(1);
        return {
          r: parseInt(hex.slice(0, 2), 16),
          g: parseInt(hex.slice(2, 4), 16),
          b: parseInt(hex.slice(4, 6), 16),
          a: 1
        };
      }

      const match = value.match(/^rgba?\(([^)]+)\)$/i);
      if (!match) {
        return null;
      }

      const parts = match[1].split(",").map((part) => part.trim());
      return {
        r: clampByte(Number(parts[0])),
        g: clampByte(Number(parts[1])),
        b: clampByte(Number(parts[2])),
        a: parts[3] === undefined ? 1 : clamp(Number(parts[3]), 0, 1)
      };
    }

    function adaptRgb(color, role) {
      if (color.a < 0.05) {
        return color;
      }

      const luminance = relativeLuminance(color);
      const hsl = rgbToHsl(color.r, color.g, color.b);
      const chroma = Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b);
      const isNeutral = chroma < 18 || hsl.s < 0.08;

      if (role === "foreground") {
        if (luminance < 0.18) {
          return isNeutral ? withAlpha({ r: 232, g: 236, b: 242 }, color.a) : hslToRgb(hsl.h, Math.max(hsl.s, 0.42), 0.74, color.a);
        }
        if (luminance < 0.42) {
          return isNeutral ? withAlpha({ r: 205, g: 213, b: 224 }, color.a) : hslToRgb(hsl.h, Math.max(hsl.s, 0.38), 0.68, color.a);
        }
        return color;
      }

      if (role === "border") {
        if (luminance > 0.62) {
          return isNeutral ? withAlpha({ r: 73, g: 83, b: 99 }, color.a) : hslToRgb(hsl.h, Math.min(Math.max(hsl.s, 0.22), 0.58), 0.36, color.a);
        }
        if (luminance < 0.09) {
          return withAlpha({ r: 65, g: 74, b: 89 }, color.a);
        }
        return color;
      }

      if (luminance > 0.86) {
        return isNeutral ? withAlpha({ r: 23, g: 27, b: 34 }, color.a) : hslToRgb(hsl.h, Math.min(Math.max(hsl.s, 0.18), 0.45), 0.20, color.a);
      }
      if (luminance > 0.62) {
        return isNeutral ? withAlpha({ r: 29, g: 34, b: 43 }, color.a) : hslToRgb(hsl.h, Math.min(Math.max(hsl.s, 0.20), 0.52), 0.26, color.a);
      }
      if (luminance < 0.05) {
        return withAlpha({ r: 18, g: 22, b: 29 }, color.a);
      }
      return color;
    }

    function toCssColor(color) {
      const r = clampByte(color.r);
      const g = clampByte(color.g);
      const b = clampByte(color.b);
      if (color.a === undefined || color.a >= 0.995) {
        return `rgb(${r}, ${g}, ${b})`;
      }
      return `rgba(${r}, ${g}, ${b}, ${Math.round(color.a * 1000) / 1000})`;
    }

    return { adaptCssColor };
  }

  function relativeLuminance(color) {
    const r = linearize(color.r / 255);
    const g = linearize(color.g / 255);
    const b = linearize(color.b / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function linearize(value) {
    return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  }

  function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
      const delta = max - min;
      s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
      switch (max) {
        case r:
          h = (g - b) / delta + (g < b ? 6 : 0);
          break;
        case g:
          h = (b - r) / delta + 2;
          break;
        default:
          h = (r - g) / delta + 4;
          break;
      }
      h /= 6;
    }

    return { h, s, l };
  }

  function hslToRgb(h, s, l, a) {
    let r;
    let g;
    let b;

    if (s === 0) {
      r = g = b = l;
    } else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hueToRgb(p, q, h + 1 / 3);
      g = hueToRgb(p, q, h);
      b = hueToRgb(p, q, h - 1 / 3);
    }

    return {
      r: Math.round(r * 255),
      g: Math.round(g * 255),
      b: Math.round(b * 255),
      a
    };
  }

  function hueToRgb(p, q, t) {
    if (t < 0) {
      t += 1;
    }
    if (t > 1) {
      t -= 1;
    }
    if (t < 1 / 6) {
      return p + (q - p) * 6 * t;
    }
    if (t < 1 / 2) {
      return q;
    }
    if (t < 2 / 3) {
      return p + (q - p) * (2 / 3 - t) * 6;
    }
    return p;
  }

  function clampByte(value) {
    return Math.round(clamp(value, 0, 255));
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
  }

  function withAlpha(color, alpha) {
    return { r: color.r, g: color.g, b: color.b, a: alpha };
  }
})();
