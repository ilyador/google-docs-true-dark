(() => {
  "use strict";

  const fixture = location.protocol === "file:" &&
    document.documentElement?.hasAttribute("data-gdt-share-fixture");
  if (!fixture && (window === window.top || !location.pathname.startsWith("/drivesharing/"))) {
    return;
  }

  const params = new URLSearchParams(location.search);
  let fromEditor = fixture;
  let sourceKnown = false;
  if (!fixture) {
    try {
      const referrer = new URL(document.referrer);
      sourceKnown = referrer.origin !== "https://docs.google.com" || referrer.pathname !== "/";
      fromEditor = referrer.origin === "https://docs.google.com" &&
        /^\/(document|spreadsheets)\//.test(referrer.pathname);
    } catch (_error) {
      // Some embedded share panels omit the full referrer.
    }
  }

  if (!fixture && !sourceKnown) {
    fromEditor = ["ritz", "kix"].includes(params.get("foreignService")) &&
      params.get("origin") === "https://docs.google.com";
  }
  if (!fromEditor) {
    return;
  }

  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const isDark = () => fixture ? params.has("dark") : media.matches;
  const surfaceAttribute = "data-gdt-share-surface";
  const markedSurfaces = new Set();
  let scanFrame = 0;
  const apply = () => {
    document.documentElement?.setAttribute("data-gdt-share-dark", isDark() ? "on" : "off");
    if (isDark()) {
      scheduleSurfaceScan();
    } else {
      for (const element of markedSurfaces) {
        element.removeAttribute(surfaceAttribute);
      }
      markedSurfaces.clear();
    }
  };

  function scheduleSurfaceScan() {
    if (!isDark() || !document.body || scanFrame) {
      return;
    }
    scanFrame = requestAnimationFrame(() => {
      scanFrame = 0;
      if (!isDark()) {
        return;
      }
      for (const element of document.body.querySelectorAll("div, c-wiz, section, article, main, button, [role='button'], span, label")) {
        if (element.hasAttribute(surfaceAttribute)) {
          continue;
        }
        const control = element.matches("button, [role='button']");
        const fieldText = element.matches("span, label");
        if (fieldText && !isEditableFieldText(element)) {
          continue;
        }
        const rect = element.getBoundingClientRect();
        if (rect.width < (fieldText ? 80 : control ? 48 : 200) ||
            rect.height < (fieldText ? 12 : control ? 24 : 32)) {
          continue;
        }
        if (!isPaleSurface(getComputedStyle(element).backgroundColor)) {
          continue;
        }
        element.setAttribute(surfaceAttribute,
          fieldText ? "placeholder" : control ? "control" : rect.height >= 120 ? "panel" : "field");
        markedSurfaces.add(element);
      }
    });
  }

  function isEditableFieldText(element) {
    const editable = "input, textarea, [role='combobox'], [contenteditable='true']";
    if (element.matches("label") && element.querySelector(editable)) {
      return true;
    }
    for (let parent = element.parentElement, depth = 0; parent && depth < 2; parent = parent.parentElement, depth += 1) {
      if (parent.matches("label, [role='combobox']") || parent.querySelector(editable)) {
        return true;
      }
    }
    return false;
  }

  function isPaleSurface(value) {
    const match = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/);
    if (!match || (match[4] && Number(match[4]) < 0.9)) {
      return false;
    }
    const channels = match.slice(1, 4).map(Number);
    return Math.min(...channels) > 215 && Math.max(...channels) - Math.min(...channels) < 40;
  }

  apply();
  if (!document.documentElement) {
    document.addEventListener("DOMContentLoaded", apply, { once: true });
  }
  document.addEventListener("DOMContentLoaded", scheduleSurfaceScan, { once: true });
  window.addEventListener("load", scheduleSurfaceScan, { once: true });
  if (document.documentElement && typeof MutationObserver === "function") {
    new MutationObserver(scheduleSurfaceScan).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style"]
    });
  }
  if (typeof media.addEventListener === "function") {
    media.addEventListener("change", apply);
  } else {
    media.addListener(apply);
  }
})();
