/**
 * Agent tool runtime for Medaily Copilot (content script).
 * Mutating tools should be confirmed by the panel before calling runTool.
 */
(() => {
  const REF_ATTR = "data-medaily-agent-ref";
  /** @type {Map<string, Element>} */
  let refMap = new Map();

  function caps() {
    return (
      globalThis.MedailySiteRegistry?.getCapabilities?.() || {
        insert: false,
        send: false,
      }
    );
  }

  function cssPath(el) {
    if (!el || el.nodeType !== 1) return "";
    if (el.id) return `#${CSS.escape(el.id)}`;
    const parts = [];
    let node = el;
    for (let i = 0; i < 5 && node && node.nodeType === 1; i++) {
      let part = node.tagName.toLowerCase();
      if (node.classList?.length) {
        part += `.${[...node.classList].slice(0, 2).map((c) => CSS.escape(c)).join(".")}`;
      }
      const parent = node.parentElement;
      if (parent) {
        const siblings = [...parent.children].filter((c) => c.tagName === node.tagName);
        if (siblings.length > 1) {
          part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
        }
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(" > ");
  }

  function visible(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.closest?.("#medaily-copilot-root")) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2;
  }

  function labelOf(el) {
    return (
      el.getAttribute("aria-label") ||
      el.getAttribute("title") ||
      el.getAttribute("placeholder") ||
      el.getAttribute("name") ||
      (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80)
    );
  }

  function listInteractive(args = {}) {
    const limit = Math.min(Number(args.limit) || 40, 80);
    refMap = new Map();
    const selector =
      'a[href], button, [role="button"], input, textarea, select, [contenteditable="true"], [role="link"], [role="textbox"], [role="menuitem"]';
    const nodes = [...document.querySelectorAll(selector)].filter(visible);
    const items = [];
    let i = 0;
    for (const el of nodes) {
      if (items.length >= limit) break;
      const ref = `e${++i}`;
      el.setAttribute(REF_ATTR, ref);
      refMap.set(ref, el);
      items.push({
        ref,
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute("role") || el.tagName.toLowerCase(),
        name: labelOf(el),
        type: el.getAttribute("type") || undefined,
        css: cssPath(el).slice(0, 200),
      });
    }
    return { ok: true, count: items.length, elements: items };
  }

  function resolveTarget(args = {}) {
    if (args.ref && refMap.has(String(args.ref))) {
      return refMap.get(String(args.ref));
    }
    if (args.ref) {
      const byAttr = document.querySelector(`[${REF_ATTR}="${CSS.escape(String(args.ref))}"]`);
      if (byAttr) return byAttr;
    }
    if (args.css) {
      try {
        const el = document.querySelector(String(args.css));
        if (el) return el;
      } catch {
        // invalid selector
      }
    }
    const text = String(args.text || "").trim().toLowerCase();
    const role = String(args.role || "").trim().toLowerCase();
    if (text || role) {
      const candidates = [
        ...document.querySelectorAll(
          'a[href], button, [role="button"], input, [role="link"], [role="menuitem"]'
        ),
      ].filter(visible);
      for (const el of candidates) {
        const name = labelOf(el).toLowerCase();
        const elRole = (el.getAttribute("role") || el.tagName).toLowerCase();
        if (role && !elRole.includes(role) && el.tagName.toLowerCase() !== role) continue;
        if (text && !name.includes(text) && !name.startsWith(text)) continue;
        if (text || role) return el;
      }
    }
    return null;
  }

  function click(args = {}) {
    const el = resolveTarget(args);
    if (!el) return { ok: false, error: "Target not found for click" };
    if (el.tagName === "A" && el.href) {
      // Prefer in-page activation without forcing navigation via assign.
      el.focus();
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      if (typeof el.click === "function") el.click();
      return { ok: true, method: "click", name: labelOf(el), css: cssPath(el) };
    }
    el.focus?.();
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    if (typeof el.click === "function") el.click();
    return { ok: true, method: "click", name: labelOf(el), css: cssPath(el) };
  }

  function typeInto(args = {}) {
    const text = String(args.text ?? "");
    const el = resolveTarget(args) || document.activeElement;
    if (!el || el === document.body) {
      return { ok: false, error: "No input target for type" };
    }
    el.focus?.();
    const clear = args.clear !== false;
    if (el.isContentEditable) {
      if (clear) {
        try {
          document.execCommand("selectAll", false, null);
          document.execCommand("insertText", false, text);
        } catch {
          el.textContent = text;
        }
      } else {
        try {
          document.execCommand("insertText", false, text);
        } catch {
          el.textContent = (el.textContent || "") + text;
        }
      }
      el.dispatchEvent(new InputEvent("input", { bubbles: true, data: text }));
      return { ok: true, method: "type", css: cssPath(el) };
    }
    if ("value" in el) {
      const proto =
        el.tagName === "TEXTAREA"
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      const next = clear ? text : `${el.value || ""}${text}`;
      if (setter) setter.call(el, next);
      else el.value = next;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, method: "type", css: cssPath(el) };
    }
    return { ok: false, error: "Element is not editable" };
  }

  function pressKey(args = {}) {
    const key = String(args.key || "Enter");
    const el = resolveTarget(args) || document.activeElement || document.body;
    el.focus?.();
    const init = {
      key,
      code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
      keyCode: key === "Enter" ? 13 : key === "Tab" ? 9 : key === "Escape" ? 27 : 0,
      which: key === "Enter" ? 13 : key === "Tab" ? 9 : key === "Escape" ? 27 : 0,
      bubbles: true,
      cancelable: true,
      composed: true,
    };
    for (const type of ["keydown", "keypress", "keyup"]) {
      const evt = new KeyboardEvent(type, init);
      try {
        Object.defineProperty(evt, "keyCode", { get: () => init.keyCode });
        Object.defineProperty(evt, "which", { get: () => init.which });
      } catch {
        // ignore
      }
      el.dispatchEvent(evt);
    }
    return { ok: true, method: "press_key", key };
  }

  function scroll(args = {}) {
    const amount = Number(args.amount) || 400;
    const dir = String(args.direction || "down").toLowerCase();
    const delta = dir === "up" ? -amount : amount;
    if (args.css) {
      try {
        const el = document.querySelector(String(args.css));
        if (el) {
          el.scrollBy({ top: delta, behavior: "smooth" });
          return { ok: true, method: "scroll", target: "element" };
        }
      } catch {
        // fall through
      }
    }
    window.scrollBy({ top: delta, behavior: "smooth" });
    return { ok: true, method: "scroll", target: "window" };
  }

  function waitFor(args = {}) {
    const ms = Math.min(Number(args.ms) || 0, 10000);
    const timeoutMs = Math.min(Number(args.timeoutMs) || 5000, 15000);
    const css = args.css ? String(args.css) : "";
    return new Promise((resolve) => {
      if (!css) {
        setTimeout(() => resolve({ ok: true, method: "wait", ms }), ms || 300);
        return;
      }
      const start = Date.now();
      const tick = () => {
        try {
          if (document.querySelector(css)) {
            resolve({ ok: true, method: "wait", found: css });
            return;
          }
        } catch {
          resolve({ ok: false, error: "Invalid wait selector" });
          return;
        }
        if (Date.now() - start > timeoutMs) {
          resolve({ ok: false, error: `Timeout waiting for ${css}` });
          return;
        }
        setTimeout(tick, 100);
      };
      setTimeout(tick, ms || 0);
    });
  }

  function readText(args = {}) {
    const maxChars = Math.min(Number(args.maxChars) || 3000, 8000);
    let root = document.body;
    if (args.css) {
      try {
        root = document.querySelector(String(args.css)) || document.body;
      } catch {
        return { ok: false, error: "Invalid css for read_text" };
      }
    }
    const text = (root.innerText || root.textContent || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxChars);
    return { ok: true, text, length: text.length };
  }

  function insertComposer(args = {}) {
    if (!caps().insert) {
      return { ok: false, error: "insert_composer not allowed on this site" };
    }
    const kit = globalThis.MedailyPageKit;
    if (!kit?.insertIntoComposer) {
      return { ok: false, error: "page-kit missing" };
    }
    return kit.insertIntoComposer(String(args.text || ""));
  }

  function sendComposer() {
    if (!caps().send) {
      return { ok: false, error: "send_composer not allowed on this site" };
    }
    const kit = globalThis.MedailyPageKit;
    if (!kit?.clickSend) {
      return { ok: false, error: "page-kit missing" };
    }
    return kit.clickSend(kit.findComposer?.());
  }

  async function getNetwork(args = {}) {
    const limit = Math.min(Number(args.limit) || 20, 50);
    try {
      const res = await chrome.runtime.sendMessage({
        type: "MEDAILY_GET_NETWORK",
        limit,
      });
      if (!res?.ok) {
        return { ok: false, error: res?.error || "get_network failed" };
      }
      return { ok: true, requests: res.requests || [] };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  }

  function buildSnapshot(maxInteractive = 30) {
    const listed = listInteractive({ limit: maxInteractive });
    const title = document.title || "";
    const url = location.href;
    const excerpt = (document.body?.innerText || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 2500);
    const lines = [
      `URL: ${url}`,
      `Title: ${title}`,
      `Caps: insert=${caps().insert} send=${caps().send}`,
      "",
      "Interactive:",
      ...listed.elements.map(
        (e) => `- [${e.ref}] ${e.role} "${e.name}" css=${e.css}`
      ),
      "",
      `Excerpt: ${excerpt}`,
    ];
    return {
      text: lines.join("\n"),
      interactive: listed.elements,
      url,
      title,
    };
  }

  const MUTATING = new Set([
    "click",
    "type",
    "press_key",
    "insert_composer",
    "send_composer",
  ]);

  async function runTool(tool, args = {}) {
    switch (tool) {
      case "list_interactive":
        return listInteractive(args);
      case "click":
        return click(args);
      case "type":
        return typeInto(args);
      case "press_key":
        return pressKey(args);
      case "scroll":
        return scroll(args);
      case "wait":
        return waitFor(args);
      case "read_text":
        return readText(args);
      case "insert_composer":
        return insertComposer(args);
      case "send_composer":
        return sendComposer(args);
      case "get_network":
        return getNetwork(args);
      default:
        return { ok: false, error: `Unknown tool: ${tool}` };
    }
  }

  function describeAction(action) {
    const tool = action?.tool || "?";
    const args = action?.args || {};
    const target =
      args.ref ||
      args.css ||
      args.text ||
      args.key ||
      (tool === "send_composer" ? "(composer send)" : "") ||
      "";
    return { tool, target: String(target).slice(0, 120), reason: action?.reason || "" };
  }

  globalThis.MedailyAgentTools = {
    runTool,
    buildSnapshot,
    isMutating: (tool) => MUTATING.has(tool),
    describeAction,
    listInteractive,
  };
})();
