(() => {
  "use strict";

  if (window.__gdtCanvasPatchInstalled) {
    return;
  }
  window.__gdtCanvasPatchInstalled = true;

  const MODE_ATTR = "data-gdt-page-dark";
  const FORCE_PARAM = "gdt_force_dark";
  const FIXTURE_ATTR = "data-gdt-fixture";
  const MAX_REPLAY_OPS = 15000;
  const MEDIA = window.matchMedia("(prefers-color-scheme: dark)");
  const state = { dark: isDark() };
  const tools = createColorTools();
  const recorders = new WeakMap();
  const replayCanvases = new Set();
  let isReplaying = false;
  let modeObserver = null;

  patchCanvasContext(window.CanvasRenderingContext2D && window.CanvasRenderingContext2D.prototype);
  patchCanvasContext(window.OffscreenCanvasRenderingContext2D && window.OffscreenCanvasRenderingContext2D.prototype);
  patchGradients(window.CanvasGradient && window.CanvasGradient.prototype);
  watchModeAttribute();

  if (typeof MEDIA.addEventListener === "function") {
    MEDIA.addEventListener("change", syncMode);
  } else if (typeof MEDIA.addListener === "function") {
    MEDIA.addListener(syncMode);
  }

  document.addEventListener("gdt-dark-mode-change", syncMode);

  function syncMode(event) {
    const nextDark = event && event.detail && typeof event.detail.dark === "boolean" ? event.detail.dark : isDark();
    setMode(nextDark);
  }

  function setMode(nextDark) {
    if (state.dark !== nextDark) {
      state.dark = nextDark;
      replayRecordedCanvases();
      requestDocsRepaint();
      return;
    }
    state.dark = nextDark;
  }

  function isDark() {
    if (document.documentElement) {
      const attr = document.documentElement.getAttribute(MODE_ATTR);
      if (attr === "1") {
        return true;
      }
      if (attr === "0") {
        return false;
      }
    }
    if (document.documentElement && document.documentElement.hasAttribute(FIXTURE_ATTR)) {
      return true;
    }
    try {
      if (new URLSearchParams(window.location.search).has(FORCE_PARAM)) {
        return true;
      }
    } catch (_error) {
      // Ignore URL parsing failures and fall back to the system setting.
    }
    return MEDIA.matches;
  }

  function watchModeAttribute() {
    if (modeObserver || typeof MutationObserver !== "function") {
      return;
    }
    if (!document.documentElement) {
      window.setTimeout(watchModeAttribute, 0);
      window.setTimeout(watchModeAttribute, 50);
      document.addEventListener("DOMContentLoaded", watchModeAttribute, { once: true });
      return;
    }

    modeObserver = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes" && record.attributeName === MODE_ATTR) {
          setMode(isDark());
          return;
        }
      }
    });
    modeObserver.observe(document.documentElement, { attributes: true, attributeFilter: [MODE_ATTR] });
    setMode(isDark());
  }

  function patchCanvasContext(proto) {
    if (!proto || proto.__gdtPatched) {
      return;
    }
    proto.__gdtPatched = true;

    const fillStyleDescriptor = Object.getOwnPropertyDescriptor(proto, "fillStyle");
    const strokeStyleDescriptor = Object.getOwnPropertyDescriptor(proto, "strokeStyle");
    if (!fillStyleDescriptor || !strokeStyleDescriptor) {
      return;
    }

    const originals = {
      beginPath: proto.beginPath,
      closePath: proto.closePath,
      moveTo: proto.moveTo,
      lineTo: proto.lineTo,
      rect: proto.rect,
      arc: proto.arc,
      ellipse: proto.ellipse,
      quadraticCurveTo: proto.quadraticCurveTo,
      bezierCurveTo: proto.bezierCurveTo,
      clearRect: proto.clearRect,
      drawImage: proto.drawImage,
      fillText: proto.fillText,
      strokeText: proto.strokeText,
      fillRect: proto.fillRect,
      strokeRect: proto.strokeRect,
      fill: proto.fill,
      stroke: proto.stroke
    };

    patchRecordedMethod(proto, originals, "beginPath", null);
    patchRecordedMethod(proto, originals, "closePath", null);
    patchRecordedMethod(proto, originals, "moveTo", null);
    patchRecordedMethod(proto, originals, "lineTo", null);
    patchRecordedMethod(proto, originals, "rect", null);
    patchRecordedMethod(proto, originals, "arc", null);
    patchRecordedMethod(proto, originals, "ellipse", null);
    patchRecordedMethod(proto, originals, "quadraticCurveTo", null);
    patchRecordedMethod(proto, originals, "bezierCurveTo", null);
    patchRecordedMethod(proto, originals, "clearRect", null);
    patchRecordedMethod(proto, originals, "drawImage", null);

    patchMethod(proto, originals, "fillText", "foreground", (context, draw, args) => {
      return withStyle(context, fillStyleDescriptor, "foreground", () => draw.apply(context, args));
    });
    patchMethod(proto, originals, "strokeText", "foreground", (context, draw, args) => {
      return withStyle(context, strokeStyleDescriptor, "foreground", () => draw.apply(context, args));
    });
    patchMethod(proto, originals, "fillRect", "background", (context, draw, args) => {
      return withStyle(context, fillStyleDescriptor, "background", () => draw.apply(context, args));
    });
    patchMethod(proto, originals, "strokeRect", "border", (context, draw, args) => {
      return withStyle(context, strokeStyleDescriptor, "border", () => draw.apply(context, args));
    });
    patchMethod(proto, originals, "fill", "background", (context, draw, args) => {
      return withStyle(context, fillStyleDescriptor, "background", () => draw.apply(context, args));
    });
    patchMethod(proto, originals, "stroke", "border", (context, draw, args) => {
      return withStyle(context, strokeStyleDescriptor, "border", () => draw.apply(context, args));
    });
  }

  function patchRecordedMethod(proto, originals, name, role) {
    const original = originals[name];
    if (typeof original !== "function") {
      return;
    }

    proto[name] = function patchedRecordedCanvasMethod(...args) {
      recordOperation(this, originals, name, args, role);
      return original.apply(this, args);
    };
  }

  function patchMethod(proto, originals, name, role, wrapper) {
    const original = originals[name];
    if (typeof original !== "function") {
      return;
    }

    proto[name] = function patchedCanvasMethod(...args) {
      recordOperation(this, originals, name, args, role);
      const darkNow = isDark();
      if (darkNow !== state.dark) {
        setMode(darkNow);
      }
      if (!darkNow) {
        return original.apply(this, args);
      }
      return wrapper(this, original, args);
    };
  }

  function recordOperation(context, originals, name, args, role) {
    if (isReplaying || !context || !context.canvas) {
      return;
    }

    const canvas = context.canvas;
    const recorder = getRecorder(canvas, originals);
    if (!recorder || recorder.disabled) {
      return;
    }

    if (recorder.width !== canvas.width || recorder.height !== canvas.height) {
      recorder.width = canvas.width;
      recorder.height = canvas.height;
      recorder.ops.length = 0;
    }

    if (isFullCanvasReset(canvas, name, args)) {
      recorder.ops.length = 0;
    }

    if (recorder.ops.length >= MAX_REPLAY_OPS) {
      recorder.disabled = true;
      recorder.ops.length = 0;
      replayCanvases.delete(canvas);
      return;
    }

    recorder.ops.push({
      name,
      args: Array.from(args),
      role,
      state: captureCanvasState(context)
    });
  }

  function getRecorder(canvas, originals) {
    let recorder = recorders.get(canvas);
    if (recorder) {
      return recorder;
    }

    recorder = {
      canvas,
      originals,
      width: canvas.width,
      height: canvas.height,
      ops: [],
      disabled: false
    };
    recorders.set(canvas, recorder);
    replayCanvases.add(canvas);
    return recorder;
  }

  function isFullCanvasReset(canvas, name, args) {
    if ((name !== "fillRect" && name !== "clearRect") || args.length < 4) {
      return false;
    }

    const x = Number(args[0]);
    const y = Number(args[1]);
    const width = Number(args[2]);
    const height = Number(args[3]);
    return Number.isFinite(x) &&
      Number.isFinite(y) &&
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      x <= 0 &&
      y <= 0 &&
      width >= canvas.width * 0.95 &&
      height >= canvas.height * 0.95;
  }

  function replayRecordedCanvases() {
    for (const delay of [0, 60, 180]) {
      window.setTimeout(() => {
        for (const canvas of Array.from(replayCanvases)) {
          const recorder = recorders.get(canvas);
          if (!recorder || recorder.disabled || !recorder.ops.length) {
            continue;
          }
          replayRecorder(recorder);
        }
      }, delay);
    }
  }

  function replayRecorder(recorder) {
    const canvas = recorder.canvas;
    if (!canvas || canvas.width <= 0 || canvas.height <= 0 || typeof canvas.getContext !== "function") {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    isReplaying = true;
    try {
      if (typeof recorder.originals.clearRect === "function") {
        const previous = captureCanvasState(context);
        if (typeof context.resetTransform === "function") {
          context.resetTransform();
        } else if (typeof context.setTransform === "function") {
          context.setTransform(1, 0, 0, 1, 0, 0);
        }
        recorder.originals.clearRect.call(context, 0, 0, canvas.width, canvas.height);
        applyCanvasState(context, previous, null);
      }

      for (const operation of recorder.ops) {
        const original = recorder.originals[operation.name];
        if (typeof original !== "function") {
          continue;
        }

        withReplayState(context, operation.state, operation.role, () => {
          original.apply(context, operation.args);
        });
      }
    } finally {
      isReplaying = false;
    }
  }

  function withReplayState(context, savedState, role, draw) {
    const previous = captureCanvasState(context);
    if (savedState) {
      applyCanvasState(context, savedState, role);
    }

    try {
      return draw();
    } finally {
      applyCanvasState(context, previous, null);
    }
  }

  function captureCanvasState(context) {
    const state = {
      fillStyle: context.fillStyle,
      strokeStyle: context.strokeStyle,
      globalAlpha: context.globalAlpha,
      globalCompositeOperation: context.globalCompositeOperation,
      filter: context.filter,
      font: context.font,
      textAlign: context.textAlign,
      textBaseline: context.textBaseline,
      direction: context.direction,
      lineWidth: context.lineWidth,
      lineCap: context.lineCap,
      lineJoin: context.lineJoin,
      miterLimit: context.miterLimit,
      lineDashOffset: context.lineDashOffset,
      shadowColor: context.shadowColor,
      shadowBlur: context.shadowBlur,
      shadowOffsetX: context.shadowOffsetX,
      shadowOffsetY: context.shadowOffsetY,
      imageSmoothingEnabled: context.imageSmoothingEnabled,
      imageSmoothingQuality: context.imageSmoothingQuality
    };

    if (typeof context.getLineDash === "function") {
      state.lineDash = context.getLineDash();
    }
    if (typeof context.getTransform === "function") {
      const transform = context.getTransform();
      state.transform = [transform.a, transform.b, transform.c, transform.d, transform.e, transform.f];
    }

    return state;
  }

  function applyCanvasState(context, savedState, role) {
    if (savedState.transform && typeof context.setTransform === "function") {
      context.setTransform(
        savedState.transform[0],
        savedState.transform[1],
        savedState.transform[2],
        savedState.transform[3],
        savedState.transform[4],
        savedState.transform[5]
      );
    } else if (typeof context.resetTransform === "function") {
      context.resetTransform();
    }

    setCanvasProperty(context, "globalAlpha", savedState.globalAlpha);
    setCanvasProperty(context, "globalCompositeOperation", savedState.globalCompositeOperation);
    setCanvasProperty(context, "filter", savedState.filter);
    setCanvasProperty(context, "font", savedState.font);
    setCanvasProperty(context, "textAlign", savedState.textAlign);
    setCanvasProperty(context, "textBaseline", savedState.textBaseline);
    setCanvasProperty(context, "direction", savedState.direction);
    setCanvasProperty(context, "lineWidth", savedState.lineWidth);
    setCanvasProperty(context, "lineCap", savedState.lineCap);
    setCanvasProperty(context, "lineJoin", savedState.lineJoin);
    setCanvasProperty(context, "miterLimit", savedState.miterLimit);
    setCanvasProperty(context, "lineDashOffset", savedState.lineDashOffset);
    setCanvasProperty(context, "shadowColor", savedState.shadowColor);
    setCanvasProperty(context, "shadowBlur", savedState.shadowBlur);
    setCanvasProperty(context, "shadowOffsetX", savedState.shadowOffsetX);
    setCanvasProperty(context, "shadowOffsetY", savedState.shadowOffsetY);
    setCanvasProperty(context, "imageSmoothingEnabled", savedState.imageSmoothingEnabled);
    setCanvasProperty(context, "imageSmoothingQuality", savedState.imageSmoothingQuality);

    if (typeof context.setLineDash === "function" && Array.isArray(savedState.lineDash)) {
      context.setLineDash(savedState.lineDash);
    }

    let fillStyle = savedState.fillStyle;
    let strokeStyle = savedState.strokeStyle;
    if (state.dark) {
      if ((role === "foreground" || role === "background") && typeof fillStyle === "string") {
        fillStyle = tools.adaptCssColor(fillStyle, role) || fillStyle;
      }
      if ((role === "foreground" || role === "border") && typeof strokeStyle === "string") {
        strokeStyle = tools.adaptCssColor(strokeStyle, role === "foreground" ? "foreground" : "border") || strokeStyle;
      }
    }

    setCanvasProperty(context, "fillStyle", fillStyle);
    setCanvasProperty(context, "strokeStyle", strokeStyle);
  }

  function setCanvasProperty(context, property, value) {
    if (value === undefined) {
      return;
    }
    try {
      context[property] = value;
    } catch (_error) {
      // Some browser/canvas implementations reject individual optional properties.
    }
  }

  function patchGradients(proto) {
    if (!proto || proto.__gdtPatched) {
      return;
    }
    proto.__gdtPatched = true;

    const originalAddColorStop = proto.addColorStop;
    if (typeof originalAddColorStop !== "function") {
      return;
    }

    proto.addColorStop = function patchedAddColorStop(offset, color) {
      if (state.dark && typeof color === "string") {
        const adapted = tools.adaptCssColor(color, "background");
        return originalAddColorStop.call(this, offset, adapted || color);
      }
      return originalAddColorStop.call(this, offset, color);
    };
  }

  function withStyle(context, descriptor, role, draw) {
    const original = descriptor.get.call(context);
    if (typeof original !== "string") {
      return draw();
    }

    const adapted = tools.adaptCssColor(original, role);
    if (!adapted || adapted === original) {
      return draw();
    }

    descriptor.set.call(context, adapted);
    try {
      return draw();
    } finally {
      descriptor.set.call(context, original);
    }
  }

  function requestDocsRepaint() {
    for (const delay of [0, 80, 240, 700, 1400]) {
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
      const css = toCssColor(adaptRgb(normalized, role));
      cache.set(cacheKey, css);
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
        lower.includes("gradient(")
      ) {
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
