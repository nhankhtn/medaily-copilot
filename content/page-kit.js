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

  /**
   * Walk up from the composer to a tight chat/compose container.
   * Never return document — that caused FB page reloads via wrong "Send" hits.
   */
  function composerSearchRoots(composer) {
    if (!composer) return [];
    const roots = [];
    const push = (el) => {
      if (el && el.nodeType === 1 && !roots.includes(el) && el !== document.body && el !== document.documentElement) {
        roots.push(el);
      }
    };

    push(composer.closest('[aria-label*="Conversation" i]'));
    push(composer.closest('[aria-label*="Tin nhắn" i]'));
    push(composer.closest('[aria-label*="Messages" i]'));
    push(composer.closest('[data-pagelet*="MWThread"]'));
    push(composer.closest('[data-pagelet*="ChatTab"]'));
    push(composer.closest('[role="dialog"]'));
    push(composer.closest('[role="main"]'));
    // Gmail compose tray / reply box
    push(composer.closest(".btC")?.parentElement);
    push(composer.closest(".gU")?.parentElement);
    push(composer.closest(".aO7"));
    push(composer.closest("form"));

    // Local ancestry only (max ~8 levels) — keep search near the message box.
    let node = composer.parentElement;
    for (let i = 0; i < 8 && node; i++) {
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
      return true; // never click bare form submits
    }
    const href = el.getAttribute?.("href");
    if (href && href !== "#" && !href.startsWith("javascript:")) return true;
    return false;
  }

  function looksLikeComposerSend(el, composer) {
    if (!el || isNavigational(el)) return false;
    if (el === composer || el.contains?.(composer)) return false;
    if (el.disabled || el.getAttribute("aria-disabled") === "true") return false;

    const rect = el.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) return false;
    if (rect.bottom < 0 || rect.top > innerHeight) return false;

    // Must be near the composer (same pane), not elsewhere on the page.
    const cRect = composer.getBoundingClientRect();
    const cx = cRect.left + cRect.width / 2;
    const cy = cRect.top + cRect.height / 2;
    const bx = rect.left + rect.width / 2;
    const by = rect.top + rect.height / 2;
    const dist = Math.hypot(bx - cx, by - cy);
    if (dist > 280) return false;
    // Send usually sits to the right / same row as the composer.
    if (by < cRect.top - 80) return false;

    const label = labelOf(el);
    const lower = label.toLowerCase();

    // Hard rejects — common FB/Gmail false positives that navigate or do other actions.
    if (
      /(send feedback|send money|send invite|send gift|messenger\s*send|share|navigate|back to|đóng|close chat|search|tìm kiếm)/i.test(
        lower
      )
    ) {
      return false;
    }

    // High-confidence Messenger / FB labels.
    if (/press enter to send|nhấn enter để gửi|press\s*enter.*gửi/i.test(lower)) {
      return true;
    }
    // Exact-ish send labels (not "Send to…", "Sender", …).
    if (/^(send|gửi|gửi tin nhắn|send message)$/i.test(label.trim())) {
      return true;
    }
    if (
      (/^send\b/i.test(lower) || /^gửi\b/i.test(lower)) &&
      label.trim().length <= 28 &&
      !/sender|sending|sent|resend/i.test(lower)
    ) {
      return true;
    }

    // Gmail / generic compose toolbar: role=button with short Send/Gửi label.
    if (
      (el.getAttribute("role") === "button" || el.tagName === "DIV") &&
      /^(send|gửi)\b/i.test(lower) &&
      lower.length < 40
    ) {
      return true;
    }

    const testId = el.getAttribute("data-testid") || "";
    if (/^send$/i.test(testId) || /composer.*send|send.*composer/i.test(testId)) {
      return true;
    }

    return false;
  }

  function scoreSendCandidate(el, composer) {
    const cRect = composer.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    const dist = Math.hypot(
      rect.left + rect.width / 2 - (cRect.left + cRect.width / 2),
      rect.top + rect.height / 2 - (cRect.top + cRect.height / 2)
    );
    let score = 1000 - dist;
    const label = labelOf(el).toLowerCase();
    if (/press enter to send|nhấn enter để gửi/i.test(label)) score += 400;
    if (/^(send|gửi)$/i.test(label.trim())) score += 200;
    // Prefer right of composer.
    if (rect.left >= cRect.left) score += 40;
    return score;
  }

  /**
   * Composer-scoped only. Never falls back to document.querySelector("…send…")
   * or button[type=submit] — those reloaded Facebook.
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
      '[aria-label^="Send" i]',
      '[aria-label^="Gửi" i]',
      '[data-testid="send"]',
      '[data-testid*="composer-send" i]',
      '[role="button"][aria-label*="Send" i]',
      '[role="button"][aria-label*="Gửi" i]',
      'div[aria-label*="Send" i]',
      'div[aria-label*="Gửi" i]',
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
    // Require a confident score (near composer + send-like label).
    if (scoreSendCandidate(best, composer) < 700) return null;
    return best;
  }

  function clickSend(near) {
    const composer = near && isEditable(near) ? near : findComposer();
    const btn = findSendControl(composer);
    if (!btn || isNavigational(btn) || !looksLikeComposerSend(btn, composer)) {
      return {
        ok: false,
        error:
          "Không tìm thấy nút Gửi — đã Chèn, hãy bấm Send trên trang.",
        insertedOnly: true,
      };
    }

    try {
      // Focus composer first so FB/Messenger bind send to the open thread.
      composer?.focus?.();
      btn.focus?.();
      // Native click — do not submit forms or dispatch Enter (that navigated FB).
      const evt = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window,
        buttons: 1,
      });
      btn.dispatchEvent(evt);
      if (typeof btn.click === "function") {
        btn.click();
      }
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error:
          "Không gửi được — đã Chèn, hãy bấm Send trên trang.",
        insertedOnly: true,
      };
    }
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
