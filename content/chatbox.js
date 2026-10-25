(() => {
  if (window.__medailyCopilotInjected) return;
  window.__medailyCopilotInjected = true;

  const ROOT_ID = "medaily-copilot-root";
  const FONT_HREF =
    "https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&family=Syne:wght@600;700;800&display=swap";

  /** @type {{role: "user"|"assistant"|"system", content: string}[]} */
  let messages = [];
  let open = false;
  let loading = false;
  let errorText = "";
  let launcherHidden = false;

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

    .dock, .panel, button, textarea {
      pointer-events: auto;
    }

    .dock {
      position: fixed;
      right: 20px;
      bottom: 20px;
      width: 56px;
      height: 56px;
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
    }

    .launcher {
      width: 56px;
      height: 56px;
      border: 0;
      border-radius: 18px;
      background: linear-gradient(145deg, #1c3140 0%, #0f1a22 55%, #16353a 100%);
      color: var(--text);
      box-shadow: var(--shadow), inset 0 0 0 1px rgba(46, 196, 182, 0.35);
      cursor: pointer;
      display: grid;
      place-items: center;
      transition: transform 180ms ease, box-shadow 180ms ease;
    }
    .launcher:hover { transform: translateY(-2px) scale(1.03); }
    .launcher:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 3px;
    }
    .launcher svg { width: 24px; height: 24px; }

    .hide-fab {
      position: absolute;
      top: -6px;
      right: -6px;
      width: 22px;
      height: 22px;
      border: 0;
      border-radius: 999px;
      padding: 0;
      display: grid;
      place-items: center;
      cursor: pointer;
      color: var(--muted);
      background: linear-gradient(145deg, #243441 0%, #152028 100%);
      box-shadow: 0 4px 12px rgba(8, 14, 20, 0.4), inset 0 0 0 1px rgba(46, 196, 182, 0.28);
      opacity: 0.72;
      transition: opacity 140ms ease, color 140ms ease, transform 140ms ease;
    }
    .dock:hover .hide-fab,
    .hide-fab:focus-visible {
      opacity: 1;
      color: var(--text);
    }
    .hide-fab:hover { transform: scale(1.06); color: #ffb4b4; }
    .hide-fab:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
    .hide-fab svg { width: 10px; height: 10px; display: block; }

    .panel {
      position: fixed;
      right: 20px;
      bottom: 20px;
      width: min(380px, calc(100vw - 32px));
      height: min(560px, calc(100vh - 40px));
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
      transform: translateY(12px) scale(0.98);
      pointer-events: none;
      transition: opacity 200ms ease, transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
    }
    .panel.open {
      opacity: 1;
      transform: translateY(0) scale(1);
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
    }
    .bubble.assistant {
      align-self: flex-start;
      background: var(--panel-2);
      border: 1px solid var(--line);
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
      color: var(--muted);
    }

    .error {
      margin: 0 14px 8px;
      padding: 8px 10px;
      border-radius: 10px;
      background: rgba(255, 107, 107, 0.12);
      border: 1px solid rgba(255, 107, 107, 0.35);
      color: #ffb4b4;
      font-size: 12.5px;
      line-height: 1.4;
    }

    .composer {
      padding: 10px 12px 12px;
      border-top: 1px solid var(--line);
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
    textarea:disabled { opacity: 0.65; }

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
    .send:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
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
      .panel, .launcher { right: 12px; bottom: 12px; }
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
    <div class="error" data-el="error" hidden></div>
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
    error: panel.querySelector('[data-el="error"]'),
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
    const title = (document.title || "").trim() || location.hostname || "this page";
    els.subtitle.textContent = truncate(title, 48);
    els.subtitle.title = title;
  }

  function setOpen(next) {
    open = next;
    panel.classList.toggle("open", open);
    launcher.setAttribute("aria-expanded", String(open));
    dock.setAttribute("data-expanded", String(open));
    if (open) {
      render();
      queueMicrotask(() => els.input.focus());
    }
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
      empty.innerHTML = `
        <strong>Page-aware assistant</strong>
        Ask what this page is about, summarize a section, or clarify selected text.
        Replies use medaily-ai (or a local mock until you configure an API key).
      `;
      els.messages.appendChild(empty);
    }

    for (const msg of messages) {
      const bubble = document.createElement("div");
      bubble.className = `bubble ${msg.role}`;
      bubble.textContent = msg.content;
      if (msg.source) {
        const meta = document.createElement("span");
        meta.className = "meta";
        meta.textContent = msg.source === "mock" ? "Mock reply" : "medaily-ai";
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

    if (errorText) {
      els.error.hidden = false;
      els.error.textContent = errorText;
    } else {
      els.error.hidden = true;
      els.error.textContent = "";
    }

    els.input.disabled = loading;
    els.send.disabled = loading || !els.input.value.trim();
    els.messages.scrollTop = els.messages.scrollHeight;
  }

  function collectContext() {
    const selection = window.getSelection()?.toString()?.trim() || "";
    const pageText = extractPageText(4000);
    return {
      url: location.href,
      title: document.title || "",
      selection: selection || undefined,
      pageText: pageText || undefined,
    };
  }

  function extractPageText(maxChars) {
    const clone = document.body ? document.body.cloneNode(true) : null;
    if (!clone) return "";
    clone
      .querySelectorAll(
        "script,style,noscript,svg,canvas,iframe,#medaily-copilot-root"
      )
      .forEach((n) => n.remove());
    const text = (clone.innerText || clone.textContent || "").replace(/\s+/g, " ").trim();
    return text.slice(0, maxChars);
  }

  async function sendMessage(text) {
    const content = text.trim();
    if (!content || loading) return;

    errorText = "";
    messages.push({ role: "user", content });
    loading = true;
    els.input.value = "";
    render();

    try {
      const response = await chrome.runtime.sendMessage({
        type: "MEDAILY_CHAT",
        payload: {
          messages: messages.map(({ role, content: c }) => ({ role, content: c })),
          context: collectContext(),
        },
      });

      if (!response?.ok) {
        throw new Error(response?.error || "Unknown error from extension");
      }

      messages.push({
        role: "assistant",
        content: response.reply,
        source: response.source,
      });
    } catch (err) {
      errorText = err?.message || String(err);
    } finally {
      loading = false;
      render();
      els.input.focus();
    }
  }

  launcher.addEventListener("click", () => {
    if (launcherHidden) return;
    setOpen(true);
  });
  hideFab.addEventListener("click", (e) => {
    e.stopPropagation();
    setLauncherHidden(true);
  });
  els.close.addEventListener("click", () => setOpen(false));
  els.hide.addEventListener("click", () => setLauncherHidden(true));

  els.input.addEventListener("input", () => {
    els.send.disabled = loading || !els.input.value.trim();
    els.input.style.height = "auto";
    els.input.style.height = `${Math.min(els.input.scrollHeight, 120)}px`;
  });

  els.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      els.form.requestSubmit();
    }
    if (e.key === "Escape") setOpen(false);
  });

  els.form.addEventListener("submit", (e) => {
    e.preventDefault();
    sendMessage(els.input.value);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && open) setOpen(false);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" || !changes.launcherHidden) return;
    launcherHidden = Boolean(changes.launcherHidden.newValue);
    if (!launcherHidden) host.hidden = false;
    syncLauncherVisibility();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }

  function truncate(s, n) {
    return s.length > n ? `${s.slice(0, n - 1)}…` : s;
  }
})();
