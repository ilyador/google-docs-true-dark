(() => {
  "use strict";

  if (window.__gdtThemeControllerInstalled) {
    return;
  }
  Object.defineProperty(window, "__gdtThemeControllerInstalled", {
    value: true,
    configurable: true
  });

  const ROOT_ATTR = "data-gdt-dark";
  const PAGE_MODE_ATTR = "data-gdt-page-dark";
  const APP_ATTR = "data-gdt-app";
  const FIXTURE_ATTR = "data-gdt-fixture";
  const FORCE_PARAM = "gdt_force_dark";
  const DOC_EDITOR_SELECTOR = "#docs-editor, #docs-editor-container, .kix-appview-editor";
  const MAX_INLINE_ELEMENTS_PER_SCAN = 5000;
  const MAX_COLOR_RULES = 10000;
  const DOC_COLOR_PROPERTIES = [
    ["color", "foreground"],
    ["background-color", "background"],
    ["border-color", "border"],
    ["border-top-color", "border"],
    ["border-right-color", "border"],
    ["border-bottom-color", "border"],
    ["border-left-color", "border"],
    ["outline-color", "border"],
    ["text-decoration-color", "foreground"]
  ];
  const MEDIA = window.matchMedia("(prefers-color-scheme: dark)");
  const app = location.pathname.includes("/spreadsheets/") ? "sheets" : "docs";
  const colorTools = createColorTools();
  const colorRules = new Set();
  const scanQueue = new Set();
  let darkEnabled = false;
  let scanFrame = 0;
  let colorStyle = null;

  install();

  function install() {
    applyMode();

    if (typeof MEDIA.addEventListener === "function") {
      MEDIA.addEventListener("change", applyMode);
    } else if (typeof MEDIA.addListener === "function") {
      MEDIA.addListener(applyMode);
    }

    if (app === "docs" && document.documentElement) {
      const observer = new MutationObserver(handleMutations);
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["style"]
      });
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        if (darkEnabled && app === "docs") {
          scheduleScan(document.documentElement);
        }
      }, { once: true });
    } else if (darkEnabled && app === "docs") {
      scheduleScan(document.documentElement);
    }
  }

  function isDark() {
    try {
      if (new URLSearchParams(location.search).has(FORCE_PARAM)) {
        return true;
      }
    } catch (_error) {
      // Fall through to the fixture and system settings.
    }

    return document.documentElement.hasAttribute(FIXTURE_ATTR) || MEDIA.matches;
  }

  function applyMode() {
    darkEnabled = isDark();
    const root = document.documentElement;
    if (!root) {
      return;
    }

    root.setAttribute(APP_ATTR, app);
    root.setAttribute(ROOT_ATTR, darkEnabled ? "on" : "off");
    root.setAttribute(PAGE_MODE_ATTR, darkEnabled ? "1" : "0");
    document.dispatchEvent(new CustomEvent("gdt-dark-mode-change", {
      detail: { dark: darkEnabled }
    }));

    if (darkEnabled) {
      if (app === "docs") {
        scheduleScan(root);
      }
    } else {
      clearColorRules();
    }
  }

  function handleMutations(records) {
    if (!darkEnabled) {
      return;
    }

    for (const record of records) {
      if (record.type === "attributes") {
        if (record.target instanceof HTMLElement && isInDocEditor(record.target)) {
          scheduleScan(record.target);
        }
        continue;
      }

      for (const node of record.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          scheduleScan(node);
        }
      }
    }
  }

  function scheduleScan(root) {
    if (!darkEnabled || app !== "docs" || !root) {
      return;
    }

    const element = root.nodeType === Node.ELEMENT_NODE ? root : root.parentElement;
    if (!(element instanceof Element)) {
      return;
    }

    for (const queued of scanQueue) {
      if (queued.contains(element)) {
        return;
      }
      if (element.contains(queued)) {
        scanQueue.delete(queued);
      }
    }

    scanQueue.add(element);
    if (!scanFrame) {
      scanFrame = requestAnimationFrame(flushScanQueue);
    }
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
      scanDocInlineStyles(root);
    }
  }

  function scanDocInlineStyles(root) {
    const scopes = new Set();
    if (root.matches(DOC_EDITOR_SELECTOR) || isInDocEditor(root)) {
      scopes.add(root);
    } else {
      for (const scope of root.querySelectorAll(DOC_EDITOR_SELECTOR)) {
        scopes.add(scope);
      }
    }

    let processed = 0;
    for (const scope of scopes) {
      if (processed >= MAX_INLINE_ELEMENTS_PER_SCAN) {
        break;
      }

      if (scope instanceof HTMLElement && scope.hasAttribute("style") && !shouldSkipElement(scope)) {
        registerColorRule(scope);
        processed += 1;
      }

      for (const element of scope.querySelectorAll("[style]")) {
        if (processed >= MAX_INLINE_ELEMENTS_PER_SCAN) {
          break;
        }
        if (element instanceof HTMLElement && !shouldSkipElement(element)) {
          registerColorRule(element);
          processed += 1;
        }
      }
    }
  }

  function isInDocEditor(element) {
    return Boolean(element.closest(DOC_EDITOR_SELECTOR));
  }

  function shouldSkipElement(element) {
    const tag = element.localName;
    return tag === "img" ||
      tag === "picture" ||
      tag === "video" ||
      tag === "canvas" ||
      tag === "svg" ||
      tag === "iframe" ||
      tag === "object" ||
      tag === "embed" ||
      Boolean(element.closest("svg, [data-gdt-skip]"));
  }

  function registerColorRule(element) {
    const styleText = element.getAttribute("style");
    if (!styleText || colorRules.has(styleText) || colorRules.size >= MAX_COLOR_RULES) {
      return;
    }

    const declarations = [];
    for (const [property, role] of DOC_COLOR_PROPERTIES) {
      const current = element.style.getPropertyValue(property);
      if (!current) {
        continue;
      }
      const adapted = colorTools.adaptCssColor(current, role);
      if (!adapted || adapted === current) {
        continue;
      }
      declarations.push(`${property}: ${adapted} !important`);
    }

    if (!declarations.length) {
      return;
    }

    if (!colorStyle) {
      colorStyle = document.createElement("style");
      colorStyle.setAttribute("data-gdt-doc-colors", "");
      (document.head || document.documentElement).appendChild(colorStyle);
    }

    const scope = ":is(#docs-editor, #docs-editor-container, .kix-appview-editor)";
    const target = `[style=${CSS.escape(styleText)}]:not(:is(img, picture, video, canvas, svg, svg *, iframe, object, embed, [data-gdt-skip], [data-gdt-skip] *))`;
    const root = 'html[data-gdt-app="docs"][data-gdt-dark="on"]';
    const rule = `${root} ${scope}${target}, ${root} ${scope} ${target} { ${declarations.join("; ")} }`;
    try {
      colorStyle.sheet.insertRule(rule);
      colorRules.add(styleText);
    } catch (_error) {
      // Ignore malformed source styles without changing the editor DOM.
    }
  }

  function clearColorRules() {
    colorStyle?.remove();
    colorStyle = null;
    colorRules.clear();
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

      const key = `${role}:${normalized.r},${normalized.g},${normalized.b},${normalized.a}`;
      if (cache.has(key)) {
        return cache.get(key);
      }

      const css = toCssColor(adaptRgb(normalized, role));
      cache.set(key, css);
      return css;
    }

    function normalizeColor(value) {
      const lower = String(value).trim().toLowerCase();
      if (!lower ||
        lower === "transparent" ||
        lower === "currentcolor" ||
        lower === "inherit" ||
        lower === "initial" ||
        lower === "unset" ||
        lower === "none" ||
        lower.includes("var(") ||
        lower.includes("url(") ||
        lower.includes("gradient(")) {
        return null;
      }

      context.fillStyle = "#000000";
      context.fillStyle = value;
      const normalized = context.fillStyle;
      if (normalized === "#000000" && !looksBlack(lower)) {
        return null;
      }
      return parseCanvasColor(normalized);
    }

    function looksBlack(value) {
      const compact = value.replace(/\s+/g, "");
      return compact === "black" ||
        compact === "#000" ||
        compact === "#000000" ||
        compact === "rgb(0,0,0)" ||
        compact === "rgba(0,0,0,1)";
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
      const neutral = chroma < 18 || hsl.s < 0.08;

      if (role === "foreground") {
        if (luminance < 0.18) {
          return neutral ? withAlpha({ r: 232, g: 236, b: 242 }, color.a) : hslToRgb(hsl.h, Math.max(hsl.s, 0.42), 0.74, color.a);
        }
        if (luminance < 0.42) {
          return neutral ? withAlpha({ r: 205, g: 213, b: 224 }, color.a) : hslToRgb(hsl.h, Math.max(hsl.s, 0.38), 0.68, color.a);
        }
        return color;
      }

      if (role === "border") {
        if (luminance > 0.62) {
          return neutral ? withAlpha({ r: 73, g: 83, b: 99 }, color.a) : hslToRgb(hsl.h, Math.min(Math.max(hsl.s, 0.22), 0.58), 0.36, color.a);
        }
        if (luminance < 0.09) {
          return withAlpha({ r: 65, g: 74, b: 89 }, color.a);
        }
        return color;
      }

      if (luminance > 0.86) {
        return neutral ? withAlpha({ r: 23, g: 27, b: 34 }, color.a) : hslToRgb(hsl.h, Math.min(Math.max(hsl.s, 0.18), 0.45), 0.20, color.a);
      }
      if (luminance > 0.62) {
        return neutral ? withAlpha({ r: 29, g: 34, b: 43 }, color.a) : hslToRgb(hsl.h, Math.min(Math.max(hsl.s, 0.20), 0.52), 0.26, color.a);
      }
      if (luminance < 0.05) {
        return withAlpha({ r: 18, g: 22, b: 29 }, color.a);
      }
      return color;
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
      if (max === r) {
        h = (g - b) / delta + (g < b ? 6 : 0);
      } else if (max === g) {
        h = (b - r) / delta + 2;
      } else {
        h = (r - g) / delta + 4;
      }
      h /= 6;
    }

    return { h, s, l };
  }

  function hslToRgb(h, s, l, a) {
    let r = l;
    let g = l;
    let b = l;
    if (s !== 0) {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hueToRgb(p, q, h + 1 / 3);
      g = hueToRgb(p, q, h);
      b = hueToRgb(p, q, h - 1 / 3);
    }
    return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255), a };
  }

  function hueToRgb(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
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
