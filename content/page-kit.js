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

  function isFacebookHost() {
    const h = hostOf();
    return (
      h === "facebook.com" ||
      h.endsWith(".facebook.com") ||
      h === "messenger.com" ||
      h.endsWith(".messenger.com")
    );
  }

  /**
   * Tight compose-row / chat pane around the message box.
   * Never returns document — document-wide "Send" reloaded Facebook.
   */
  function findComposeToolbar(composer) {
    if (!composer) return null;
    const cRect = composer.getBoundingClientRect();
    let node = composer.parentElement;
    for (let i = 0; i < 8 && node; i++) {
      if (node === document.body || node === document.documentElement) break;
      const rect = node.getBoundingClientRect();
      const midOk =
        Math.abs((rect.top + rect.bottom) / 2 - (cRect.top + cRect.bottom) / 2) <
        70;
      // Same row, a bit wider than the textbox (room for send / paper-plane).
      if (midOk && rect.width >= cRect.width + 24 && rect.height < 160) {
        return node;
      }
      node = node.parentElement;
    }
    return composer.parentElement;
  }

  function composerSearchRoots(composer) {
    if (!composer) return [];
    const roots = [];
    const push = (el) => {
      if (
        el &&
        el.nodeType === 1 &&
        !roots.includes(el) &&
        el !== document.body &&
        el !== document.documentElement
      ) {
        roots.push(el);
      }
    };

    push(findComposeToolbar(composer));
    push(composer.closest('[aria-label*="Conversation" i]'));
    push(composer.closest('[aria-label*="Tin nhắn" i]'));
    push(composer.closest('[aria-label*="Messages" i]'));
    push(composer.closest('[data-pagelet*="MWThread"]'));
    push(composer.closest('[data-pagelet*="ChatTab"]'));
    push(composer.closest('[role="dialog"]'));
    // Gmail compose tray / reply box (not whole inbox)
    push(composer.closest(".btC")?.parentElement);
    push(composer.closest(".gU")?.parentElement);
    push(composer.closest(".aO7"));
    push(composer.closest('[role="region"]'));

    let node = composer.parentElement;
    for (let i = 0; i < 6 && node; i++) {
      push(node);
      node = node.parentElement;
    }
    return roots;
  }

  function labelOf(el) {
    if (!el) return "";
    return [
      el.getAttribute?.("aria-label"),
      el.getAttribute?.("title"),
      el.getAttribute?.("data-tooltip"),
      el.getAttribute?.("aria-description"),
      el.textContent,
    ]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /** Reject links, nav, page-level submit — anything that can navigate/reload. */
  function isNavigational(el) {
    if (!el || el.nodeType !== 1) return true;
    if (el.closest?.("#medaily-copilot-root")) return true;
    if (el.tagName === "A" || el.closest?.("a[href]")) return true;
    if (el.getAttribute("role") === "link") return true;
    if (el.tagName === "BUTTON" && (el.type || "").toLowerCase() === "submit") {
      return true;
    }
    const href = el.getAttribute?.("href");
    if (href && href !== "#" && !href.startsWith("javascript:")) return true;
    return false;
  }

  function geometryNearComposer(el, composer) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) return null;
    if (rect.bottom < 0 || rect.top > innerHeight) return null;
    const cRect = composer.getBoundingClientRect();
    const cx = cRect.left + cRect.width / 2;
    const cy = cRect.top + cRect.height / 2;
    const bx = rect.left + rect.width / 2;
    const by = rect.top + rect.height / 2;
    const dist = Math.hypot(bx - cx, by - cy);
    const sameRow = Math.abs(by - cy) < 56;
    const toTheRight = rect.left >= cRect.left - 8;
    return { rect, cRect, dist, sameRow, toTheRight, bx, by };
  }

  function looksLikeComposerSend(el, composer) {
    if (!el || isNavigational(el)) return false;
    if (el === composer || el.contains?.(composer)) return false;
    if (el.disabled || el.getAttribute("aria-disabled") === "true") return false;

    const geo = geometryNearComposer(el, composer);
    if (!geo) return false;
    // Same compose toolbar / nearby only.
    if (geo.dist > 360) return false;
    if (geo.by < geo.cRect.top - 90) return false;

    const label = labelOf(el);
    const lower = label.toLowerCase();

    if (
      /(send feedback|send money|send invite|send gift|share|navigate|back to|đóng|close chat|search|tìm kiếm|sticker|emoji|gif|attach|photo|voice|microphone|mic\b|like|react|more actions|nhãn dán|tệp|ảnh)/i.test(
        lower
      )
    ) {
      return false;
    }

    // Messenger / FB primary labels.
    if (/press enter to send|nhấn enter để gửi|press\s*enter.*gửi/i.test(lower)) {
      return true;
    }
    if (/^(send|gửi|gửi tin nhắn|send message)$/i.test(label.trim())) {
      return true;
    }
    if (
      (/^send\b/i.test(lower) || /^gửi\b/i.test(lower)) &&
      label.trim().length <= 40 &&
      !/sender|sending|sent|resend/i.test(lower)
    ) {
      return true;
    }

    if (
      (el.getAttribute("role") === "button" || el.tagName === "DIV") &&
      /^(send|gửi)\b/i.test(lower) &&
      lower.length < 48
    ) {
      return true;
    }

    const testId = el.getAttribute("data-testid") || "";
    if (/^send$/i.test(testId) || /composer.*send|send.*composer/i.test(testId)) {
      return true;
    }

    // Icon-only paper-plane sitting immediately right of the textbox (FB).
    if (
      isFacebookHost() &&
      geo.sameRow &&
      geo.toTheRight &&
      geo.dist < 140 &&
      el.querySelector?.("svg") &&
      (el.getAttribute("role") === "button" ||
        el.tagName === "DIV" ||
        el.tagName === "SPAN") &&
      (lower.length === 0 ||
        /send|gửi|enter/i.test(lower) ||
        label.trim().length <= 2)
    ) {
      return true;
    }

    return false;
  }

  function scoreSendCandidate(el, composer) {
    const geo = geometryNearComposer(el, composer);
    if (!geo) return -1e9;
    let score = 1000 - geo.dist;
    const label = labelOf(el).toLowerCase();
    if (/press enter to send|nhấn enter để gửi/i.test(label)) score += 500;
    if (/^(send|gửi)$/i.test(label.trim())) score += 250;
    if (/\bsend\b|\bgửi\b/i.test(label)) score += 80;
    if (geo.sameRow) score += 80;
    if (geo.toTheRight) score += 60;
    if (el.querySelector?.("svg") && geo.dist < 120) score += 30;
    return score;
  }

  /**
   * Composer-toolbar scoped. Never document.querySelector / form submit.
   */
  function findSendControl(near) {
    const composer = near && isEditable(near) ? near : findComposer();
    if (!composer) return null;

    const roots = composerSearchRoots(composer);
    if (!roots.length) return null;

    const selectorList = [
      '[aria-label*="Press enter to send" i]',
      '[aria-label*="Press Enter to send" i]',
      '[aria-label*="Nhấn Enter để gửi" i]',
      '[aria-label*="nhấn enter để gửi" i]',
      '[aria-label="Send"]',
      '[aria-label="Gửi"]',
      '[aria-label="Send message" i]',
      '[aria-label="Gửi tin nhắn" i]',
      '[aria-label*="Send" i]',
      '[aria-label*="Gửi" i]',
      '[data-testid="send"]',
      '[data-testid*="composer-send" i]',
      '[role="button"][aria-label*="Send" i]',
      '[role="button"][aria-label*="Gửi" i]',
      'div[role="button"]',
      'span[role="button"]',
    ];

    /** @type {Element[]} */
    const candidates = [];
    const seen = new Set();

    for (const root of roots) {
      for (const sel of selectorList) {
        let nodes;
        try {
          nodes = root.querySelectorAll(sel);
        } catch {
          continue;
        }
        nodes.forEach((el) => {
          if (seen.has(el)) return;
          seen.add(el);
          if (looksLikeComposerSend(el, composer)) candidates.push(el);
        });
      }
    }

    if (!candidates.length) return null;

    candidates.sort(
      (a, b) => scoreSendCandidate(b, composer) - scoreSendCandidate(a, composer)
    );
    const best = candidates[0];
    // Softer floor than before — Enter is the FB safety net if this is null.
    if (scoreSendCandidate(best, composer) < 520) return null;
    return best;
  }

  function makeEnterEvent(type) {
    const init = {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      charCode: type === "keypress" ? 13 : 0,
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
    };
    let evt;
    try {
      evt = new KeyboardEvent(type, init);
    } catch {
      evt = document.createEvent("KeyboardEvent");
      evt.initEvent(type, true, true);
    }
    // Chromium often ignores keyCode in the constructor — force for FB listeners.
    try {
      Object.defineProperty(evt, "keyCode", { get: () => 13 });
      Object.defineProperty(evt, "which", { get: () => 13 });
      Object.defineProperty(evt, "key", { get: () => "Enter" });
      Object.defineProperty(evt, "code", { get: () => "Enter" });
    } catch {
      // ignore
    }
    return evt;
  }

  /** FB/Messenger often sends on Enter in the contenteditable — not a form submit. */
  function sendWithEnter(composer) {
    if (!composer || !isEditable(composer)) {
      return { ok: false, error: "Không có ô soạn để gửi Enter." };
    }
    try {
      composer.focus();
      // Place caret at end so Enter applies to the drafted text.
      try {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(composer);
        range.collapse(false);
        sel?.removeAllRanges();
        sel?.addRange(range);
      } catch {
        // ignore caret placement failures
      }
      for (const type of ["keydown", "keypress", "keyup"]) {
        const evt = makeEnterEvent(type);
        const cancelled = !composer.dispatchEvent(evt);
        if (cancelled && type === "keydown") {
          // Handler consumed Enter — treat as attempted send.
          break;
        }
      }
      return { ok: true, method: "enter" };
    } catch {
      return {
        ok: false,
        error: "Enter gửi thất bại — đã Chèn, hãy bấm Send trên trang.",
      };
    }
  }

  function clickSendButton(btn, composer) {
    if (!btn || isNavigational(btn)) {
      return { ok: false, error: "Nút Gửi không an toàn." };
    }
    composer?.focus?.();
    btn.focus?.();
    const evt = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      view: window,
      buttons: 1,
    });
    btn.dispatchEvent(evt);
    if (typeof btn.click === "function") btn.click();
    return { ok: true, method: "button" };
  }

  /**
   * Insert then send: button in compose toolbar, else Enter on FB/Messenger.
   * @returns {{ok: boolean, method?: "button"|"enter", error?: string, insertedOnly?: boolean}}
   */
  function clickSend(near) {
    const composer = near && isEditable(near) ? near : findComposer();
    if (!composer) {
      return {
        ok: false,
        error: "Không tìm thấy ô soạn thảo để gửi.",
        insertedOnly: true,
      };
    }

    // Re-scan after insert — FB often mounts the send control only once text exists.
    const btn = findSendControl(composer);
    if (btn && looksLikeComposerSend(btn, composer) && !isNavigational(btn)) {
      try {
        const clicked = clickSendButton(btn, composer);
        if (clicked.ok) return clicked;
      } catch {
        // fall through to Enter on FB
      }
    }

    if (isFacebookHost()) {
      const entered = sendWithEnter(composer);
      if (entered.ok) return entered;
      return {
        ok: false,
        error:
          entered.error ||
          "Không gửi được (nút + Enter) — đã Chèn, hãy bấm Send trên FB.",
        insertedOnly: true,
      };
    }

    return {
      ok: false,
      error:
        "Không tìm thấy nút Gửi gần ô soạn — đã Chèn, hãy bấm Send trên trang.",
      insertedOnly: true,
    };
  }

  /**
   * Convenience for confirm flow: insert text then send.
   * @returns {{ok: boolean, method?: string, error?: string, inserted?: boolean}}
   */
  function insertAndSend(text) {
    const inserted = insertIntoComposer(text);
    if (!inserted.ok) {
      return { ok: false, error: inserted.error, inserted: false };
    }
    const sent = clickSend(inserted.element);
    if (!sent.ok) {
      return {
        ok: false,
        error: sent.error,
        inserted: true,
        insertedOnly: true,
      };
    }
    return { ok: true, method: sent.method, inserted: true };
  }

  globalThis.MedailyPageKit = {
    extractPageContext,
    findComposer,
    insertIntoComposer,
    findSendControl,
    clickSend,
    insertAndSend,
    sendWithEnter,
    isFacebookHost,
    hostOf,
  };
})();
