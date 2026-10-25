/**
 * Per-tab recent network request buffer for Agent mode get_network.
 * MV3 webRequest onCompleted — url/method/status/type only (no bodies).
 */

const MAX_PER_TAB = 80;
/** @type {Map<number, Array<{ts:number,url:string,method:string,status:number,type:string,fromCache:boolean}>>} */
const buffers = new Map();

export function recordCompleted(details) {
  if (typeof details?.tabId !== "number" || details.tabId < 0) return;
  const entry = {
    ts: Date.now(),
    url: String(details.url || "").slice(0, 500),
    method: String(details.method || "GET").toUpperCase(),
    status: Number(details.statusCode) || 0,
    type: String(details.type || ""),
    fromCache: Boolean(details.fromCache),
  };
  const list = buffers.get(details.tabId) || [];
  list.push(entry);
  if (list.length > MAX_PER_TAB) list.splice(0, list.length - MAX_PER_TAB);
  buffers.set(details.tabId, list);
}

export function getRecent(tabId, limit = 20) {
  const list = buffers.get(tabId) || [];
  const n = Math.min(Math.max(1, Number(limit) || 20), MAX_PER_TAB);
  return list.slice(-n);
}

export function clearTab(tabId) {
  buffers.delete(tabId);
}

export function installWebRequestListener() {
  if (!chrome.webRequest?.onCompleted) {
    console.warn("[medaily-copilot] webRequest unavailable — get_network will be empty");
    return;
  }
  chrome.webRequest.onCompleted.addListener(
    (details) => {
      try {
        recordCompleted(details);
      } catch {
        // ignore
      }
    },
    { urls: ["<all_urls>"] }
  );
  chrome.tabs?.onRemoved?.addListener((tabId) => clearTab(tabId));
}
