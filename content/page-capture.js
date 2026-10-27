/**
 * Image helpers for Chat attachments and Agent vision (content script).
 * Everything is downscaled to JPEG base64 before it leaves the page to keep
 * provider token cost low. No data:/blob: URL loading, so page CSP can't block it.
 */
(() => {
  const ROOT_ID = "medaily-copilot-root";

  function bytesToBase64(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(s);
  }

  function base64ToBlob(b64, type) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type });
  }

  /**
   * @param {Blob} blob
   * @param {{maxSide?: number, quality?: number}} [opts]
   * @returns {Promise<{mimeType: string, data: string, dataUrl: string, width: number, height: number}>}
   */
  async function downscale(blob, opts = {}) {
    const maxSide = opts.maxSide || 1568;
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    // JPEG has no alpha — paint white under transparent PNGs.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const out = await canvas.convertToBlob({
      type: "image/jpeg",
      quality: opts.quality || 0.82,
    });
    const data = bytesToBase64(new Uint8Array(await out.arrayBuffer()));
    return {
      mimeType: "image/jpeg",
      data,
      dataUrl: `data:image/jpeg;base64,${data}`,
      width,
      height,
    };
  }

  /** Pasted / dropped / picked image file → downscaled JPEG. */
  async function fromFile(file, opts) {
    if (!file?.type?.startsWith("image/")) {
      throw new Error("Only image files are supported");
    }
    return downscale(file, opts);
  }

  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

  /**
   * Screenshot of the visible tab with the Copilot panel hidden.
   * @param {{maxSide?: number, quality?: number}} [opts]
   */
  async function captureVisible(opts) {
    const host = document.getElementById(ROOT_ID);
    const prev = host?.style.visibility ?? "";
    if (host) host.style.visibility = "hidden";
    let res;
    try {
      await nextFrame();
      await nextFrame();
      res = await chrome.runtime.sendMessage({ type: "MEDAILY_CAPTURE_TAB" });
    } finally {
      if (host) host.style.visibility = prev;
    }
    if (!res?.ok) throw new Error(res?.error || "Screenshot failed");
    const b64 = String(res.dataUrl).split(",")[1] || "";
    return downscale(base64ToBlob(b64, "image/jpeg"), opts);
  }

  globalThis.MedailyCapture = { fromFile, captureVisible };
})();
