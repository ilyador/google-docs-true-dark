(() => {
  "use strict";

  if (window === window.top || !location.pathname.startsWith("/drivesharing/")) {
    return;
  }

  const params = new URLSearchParams(location.search);
  let fromEditor = false;
  let sourceKnown = false;
  try {
    const referrer = new URL(document.referrer);
    sourceKnown = referrer.origin !== "https://docs.google.com" || referrer.pathname !== "/";
    fromEditor = referrer.origin === "https://docs.google.com" &&
      /^\/(document|spreadsheets)\//.test(referrer.pathname);
  } catch (_error) {
    // Some embedded share panels omit the full referrer.
  }

  if (!sourceKnown) {
    fromEditor = ["ritz", "kix"].includes(params.get("foreignService")) &&
      params.get("origin") === "https://docs.google.com";
  }
  if (!fromEditor) {
    return;
  }

  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const apply = () => document.documentElement?.setAttribute(
    "data-gdt-share-dark", media.matches ? "on" : "off"
  );
  apply();
  if (!document.documentElement) {
    document.addEventListener("DOMContentLoaded", apply, { once: true });
  }
  if (typeof media.addEventListener === "function") {
    media.addEventListener("change", apply);
  } else {
    media.addListener(apply);
  }
})();
