(() => {
  if (window.__medailyCopilotInjected) return;
  window.__medailyCopilotInjected = true;

  const ROOT_ID = "medaily-copilot-root";
  const FONT_HREF =
    "https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&family=Syne:wght@600;700;800&display=swap";

  /** @type {{role: "user"|"assistant"|"system", content: string, source?: string}[]} */
  let messages = [];
  let open = false;
  let loading = false;
  let errorText = "";
  let hintText = "";
  let launcherHidden = false;
  /** Last AI reply usable for Chèn / Gửi (reply drafts). */
  let lastDraft = "";
  /** When true, show explicit confirm before auto-send on the page. */
  let pendingSendConfirm = false;
  /** Content-script ceiling so a hung SW cannot leave the composer locked. */
  const SEND_GUARD_MS = 95_000;

  const SUMMARIZE_PROMPT =
    "Tóm tắt nội dung đang mở trên trang (thread chat / email / đoạn trang). Ngắn gọn, rõ ý chính.";
  const SUGGEST_PROMPT =
    "Gợi ý 1–3 câu trả lời sẵn để dán vào ô soạn thảo. Chỉ viết nội dung trả lời, không giải thích dài.";

  const host = document.createElement("div");
  host.id = ROOT_ID;
  host.setAttribute("data-medaily", "copilot");
  const shadow = host.attachShadow({ mode: "open" });

  const fontLink = document.createElement("link");
  fontLink.rel = "stylesheet";
  fontLink.href = FONT_HREF;
  shadow.appendChild(fontLink);

  const style = document.createElement("style");
  style.textContent = `
    :host, * { box-sizing: border-box; }
    :host {
      --ink: #101820;
      --panel: #17212b;
      --panel-2: #1f2c3a;
      --line: rgba(232, 240, 245, 0.12);
      --text: #eef3f6;
      --muted: #9aafbd;
      --accent: #2ec4b6;
      --accent-2: #f4a261;
      --danger: #ff6b6b;
      --shadow: 0 18px 50px rgba(8, 14, 20, 0.45);
      --radius: 18px;
      font-family: "Figtree", "Segoe UI", sans-serif;
      color: var(--text);
      pointer-events: none;
    }

    /* Only the dock/FAB receives clicks while the panel is closed. Do NOT give
       closed-panel descendants pointer-events:auto — they sat on top of the FAB
       and ate every click after the shrink. */
    .dock,
    .dock .launcher,
    .dock .hide-fab {
      pointer-events: auto;
    }

    .dock {
      position: fixed;
      right: 20px;
      bottom: 20px;
      width: 40px;
      height: 40px;
      z-index: 2;
      transition: opacity 180ms ease, transform 180ms ease;
    }
    .dock[data-hidden="true"] {
      opacity: 0;
      pointer-events: none;
      transform: scale(0.85);
      visibility: hidden;
    }
    .dock[data-expanded="true"] {
      opacity: 0;
      pointer-events: none;
      transform: scale(0.9);
      /* Keep in layout for a11y but never intercept while the panel is open. */
      visibility: hidden;
    }

    .launcher {
      position: relative;
      z-index: 1;
      width: 40px;
      height: 40px;
      border: 0;
      border-radius: 13px;
      background: linear-gradient(145deg, #1c3140 0%, #0f1a22 55%, #16353a 100%);
      color: var(--text);
      box-shadow: var(--shadow), inset 0 0 0 1px rgba(46, 196, 182, 0.35);
      cursor: pointer;
      display: grid;
      place-items: center;
      transition: transform 180ms ease, box-shadow 180ms ease;
    }
    .launcher:hover { transform: translateY(-2px) scale(1.04); }
    .launcher:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
    .launcher svg { width: 18px; height: 18px; }

    /* × badge on the bubble’s top-right corner — small so most of the FAB opens. */
    .hide-fab {
      position: absolute;
      top: -5px;
      right: -5px;
      left: auto;
      width: 15px;
      height: 15px;
      margin-top: 0;
      border: 0;
      border-radius: 999px;
      padding: 0;
      display: grid;
      place-items: center;
      cursor: pointer;
      color: var(--muted);
      background: linear-gradient(145deg, #243441 0%, #152028 100%);
      box-shadow: 0 3px 8px rgba(8, 14, 20, 0.45), inset 0 0 0 1px rgba(46, 196, 182, 0.3);
      opacity: 0;
      pointer-events: none;
      z-index: 3;
      transition: opacity 140ms ease, color 140ms ease, transform 140ms ease;
    }
    .dock:hover .hide-fab,
    .dock:focus-within .hide-fab,
    .hide-fab:focus-visible {
      opacity: 1;
      pointer-events: auto;
      color: var(--text);
    }
    .hide-fab:hover { transform: scale(1.1); color: #ffb4b4; }
    .hide-fab:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 1px;
    }
    .hide-fab svg { width: 8px; height: 8px; display: block; }

    .panel {
      position: fixed;
      right: 20px;
      bottom: 20px;
      width: min(380px, calc(100vw - 32px));
      height: min(560px, calc(100vh - 40px));
      z-index: 1;
      display: flex;
      flex-direction: column;
      background:
        radial-gradient(120% 80% at 100% 0%, rgba(46, 196, 182, 0.18), transparent 55%),
        radial-gradient(90% 70% at 0% 100%, rgba(244, 162, 97, 0.12), transparent 50%),
        linear-gradient(165deg, var(--panel) 0%, #121a22 100%);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      overflow: hidden;
      opacity: 0;
      visibility: hidden;
      transform: translateY(12px) scale(0.98);
      pointer-events: none;
      transition: opacity 200ms ease, transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1), visibility 0s linear 200ms;
    }
    .panel.open {
      opacity: 1;
      visibility: visible;
      transform: translateY(0) scale(1);
      pointer-events: auto;
      transition: opacity 200ms ease, transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1), visibility 0s;
    }
    .panel.open,
    .panel.open * {
      pointer-events: auto;
    }

    .header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      padding: 16px 16px 12px;
      border-bottom: 1px solid var(--line);
    }
    .brand {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    .brand-name {
      font-family: "Syne", "Figtree", sans-serif;
      font-weight: 800;
      font-size: 18px;
      letter-spacing: -0.02em;
      line-height: 1.1;
    }
    .brand-name span { color: var(--accent); }
    .brand-sub {
      font-size: 12px;
      color: var(--muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 260px;
    }
    .header-actions {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }
    .icon-btn {
      width: 32px;
      height: 32px;
      border: 0;
      border-radius: 10px;
      background: transparent;
      color: var(--muted);
      cursor: pointer;
      display: grid;
      place-items: center;
      flex-shrink: 0;
    }
    .icon-btn:hover { background: var(--panel-2); color: var(--text); }
    .icon-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 14px 14px 8px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      scroll-behavior: smooth;
    }
    .messages::-webkit-scrollbar { width: 8px; }
    .messages::-webkit-scrollbar-thumb {
      background: rgba(154, 175, 189, 0.35);
      border-radius: 8px;
    }

    .empty {
      margin: auto 8px;
      text-align: center;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.45;
      padding: 12px;
    }
    .empty strong {
      display: block;
      color: var(--text);
      font-family: "Syne", sans-serif;
      font-size: 15px;
      margin-bottom: 6px;
    }

    .bubble {
      max-width: 92%;
      padding: 10px 12px;
      border-radius: 14px;
      font-size: 13.5px;
      line-height: 1.45;
      white-space: pre-wrap;
      word-break: break-word;
      animation: rise 180ms ease;
    }
    .bubble.user {
      align-self: flex-end;
      background: linear-gradient(135deg, #245a55, #1a3f4a);
      border: 1px solid rgba(46, 196, 182, 0.35);
      color: #f2f7f6;
    }
    .bubble.assistant {
      align-self: flex-start;
      background: #243441;
      border: 1px solid rgba(232, 240, 245, 0.14);
      /* Explicit near-white — do not rely on host inheritance (page CSS can muddy it). */
      color: #f4f7f9;
    }
    .bubble.assistant a {
      color: var(--accent);
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    .bubble.assistant strong,
    .bubble.assistant b {
      color: #ffffff;
      font-weight: 700;
    }
    .bubble.assistant em,
    .bubble.assistant i {
      color: #e8eef2;
    }
    .bubble.assistant code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12.5px;
      color: #dff7f3;
      background: rgba(0, 0, 0, 0.35);
      border: 1px solid rgba(46, 196, 182, 0.25);
      border-radius: 6px;
      padding: 1px 5px;
    }
    .bubble.assistant p,
    .bubble.assistant li,
    .bubble.assistant ul,
    .bubble.assistant ol {
      color: inherit;
      margin: 0 0 0.45em;
    }
    .bubble.assistant ul,
    .bubble.assistant ol {
      padding-left: 1.2em;
    }
    .bubble.assistant p:last-child,
    .bubble.assistant ul:last-child,
    .bubble.assistant ol:last-child {
      margin-bottom: 0;
    }
    .bubble.system {
      align-self: center;
      background: transparent;
      color: var(--muted);
      font-size: 12px;
      border: 0;
      padding: 4px 8px;
    }
    .meta {
      display: block;
      margin-top: 6px;
      font-size: 11px;
      color: #9eb3c0;
    }
    .bubble.assistant .meta {
      color: #a8bcc8;
    }

    .error, .hint, .status {
      margin: 0 14px 8px;
      padding: 8px 10px;
      border-radius: 10px;
      font-size: 12.5px;
      line-height: 1.4;
    }
    .error {
      background: rgba(255, 107, 107, 0.12);
      border: 1px solid rgba(255, 107, 107, 0.35);
      color: #ffb4b4;
    }
    .hint {
      background: rgba(46, 196, 182, 0.1);
      border: 1px solid rgba(46, 196, 182, 0.28);
      color: #b7e6df;
    }
    .status {
      background: rgba(244, 162, 97, 0.1);
      border: 1px solid rgba(244, 162, 97, 0.3);
      color: #f0d0b0;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 8px 12px 0;
      border-top: 1px solid var(--line);
      background: rgba(10, 14, 18, 0.28);
    }
    .action-btn {
      border: 1px solid var(--line);
      border-radius: 999px;
      background: var(--panel-2);
      color: var(--text);
      font: inherit;
      font-size: 12px;
      font-weight: 600;
      padding: 6px 11px;
      cursor: pointer;
      transition: background 140ms ease, border-color 140ms ease, transform 140ms ease;
    }
    .action-btn:hover:not(:disabled) {
      border-color: rgba(46, 196, 182, 0.45);
      background: #2a3c4a;
      transform: translateY(-1px);
    }
    .action-btn:disabled {
      opacity: 0.55;
      cursor: not-allowed;
      transform: none;
    }
    .action-btn:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
    .action-btn.danger {
      border-color: rgba(255, 107, 107, 0.4);
      color: #ffc9c9;
    }

    .confirm {
      margin: 0 12px 8px;
      padding: 10px 12px;
      border-radius: 12px;
      border: 1px solid rgba(255, 107, 107, 0.4);
      background: rgba(255, 107, 107, 0.1);
      display: none;
      flex-direction: column;
      gap: 8px;
    }
    .confirm[data-open="true"] { display: flex; }
    .confirm p {
      margin: 0;
      font-size: 12.5px;
      line-height: 1.4;
      color: #ffd0d0;
    }
    .confirm-row {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }
    .confirm-row button {
      border: 0;
      border-radius: 10px;
      padding: 7px 12px;
      font: inherit;
      font-size: 12.5px;
      font-weight: 700;
      cursor: pointer;
    }
    .confirm-cancel {
      background: var(--panel-2);
      color: var(--text);
    }
    .confirm-ok {
      background: var(--danger);
      color: #1a0505;
    }

    .composer {
      padding: 10px 12px 12px;
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 8px;
      align-items: end;
      background: rgba(10, 14, 18, 0.35);
    }
    textarea {
      width: 100%;
      min-height: 44px;
      max-height: 120px;
      resize: none;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: #0e151c;
      color: var(--text);
      padding: 10px 12px;
      font: inherit;
      font-size: 13.5px;
      line-height: 1.4;
    }
    textarea::placeholder { color: #6f8493; }
    textarea:focus {
      outline: none;
      border-color: rgba(46, 196, 182, 0.55);
      box-shadow: 0 0 0 3px rgba(46, 196, 182, 0.15);
    }
    .send {
      height: 44px;
      min-width: 44px;
      padding: 0 14px;
      border: 0;
      border-radius: 12px;
      background: var(--accent);
      color: #062a28;
      font-weight: 700;
      font-size: 13px;
      cursor: pointer;
      transition: filter 140ms ease, transform 140ms ease;
    }
    .send:hover:not(:disabled) { filter: brightness(1.05); transform: translateY(-1px); }
    .send:disabled {
      opacity: 0.85;
      cursor: progress;
      transform: none;
    }
    .send:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }

    .typing {
      align-self: flex-start;
      display: inline-flex;
      gap: 5px;
      padding: 12px 14px;
      background: var(--panel-2);
      border: 1px solid var(--line);
      border-radius: 14px;
    }
    .typing i {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--muted);
      animation: bounce 1s infinite ease-in-out;
    }
    .typing i:nth-child(2) { animation-delay: 0.15s; }
    .typing i:nth-child(3) { animation-delay: 0.3s; }

    @keyframes rise {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes bounce {
      0%, 80%, 100% { transform: translateY(0); opacity: 0.45; }
      40% { transform: translateY(-4px); opacity: 1; }
    }

    @media (max-width: 480px) {
      .panel, .dock { right: 12px; bottom: 12px; }
      .panel { width: calc(100vw - 24px); height: min(70vh, 560px); }
    }
  `;
  shadow.appendChild(style);

  const dock = document.createElement("div");
  dock.className = "dock";
  dock.setAttribute("data-hidden", "false");
  dock.setAttribute("data-expanded", "false");

  const launcher = document.createElement("button");
  launcher.className = "launcher";
  launcher.type = "button";
  launcher.setAttribute("aria-label", "Open Medaily Copilot");
  launcher.setAttribute("aria-expanded", "false");
  launcher.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v7A2.5 2.5 0 0 1 16.5 16H11l-4.2 3.2c-.7.53-1.8.03-1.8-.84V16A2.5 2.5 0 0 1 5 13.5v-7Z" stroke="currentColor" stroke-width="1.7"/>
      <circle cx="9" cy="10" r="1" fill="#2ec4b6"/>
      <circle cx="12" cy="10" r="1" fill="#2ec4b6"/>
      <circle cx="15" cy="10" r="1" fill="#f4a261"/>
    </svg>
  `;

  const hideFab = document.createElement("button");
  hideFab.className = "hide-fab";
  hideFab.type = "button";
  hideFab.setAttribute("aria-label", "Hide Medaily Copilot launcher");
  hideFab.title = "Hide launcher";
  hideFab.innerHTML = `
    <svg viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    </svg>
  `;

  dock.appendChild(launcher);
  dock.appendChild(hideFab);

  const panel = document.createElement("section");
  panel.className = "panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Medaily Copilot chat");
  panel.innerHTML = `
    <header class="header">
      <div class="brand">
        <div class="brand-name">Medaily <span>Copilot</span></div>
        <div class="brand-sub" data-el="subtitle">Ask about this page</div>
      </div>
      <div class="header-actions">
        <button class="icon-btn" type="button" data-el="hide" aria-label="Hide launcher from this page" title="Hide launcher">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2.5 8s2.2-3.5 5.5-3.5S13.5 8 13.5 8s-2.2 3.5-5.5 3.5S2.5 8 2.5 8Z" stroke="currentColor" stroke-width="1.4"/>
            <circle cx="8" cy="8" r="1.6" fill="currentColor"/>
            <path d="M3 13L13 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>
        <button class="icon-btn" type="button" data-el="close" aria-label="Minimize chat">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
    </header>
    <div class="messages" data-el="messages" aria-live="polite"></div>
    <div class="hint" data-el="hint" hidden></div>
    <div class="status" data-el="status" hidden></div>
    <div class="error" data-el="error" hidden></div>
    <div class="confirm" data-el="confirm" data-open="false" role="alertdialog" aria-label="Confirm send">
      <p data-el="confirm-text">Chèn nội dung rồi nhấn Gửi trên trang?</p>
      <div class="confirm-row">
        <button type="button" class="confirm-cancel" data-el="confirm-cancel">Hủy</button>
        <button type="button" class="confirm-ok" data-el="confirm-ok">Xác nhận gửi</button>
      </div>
    </div>
    <div class="actions" data-el="actions">
      <button type="button" class="action-btn" data-action="summarize">Tóm tắt</button>
      <button type="button" class="action-btn" data-action="suggest">Gợi ý trả lời</button>
      <button type="button" class="action-btn" data-action="insert">Chèn</button>
      <button type="button" class="action-btn danger" data-action="send-page">Gửi</button>
    </div>
    <form class="composer" data-el="form">
      <textarea data-el="input" rows="2" placeholder="Ask about this page…" maxlength="4000"></textarea>
      <button class="send" type="submit" data-el="send">Ask</button>
    </form>
  `;

  shadow.appendChild(dock);
  shadow.appendChild(panel);

  const els = {
    subtitle: panel.querySelector('[data-el="subtitle"]'),
    close: panel.querySelector('[data-el="close"]'),
    hide: panel.querySelector('[data-el="hide"]'),
    messages: panel.querySelector('[data-el="messages"]'),
    hint: panel.querySelector('[data-el="hint"]'),
    status: panel.querySelector('[data-el="status"]'),
    error: panel.querySelector('[data-el="error"]'),
    confirm: panel.querySelector('[data-el="confirm"]'),
    confirmText: panel.querySelector('[data-el="confirm-text"]'),
    confirmCancel: panel.querySelector('[data-el="confirm-cancel"]'),
    confirmOk: panel.querySelector('[data-el="confirm-ok"]'),
    actions: panel.querySelector('[data-el="actions"]'),
    form: panel.querySelector('[data-el="form"]'),
    input: panel.querySelector('[data-el="input"]'),
    send: panel.querySelector('[data-el="send"]'),
  };

  function mount() {
    if (document.getElementById(ROOT_ID)) return;
    const parent = document.documentElement || document.body;
    parent.appendChild(host);
    updateSubtitle();
    syncLauncherVisibility();
    render();
    loadLauncherPreference();
  }

  function updateSubtitle() {
    const ctx = collectContext();
    const title = (ctx.title || "").trim() || location.hostname || "this page";
    const kindLabel =
      ctx.kind && ctx.kind !== "generic"
        ? `${ctx.label || ctx.kind} · `
        : "";
    els.subtitle.textContent = truncate(`${kindLabel}${title}`, 52);
    els.subtitle.title = `${ctx.label || ctx.kind || "page"} — ${title}`;
  }

  function setOpen(next) {
    open = next;
    panel.classList.toggle("open", open);
    launcher.setAttribute("aria-expanded", String(open));
    dock.setAttribute("data-expanded", String(open));
    if (open) {
      updateSubtitle();
      refreshKeyHint();
      render();
      queueMicrotask(() => {
        unlockComposer();
        els.input.focus();
      });
    }
  }

  async function refreshKeyHint() {
    try {
      const stored = await chrome.storage.sync.get({ apiKey: "" });
      const hasKey = Boolean(String(stored.apiKey || "").trim());
      hintText = hasKey
        ? ""
        : "Add your SERVICE_TOKEN in the extension popup to get live replies.";
    } catch {
      hintText =
        "Could not read settings — open the Medaily Copilot popup and save your API key.";
    }
    if (open) render();
  }

  function syncLauncherVisibility() {
    dock.setAttribute("data-hidden", String(launcherHidden));
    if (launcherHidden) {
      if (open) setOpen(false);
      host.hidden = true;
    } else {
      host.hidden = false;
    }
  }

  async function setLauncherHidden(hidden) {
    launcherHidden = Boolean(hidden);
    syncLauncherVisibility();
    try {
      await chrome.storage.sync.set({ launcherHidden });
    } catch {
      // Ignore storage failures — visibility still updates for this page.
    }
  }

  async function loadLauncherPreference() {
    try {
      const stored = await chrome.storage.sync.get({ launcherHidden: false });
      launcherHidden = Boolean(stored.launcherHidden);
      syncLauncherVisibility();
    } catch {
      // Keep default visible.
    }
  }

  function render() {
    els.messages.innerHTML = "";

    if (!messages.length && !loading) {
      const empty = document.createElement("div");
      empty.className = "empty";
      const strong = document.createElement("strong");
      strong.textContent = "Ask about this page";
      empty.appendChild(strong);
      empty.appendChild(
        document.createTextNode(
          "Tóm tắt · Gợi ý trả lời · Chèn vào ô soạn · Gửi (có xác nhận)."
        )
      );
      els.messages.appendChild(empty);
    }

    for (const msg of messages) {
      const bubble = document.createElement("div");
      bubble.className = `bubble ${msg.role}`;
      if (msg.role === "assistant") {
        bubble.innerHTML = formatAssistantHtml(msg.content);
      } else {
        bubble.textContent = msg.content;
      }
      if (msg.source) {
        const meta = document.createElement("span");
        meta.className = "meta";
        meta.textContent = "medaily-ai";
        bubble.appendChild(meta);
      }
      els.messages.appendChild(bubble);
    }

    if (loading) {
      const typing = document.createElement("div");
      typing.className = "typing";
      typing.setAttribute("aria-label", "Assistant is thinking");
      typing.innerHTML = "<i></i><i></i><i></i>";
      els.messages.appendChild(typing);
    }

    if (hintText && !errorText) {
      els.hint.hidden = false;
      els.hint.textContent = hintText;
    } else {
      els.hint.hidden = true;
      els.hint.textContent = "";
    }

    const pageStatus = buildPageStatus();
    if (pageStatus && !errorText) {
      els.status.hidden = false;
      els.status.textContent = pageStatus;
    } else {
      els.status.hidden = true;
      els.status.textContent = "";
    }

    if (errorText) {
      els.error.hidden = false;
      els.error.textContent = errorText;
    } else {
      els.error.hidden = true;
      els.error.textContent = "";
    }

    els.confirm.setAttribute("data-open", pendingSendConfirm ? "true" : "false");

    // Never grey out the textarea. Ask is only blocked while a request is in
    // flight — missing keys / empty text show in-panel errors on send instead.
    unlockComposer();
    els.send.disabled = loading;
    els.send.setAttribute("aria-busy", loading ? "true" : "false");
    els.actions.querySelectorAll(".action-btn").forEach((btn) => {
      btn.disabled = loading;
    });
    els.messages.scrollTop = els.messages.scrollHeight;
  }

  function buildPageStatus() {
    const kit = globalThis.MedailyPageKit;
    if (!kit) return "";
    const ctx = kit.extractPageContext();
    const composer = kit.findComposer();
    const parts = [`Trang: ${ctx.label || ctx.kind}`];
    if (ctx.thread) parts.push("đã đọc thread/email");
    else if (ctx.pageText) parts.push("đã đọc nội dung trang");
    if (!composer) {
      parts.push("Chèn/Gửi: chưa thấy ô soạn thảo");
    } else if (!kit.findSendControl(composer)) {
      parts.push("Gửi: chưa thấy nút gửi rõ ràng");
    } else {
      parts.push("có thể Chèn + Gửi (có xác nhận)");
    }
    return parts.join(" · ");
  }

  function unlockComposer() {
    els.input.disabled = false;
    els.input.readOnly = false;
    els.input.removeAttribute("readonly");
    els.input.removeAttribute("aria-disabled");
    els.input.setAttribute("aria-disabled", "false");
  }

  function collectContext() {
    const kit = globalThis.MedailyPageKit;
    if (kit?.extractPageContext) {
      return kit.extractPageContext();
    }
    // Fallback if page-kit failed to load.
    const selection = window.getSelection()?.toString()?.trim() || "";
    return {
      url: location.href,
      title: document.title || "",
      selection: selection || undefined,
      pageText: extractPageTextFallback(4000) || undefined,
      kind: "generic",
      label: location.hostname || "page",
      canCompose: false,
    };
  }

  function extractPageTextFallback(maxChars) {
    const clone = document.body ? document.body.cloneNode(true) : null;
    if (!clone) return "";
    clone
      .querySelectorAll(
        "script,style,noscript,svg,canvas,iframe,#medaily-copilot-root"
      )
      .forEach((n) => n.remove());
    const text = (clone.innerText || clone.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
    return text.slice(0, maxChars);
  }

  function pickDraftText(reply) {
    const raw = String(reply || "").trim();
    if (!raw) return "";
    // Prefer first numbered/bulleted draft block if present.
    const lines = raw.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    const drafts = lines.filter((l) => /^(\d+[\).]|[-•*])\s+/.test(l));
    if (drafts.length) {
      return drafts
        .map((l) => l.replace(/^(\d+[\).]|[-•*])\s+/, ""))
        .join("\n\n");
    }
    return raw;
  }

  async function sendMessage(text, opts = {}) {
    const content = text.trim();
    if (loading) return;
    if (!content) {
      errorText = "Type a question in this panel, then press Ask.";
      render();
      els.input.focus();
      return;
    }

    errorText = "";
    pendingSendConfirm = false;
    messages.push({ role: "user", content });
    loading = true;
    if (!opts.keepInput) els.input.value = "";
    updateSubtitle();
    render();

    let guardTimer;
    try {
      // Re-read key at send time so a popup Save is picked up without reload.
      const stored = await chrome.storage.sync.get({ apiKey: "" });
      if (!String(stored.apiKey || "").trim()) {
        throw new Error(
          "API key missing — save your SERVICE_TOKEN in the Medaily Copilot toolbar popup, then Ask again."
        );
      }

      const response = await Promise.race([
        chrome.runtime.sendMessage({
          type: "MEDAILY_CHAT",
          payload: {
            messages: messages.map(({ role, content: c }) => ({
              role,
              content: c,
            })),
            context: collectContext(),
          },
        }),
        new Promise((_, reject) => {
          guardTimer = setTimeout(
            () =>
              reject(
                new Error(
                  "Request timed out — check your API key in the popup, then try again."
                )
              ),
            SEND_GUARD_MS
          );
        }),
      ]);

      if (chrome.runtime.lastError) {
        throw new Error(chrome.runtime.lastError.message);
      }
      if (!response) {
        throw new Error(
          "No reply from the extension — reload Medaily Copilot on chrome://extensions and try again."
        );
      }
      if (!response.ok) {
        throw new Error(response.error || "Unknown error from extension");
      }

      messages.push({
        role: "assistant",
        content: response.reply,
        source: response.source,
      });
      if (opts.captureDraft !== false) {
        lastDraft = pickDraftText(response.reply);
      }
      hintText = "";
    } catch (err) {
      errorText = err?.message || String(err);
      await refreshKeyHint();
    } finally {
      clearTimeout(guardTimer);
      loading = false;
      unlockComposer();
      render();
      els.input.focus();
    }
  }

  function resolveInsertText() {
    const selectedInPanel = (() => {
      try {
        const sel = shadow.getSelection?.() || window.getSelection();
        if (!sel || sel.isCollapsed) return "";
        const text = sel.toString().trim();
        if (!text) return "";
        // Only use selection if it lives inside our panel.
        const node = sel.anchorNode;
        if (node && (panel.contains(node) || shadow.contains(node))) return text;
      } catch {
        // ignore
      }
      return "";
    })();
    return selectedInPanel || lastDraft || "";
  }

  function insertDraft() {
    const kit = globalThis.MedailyPageKit;
    if (!kit) {
      errorText = "Page kit chưa sẵn sàng — reload extension.";
      render();
      return false;
    }
    const text = resolveInsertText();
    if (!text) {
      errorText =
        "Chưa có bản nháp để chèn — dùng Gợi ý trả lời trước, hoặc bôi đen một đoạn trong panel.";
      render();
      return false;
    }
    const result = kit.insertIntoComposer(text);
    if (!result.ok) {
      errorText = result.error || "Không chèn được.";
      render();
      return false;
    }
    errorText = "";
    hintText = "Đã chèn vào ô soạn thảo trên trang.";
    render();
    return true;
  }

  function requestSendConfirm() {
    const kit = globalThis.MedailyPageKit;
    if (!kit) {
      errorText = "Page kit chưa sẵn sàng — reload extension.";
      render();
      return;
    }
    const composer = kit.findComposer();
    if (!composer) {
      errorText =
        "Trang này chưa hỗ trợ Chèn/Gửi — không tìm thấy ô soạn thảo (contenteditable/textarea).";
      pendingSendConfirm = false;
      render();
      return;
    }
    if (!kit.findSendControl(composer)) {
      errorText =
        "Đã có ô soạn, nhưng không thấy nút Gửi rõ ràng. Dùng Chèn rồi gửi thủ công trên trang.";
      pendingSendConfirm = false;
      render();
      return;
    }
    const text = resolveInsertText();
    if (!text) {
      errorText =
        "Chưa có nội dung để gửi — Gợi ý trả lời trước, hoặc bôi đen draft trong panel.";
      pendingSendConfirm = false;
      render();
      return;
    }
    errorText = "";
    pendingSendConfirm = true;
    els.confirmText.textContent =
      "Sẽ chèn bản nháp vào ô soạn thảo rồi nhấn Gửi trên trang. Xác nhận? (không gửi im lặng)";
    render();
  }

  function confirmAndSend() {
    pendingSendConfirm = false;
    const kit = globalThis.MedailyPageKit;
    if (!kit) {
      errorText = "Page kit chưa sẵn sàng.";
      render();
      return;
    }
    if (!insertDraft()) return;
    const composer = kit.findComposer();
    const sent = kit.clickSend(composer);
    if (!sent.ok) {
      errorText = sent.error || "Không gửi được.";
      hintText = "Đã chèn — hãy gửi thủ công trên trang.";
      render();
      return;
    }
    hintText = "Đã chèn và gửi trên trang.";
    errorText = "";
    render();
  }

  function onActionClick(action) {
    if (loading) return;
    if (action === "summarize") {
      sendMessage(SUMMARIZE_PROMPT, { captureDraft: false });
      return;
    }
    if (action === "suggest") {
      sendMessage(SUGGEST_PROMPT, { captureDraft: true });
      return;
    }
    if (action === "insert") {
      insertDraft();
      return;
    }
    if (action === "send-page") {
      requestSendConfirm();
    }
  }

  launcher.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (launcherHidden) return;
    setOpen(true);
  });
  // Hide must not bubble to the launcher / dock open path.
  hideFab.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    setLauncherHidden(true);
  });
  hideFab.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  els.close.addEventListener("click", () => setOpen(false));
  els.hide.addEventListener("click", () => setLauncherHidden(true));

  els.actions.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn || btn.disabled) return;
    onActionClick(btn.getAttribute("data-action"));
  });

  els.confirmCancel.addEventListener("click", () => {
    pendingSendConfirm = false;
    render();
  });
  els.confirmOk.addEventListener("click", () => confirmAndSend());

  els.input.addEventListener("input", () => {
    unlockComposer();
    els.send.disabled = loading;
    els.input.style.height = "auto";
    els.input.style.height = `${Math.min(els.input.scrollHeight, 120)}px`;
  });

  els.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      els.form.requestSubmit();
    }
    if (e.key === "Escape") {
      if (pendingSendConfirm) {
        pendingSendConfirm = false;
        render();
        return;
      }
      setOpen(false);
    }
  });

  els.form.addEventListener("submit", (e) => {
    e.preventDefault();
    sendMessage(els.input.value);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && open) {
      if (pendingSendConfirm) {
        pendingSendConfirm = false;
        render();
        return;
      }
      setOpen(false);
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    if (changes.launcherHidden) {
      launcherHidden = Boolean(changes.launcherHidden.newValue);
      if (!launcherHidden) host.hidden = false;
      syncLauncherVisibility();
    }
    if (changes.apiKey) {
      // Popup Save → clear/refresh hint immediately without waiting for reopen.
      refreshKeyHint();
      unlockComposer();
      if (open) render();
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }

  function truncate(s, n) {
    return s.length > n ? `${s.slice(0, n - 1)}…` : s;
  }

  /** Escape HTML, then apply a tiny markdown subset for assistant bubbles. */
  function formatAssistantHtml(raw) {
    let s = escapeHtml(String(raw ?? ""));
    // Links: [label](https://…)
    s = s.replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
    );
    // Bold / italic / inline code
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    // Simple bullet lines
    s = s.replace(/(^|\n)[-*] (.+)/g, "$1• $2");
    return s;
  }

  function escapeHtml(s) {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
})();
