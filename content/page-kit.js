/**
 * Pluggable page extractors + composer insert/send helpers for Medaily Copilot.
 * Loaded before chatbox.js (classic content script; attaches to globalThis).
 */
(() => {
  const MAX_THREAD = 6000;
  const MAX_BODY = 5000;

  function hostOf() {
    try {
      return location.hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  }

  function cleanText(node, max) {
    if (!node) return "";
    const text = (node.innerText || node.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
    return text.slice(0, max || 4000);
  }

  function selectionText() {
    try {
      return window.getSelection()?.toString()?.trim() || "";
    } catch {
      return "";
    }
  }

  function genericMainText(maxChars) {
    const root =
      document.querySelector("article") ||
      document.querySelector("main") ||
      document.querySelector('[role="main"]') ||
      document.body;
    if (!root) return "";
    const clone = root.cloneNode(true);
    clone
      .querySelectorAll(
        "script,style,noscript,svg,canvas,iframe,#medaily-copilot-root,nav,footer,aside"
      )
      .forEach((n) => n.remove());
    return cleanText(clone, maxChars);
  }

  /** Facebook / Messenger — best-effort visible chat thread. */
  function extractFacebook() {
    const host = hostOf();
    const isMessenger = host === "messenger.com" || host.endsWith(".messenger.com");
    const isFb =
      host === "facebook.com" ||
      host.endsWith(".facebook.com") ||
      isMessenger;

    if (!isFb) return null;

    const panes = [
      document.querySelector('[aria-label*="Conversation" i]'),
      document.querySelector('[aria-label*="Messages" i]'),
      document.querySelector('[aria-label*="Tin nhắn" i]'),
      document.querySelector('[role="main"]'),
      document.querySelector('[data-pagelet*="MWThread"]'),
      document.querySelector('[data-pagelet*="ChatTab"]'),
    ].filter(Boolean);

    let thread = "";
    for (const pane of panes) {
      const rows = pane.querySelectorAll(
        '[role="row"], [data-scope="messages_table"] > div, div[dir="auto"]'
      );
      const lines = [];
      rows.forEach((row) => {
        const t = cleanText(row, 400);
        if (t.length > 1 && t.length < 800) lines.push(t);
      });
      const uniq = [];
      const seen = new Set();
      for (const line of lines) {
        const key = line.slice(0, 80);
        if (seen.has(key)) continue;
        seen.add(key);
        uniq.push(line);
      }
      thread = uniq.slice(-40).join("\n");
      if (thread.length > 80) break;
    }

    if (!thread) {
      const main = document.querySelector('[role="main"]');
      thread = cleanText(main, MAX_THREAD);
    }

    const peer =
      document.querySelector('h1 span, h2 span, [role="main"] h1, [role="main"] h2')
        ?.textContent?.trim() || "";

    return {
      kind: isMessenger ? "messenger" : "facebook",
      label: isMessenger ? "Messenger" : "Facebook",
      subject: peer || undefined,
      thread: thread.slice(0, MAX_THREAD) || undefined,
      canCompose: true,
    };
  }

  /** Gmail — open email subject + body. */
  function extractGmail() {
    const host = hostOf();
    if (host !== "mail.google.com") return null;

    const subject =
      document.querySelector("h2[data-thread-perm-id]")?.textContent?.trim() ||
      document.querySelector('[data-legacy-thread-id] h2')?.textContent?.trim() ||
      document.querySelector(".hP")?.textContent?.trim() ||
      "";

    const bodyNode =
      document.querySelector(".a3s.aiL") ||
      document.querySelector(".a3s") ||
      document.querySelector('[role="main"] .adn') ||
      document.querySelector('[role="main"]');

    const body = cleanText(bodyNode, MAX_BODY);

    return {
      kind: "gmail",
      label: "Gmail",
      subject: subject || undefined,
      thread: body || undefined,
      canCompose: true,
    };
  }

  function extractGeneric() {
    return {
      kind: "generic",
      label: hostOf() || "page",
      subject: undefined,
      thread: undefined,
      pageText: genericMainText(4000),
      canCompose: Boolean(findComposer()),
    };
  }

  /**
   * @returns {{
   *   url: string,
   *   title: string,
   *   selection?: string,
   *   pageText?: string,
   *   kind: string,
   *   label: string,
   *   subject?: string,
   *   thread?: string,
   *   canCompose: boolean,
   * }}
   */
  function extractPageContext() {
    const selection = selectionText();
    const site = extractFacebook() || extractGmail() || extractGeneric();
    const pageText =
      site.pageText ||
      (!site.thread ? genericMainText(4000) : undefined);

    return {
      url: location.href,
      title: document.title || "",
      selection: selection || undefined,
      pageText: pageText || undefined,
      kind: site.kind,
      label: site.label,
      subject: site.subject,
      thread: site.thread,
      canCompose: Boolean(site.canCompose && findComposer()),
    };
  }

  function isEditable(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.id === "medaily-copilot-root" || el.closest?.("#medaily-copilot-root")) {
      return false;
    }
    const tag = el.tagName;
    if (tag === "TEXTAREA") return !el.disabled && !el.readOnly;
    if (tag === "INPUT") {
      const type = (el.type || "text").toLowerCase();
      return (
        ["text", "search", "email", "url", ""].includes(type) &&
        !el.disabled &&
        !el.readOnly
      );
    }
    return el.isContentEditable;
  }

  function findComposer() {
    const active = document.activeElement;
    if (isEditable(active)) return active;

    const candidates = [
      ...document.querySelectorAll(
        '[contenteditable="true"][role="textbox"], [contenteditable="true"][aria-label], textarea[aria-label], div[aria-label*="Message" i][contenteditable="true"], div[aria-label*="Tin nhắn" i][contenteditable="true"], div[aria-label*="Trả lời" i][contenteditable="true"], textarea[name="to"], div[aria-label*="Reply" i][contenteditable="true"], div[g_editable="true"]'
      ),
    ].filter(isEditable);

    // Prefer visible, near-bottom composers.
    let best = null;
    let bestScore = -1;
    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 16) continue;
      if (rect.bottom < 0 || rect.top > innerHeight) continue;
      const score = rect.bottom + rect.width / 10;
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    return best;
  }

  function setNativeValue(el, value) {
    const proto =
      el.tagName === "TEXTAREA"
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function insertIntoComposer(text) {
    const el = findComposer();
    if (!el) {
      return { ok: false, error: "Không tìm thấy ô soạn thảo trên trang này." };
    }
    el.focus();
    if (el.isContentEditable) {
      try {
        document.execCommand("selectAll", false, null);
        document.execCommand("insertText", false, text);
      } catch {
        el.textContent = text;
      }
      el.dispatchEvent(new InputEvent("input", { bubbles: true, data: text }));
    } else {
      setNativeValue(el, text);
    }
    return { ok: true, element: el };
  }

  function findSendControl(near) {
    const root = near?.closest?.("form") || near?.parentElement || document;
    const selectors = [
      'button[type="submit"]',
      '[aria-label="Send"]',
      '[aria-label="Gửi"]',
      '[aria-label*="Send" i]',
      '[aria-label*="Gửi" i]',
      '[data-testid="send"]',
      '[aria-label*="Press enter to send" i]',
    ];
    for (const sel of selectors) {
      const btn = root.querySelector?.(sel) || document.querySelector(sel);
      if (btn && !btn.disabled) {
        const rect = btn.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) return btn;
      }
    }
    return null;
  }

  function clickSend(near) {
    const btn = findSendControl(near);
    if (!btn) {
      return {
        ok: false,
        error:
          "Đã chèn nội dung, nhưng không thấy nút Gửi rõ ràng — hãy gửi thủ công.",
      };
    }
    btn.click();
    return { ok: true };
  }

  globalThis.MedailyPageKit = {
    extractPageContext,
    findComposer,
    insertIntoComposer,
    findSendControl,
    clickSend,
    hostOf,
  };
})();
