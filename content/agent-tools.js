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

  function inViewport(el) {
    const r = el.getBoundingClientRect();
    return (
      r.bottom > 0 &&
      r.right > 0 &&
      r.top < window.innerHeight &&
      r.left < window.innerWidth
    );
  }

  function textOf(node) {
    return (node?.innerText || node?.textContent || "").replace(/\s+/g, " ").trim();
  }

  const FORM_ITEM_SELECTOR =
    ".ant-form-item, .ant-row, .MuiFormControl-root, .form-group, .el-form-item, .v-input, [class*='form-item'], [class*='FormItem']";

  /** Visible form label: <label for>, aria-labelledby, or the field wrapper's label (Ant/MUI/Bootstrap). */
  function formLabelOf(el) {
    const own = el.labels?.length ? textOf(el.labels[0]) : "";
    if (own) return own;
    const ids = (el.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean);
    const byIds = ids.map((id) => textOf(document.getElementById(id))).join(" ").trim();
    if (byIds) return byIds;
    const item = el.closest(FORM_ITEM_SELECTOR);
    const label = item?.querySelector("label, .ant-form-item-label, [class*='label']");
    if (label && !label.contains(el)) return textOf(label);
    return "";
  }

  function labelOf(el) {
    const field =
      ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) ||
      ["combobox", "textbox", "listbox", "spinbutton"].includes(el.getAttribute("role") || "");
    return (
      el.getAttribute("aria-label") ||
      (field ? formLabelOf(el) : "") ||
      el.getAttribute("title") ||
      el.getAttribute("placeholder") ||
      el.getAttribute("name") ||
      el.getAttribute("data-placeholder") ||
      // A <select>'s text is every option glued together — not a name.
      (el.tagName === "SELECT" ? "" : textOf(el).slice(0, 80))
    ).slice(0, 80);
  }

  /** Current value so the planner can see what is already filled. */
  function valueOf(el) {
    if (el.tagName === "SELECT") {
      return textOf(el.selectedOptions?.[0]) || el.value || "";
    }
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      if ((el.type || "").toLowerCase() === "password") return el.value ? "***" : "";
      if (["checkbox", "radio"].includes((el.type || "").toLowerCase())) {
        return el.checked ? "checked" : "unchecked";
      }
      return el.value || "";
    }
    if (el.getAttribute("role") === "combobox") {
      const shown = el.closest(".ant-select, [class*='select']")?.querySelector(
        ".ant-select-selection-item, [class*='singleValue'], [class*='selection-item']"
      );
      return textOf(shown);
    }
    return "";
  }

  function contentEditableAttr(el) {
    if (!el || el.nodeType !== 1) return null;
    const raw = el.getAttribute("contenteditable");
    if (raw === null) return null;
    return raw.toLowerCase();
  }

  /** True for input/textarea/contenteditable (incl. empty contenteditable=""). */
  function isDirectlyEditable(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.closest?.("#medaily-copilot-root")) return false;
    const tag = el.tagName;
    if (tag === "TEXTAREA") return !el.disabled && !el.readOnly;
    if (tag === "INPUT") {
      const type = (el.type || "text").toLowerCase();
      return (
        ["text", "search", "email", "url", "tel", "password", "number", ""].includes(
          type
        ) &&
        !el.disabled &&
        !el.readOnly
      );
    }
    if (el.isContentEditable) return true;
    const ce = contentEditableAttr(el);
    return ce === "" || ce === "true" || ce === "plaintext-only";
  }

  /**
   * If el is a wrapper (role=textbox / composer shell), prefer nested
   * contenteditable / textarea / input (ChatGPT ProseMirror).
   */
  function deepestEditable(el) {
    if (!el) return null;
    if (isDirectlyEditable(el)) return el;
    const nested = el.querySelector?.(
      '[contenteditable="true"], [contenteditable=""], [contenteditable=plaintext-only], textarea, input:not([type=hidden]):not([type=submit]):not([type=button]), [role="textbox"][contenteditable]'
    );
    if (nested && isDirectlyEditable(nested)) return nested;
    // role=textbox that is itself contenteditable after attr sync
    const textboxes = el.querySelectorAll?.('[role="textbox"]') || [];
    for (const tb of textboxes) {
      if (isDirectlyEditable(tb)) return tb;
      const inner = tb.querySelector?.(
        '[contenteditable="true"], [contenteditable=""], .ProseMirror, p[data-placeholder], div[data-placeholder]'
      );
      if (inner) {
        const editable =
          isDirectlyEditable(inner)
            ? inner
            : inner.closest?.("[contenteditable]") ||
              inner.querySelector?.("[contenteditable]");
        if (editable && isDirectlyEditable(editable)) return editable;
        // ProseMirror root often is the contenteditable
        if (inner.classList?.contains("ProseMirror") && isDirectlyEditable(inner)) {
          return inner;
        }
        const pm = el.querySelector?.(".ProseMirror[contenteditable], .ProseMirror");
        if (pm && (isDirectlyEditable(pm) || contentEditableAttr(pm) !== "false")) {
          return pm;
        }
      }
    }
    const pm = el.querySelector?.(".ProseMirror");
    if (pm) return pm;
    return isDirectlyEditable(el) ? el : null;
  }

  function findChatComposerFallback() {
    const selectors = [
      '#prompt-textarea',
      '[data-testid="prompt-textarea"]',
      'div.ProseMirror[contenteditable="true"]',
      'div.ProseMirror[contenteditable=""]',
      '[contenteditable="true"][role="textbox"]',
      '[role="textbox"][contenteditable="true"]',
      '[role="textbox"]',
      'textarea[name="prompt-textarea"]',
      'textarea[placeholder*="Message" i]',
      'textarea[placeholder*="Ask" i]',
    ];
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (!el || !visible(el)) continue;
        const editable = deepestEditable(el) || el;
        if (editable && (isDirectlyEditable(editable) || editable.classList?.contains("ProseMirror"))) {
          return editable;
        }
      } catch {
        // ignore bad selectors
      }
    }
    return null;
  }

  function listInteractive(args = {}) {
    const limit = Math.min(Number(args.limit) || 40, 80);
    refMap = new Map();
    // Drop refs from the previous snapshot so a stale "e3" can't match by attribute.
    for (const old of document.querySelectorAll(`[${REF_ATTR}]`)) {
      old.removeAttribute(REF_ATTR);
    }
    const selector = [
      "a[href]",
      "button",
      '[role="button"]',
      "input:not([type=hidden])",
      "textarea",
      "select",
      '[role="combobox"]',
      '[role="option"]',
      '[role="checkbox"]',
      '[role="radio"]',
      '[role="tab"]',
      '[contenteditable="true"]',
      '[contenteditable=""]',
      '[contenteditable="plaintext-only"]',
      ".ProseMirror",
      '[role="link"]',
      '[role="textbox"]',
      '[role="menuitem"]',
      '#prompt-textarea',
    ].join(", ");
    const raw = [...document.querySelectorAll(selector)].filter(visible);
    /** Prefer actual editables; skip wrappers that only contain a listed child. */
    const nodes = [];
    const seen = new Set();
    for (const el of raw) {
      const target =
        el.getAttribute("role") === "textbox" ||
        el.classList?.contains("ProseMirror") ||
        contentEditableAttr(el) !== null
          ? deepestEditable(el) || el
          : el;
      // Dedupe: if we already listed the nested contenteditable, skip outer shell.
      if (seen.has(target)) continue;
      // Skip outer role=textbox when nested editable differs and will be listed.
      if (
        el !== target &&
        el.getAttribute("role") === "textbox" &&
        isDirectlyEditable(target)
      ) {
        // list the nested editable instead
      }
      if (
        el !== target &&
        raw.includes(target) &&
        isDirectlyEditable(target) &&
        !isDirectlyEditable(el)
      ) {
        // outer wrapper — skip; nested will appear as its own node
        continue;
      }
      seen.add(target);
      nodes.push(target);
    }

    // Elements on screen first, then the rest in DOM order (sort is stable).
    nodes.sort((a, b) => Number(inViewport(b)) - Number(inViewport(a)));

    const items = [];
    let i = 0;
    for (const el of nodes) {
      if (items.length >= limit) break;
      const ref = `e${++i}`;
      el.setAttribute(REF_ATTR, ref);
      refMap.set(ref, el);
      const editable = isDirectlyEditable(el) || el.classList?.contains("ProseMirror");
      items.push({
        ref,
        tag: el.tagName.toLowerCase(),
        role:
          el.getAttribute("role") ||
          (editable ? "textbox" : el.tagName.toLowerCase()),
        name: labelOf(el) || (editable ? "(composer)" : ""),
        value: valueOf(el).slice(0, 60),
        type: el.getAttribute("type") || (editable ? "editable" : undefined),
        editable: Boolean(editable),
        css: cssPath(el).slice(0, 200),
      });
    }
    return { ok: true, count: items.length, elements: items };
  }

  /** Planners (esp. medaily-ai) name the target arg differently — fold aliases into ref/css/text. */
  function normalizeTargetArgs(args = {}) {
    const out = { ...args };
    const refLike = out.ref ?? out.elementRef ?? out.element_ref ?? out.element ?? out.id ?? out.target;
    if (!out.ref && refLike != null && /^e\d+$/.test(String(refLike).replace(/^\[|\]$/g, ""))) {
      out.ref = String(refLike).replace(/^\[|\]$/g, "");
    }
    if (!out.css) out.css = out.selector ?? out.cssSelector ?? out.css_selector;
    if (!out.text) out.text = out.label ?? out.field ?? out.name ?? out.textContent;
    if (out.ref) out.ref = String(out.ref).replace(/^\[|\]$/g, "");
    return out;
  }

  function resolveTarget(rawArgs = {}) {
    const args = normalizeTargetArgs(rawArgs);
    let el = null;
    if (args.ref && refMap.has(String(args.ref))) {
      el = refMap.get(String(args.ref));
    } else if (args.ref) {
      el = document.querySelector(
        `[${REF_ATTR}="${CSS.escape(String(args.ref))}"]`
      );
    }
    if (!el && args.css) {
      try {
        el = document.querySelector(String(args.css));
      } catch {
        // invalid selector
      }
    }
    const text = String(args.text || "").trim().toLowerCase();
    const role = String(args.role || "").trim().toLowerCase();
    if (!el && (text || role)) {
      const candidates = [
        ...document.querySelectorAll(
          'a[href], button, [role="button"], input, textarea, [role="textbox"], [contenteditable="true"], [contenteditable=""], .ProseMirror, [role="link"], [role="menuitem"]'
        ),
      ].filter(visible);
      for (const cand of candidates) {
        const name = labelOf(cand).toLowerCase();
        const elRole = (cand.getAttribute("role") || cand.tagName).toLowerCase();
        if (role && !elRole.includes(role) && cand.tagName.toLowerCase() !== role) {
          continue;
        }
        if (text && !name.includes(text) && !name.startsWith(text)) continue;
        el = cand;
        break;
      }
    }
    return el || null;
  }

  /** Resolve + unwrap to a typeable control. */
  function resolveEditableTarget(args = {}) {
    const raw = resolveTarget(args);
    const located = normalizeTargetArgs(args);
    const hasLocator = Boolean(located.ref || located.css || located.text || located.role);
    let el = raw?.tagName === "LABEL" && raw.control ? raw.control : deepestEditable(raw);
    // Ref on a label / wrapper: look for the input inside the same form item.
    if (!el && raw) {
      el = deepestEditable(raw.closest(FORM_ITEM_SELECTOR)) || deepestEditable(raw.parentElement);
    }
    // No target given: the field the previous click focused.
    if (!el && !hasLocator && document.activeElement !== document.body) {
      el = deepestEditable(document.activeElement);
    }
    if (!el) el = findChatComposerFallback();
    return el;
  }

  /** For type, `text` is the value — never use it to find the field. */
  function typeLocator(args = {}) {
    const { text, value, content, input, ...locator } = args;
    return locator;
  }

  function typedValue(args = {}) {
    return args.text ?? args.value ?? args.content ?? args.input ?? "";
  }

  /** Why a type target failed, phrased so the planner can correct itself. */
  function describeTypeFailure(args) {
    const raw = resolveTarget(args);
    if (!raw) {
      return `No element matches ${JSON.stringify(args).slice(0, 160)} — use a ref from the snapshot`;
    }
    const role = raw.getAttribute("role") || raw.tagName.toLowerCase();
    const hint =
      raw.tagName === "SELECT"
        ? "; use select_option"
        : /combobox|listbox|button/.test(role)
          ? "; it is a dropdown — click it, then click the option"
          : "";
    return `Target is <${raw.tagName.toLowerCase()} role=${role}> "${labelOf(raw)}", not a text input${hint}`;
  }

  function click(args = {}) {
    const el = resolveTarget(args);
    if (!el) {
      return {
        ok: false,
        error: `Target not found for click (args=${JSON.stringify(args).slice(0, 160)}). Use a ref from the snapshot.`,
      };
    }
    // A native <select> can't be opened by script — steer the planner to select_option.
    if (el.tagName === "SELECT") {
      return {
        ok: false,
        error: `This is a native <select>; use select_option. Options: ${[...el.options]
          .map((o) => textOf(o))
          .filter(Boolean)
          .join(" | ")
          .slice(0, 400)}`,
      };
    }
    el.scrollIntoView?.({ block: "center", inline: "nearest" });
    const r = el.getBoundingClientRect();
    const point = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2,
      button: 0,
    };
    // Many dropdown libraries open on pointerdown/mousedown, not click.
    el.dispatchEvent(new PointerEvent("pointerdown", { ...point, pointerType: "mouse", isPrimary: true }));
    el.dispatchEvent(new MouseEvent("mousedown", point));
    el.focus?.();
    el.dispatchEvent(new PointerEvent("pointerup", { ...point, pointerType: "mouse", isPrimary: true }));
    el.dispatchEvent(new MouseEvent("mouseup", point));
    // Exactly one click — dispatching one and calling el.click() toggled dropdowns shut.
    if (typeof el.click === "function") el.click();
    else el.dispatchEvent(new MouseEvent("click", point));
    return { ok: true, method: "click", name: labelOf(el), css: cssPath(el) };
  }

  function dispatchEditableInput(el, data, inputType) {
    try {
      el.dispatchEvent(
        new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          composed: true,
          data,
          inputType: inputType || "insertText",
        })
      );
    } catch {
      // older engines
    }
    try {
      el.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          cancelable: false,
          composed: true,
          data,
          inputType: inputType || "insertText",
        })
      );
    } catch {
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  function typeIntoContentEditable(el, text, clear) {
    el.focus();
    // Click to ensure ProseMirror/ChatGPT attaches selection.
    el.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window })
    );
    el.dispatchEvent(
      new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window })
    );
    el.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, view: window })
    );

    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      if (clear) {
        sel?.removeAllRanges();
        sel?.addRange(range);
        // Prefer execCommand paths React/ProseMirror often observe.
        const okDelete = document.execCommand("delete", false, null);
        if (!okDelete) {
          document.execCommand("selectAll", false, null);
          document.execCommand("delete", false, null);
        }
      } else {
        range.collapse(false);
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    } catch {
      // ignore selection failures
    }

    let inserted = false;
    try {
      inserted = document.execCommand("insertText", false, text);
    } catch {
      inserted = false;
    }

    if (!inserted) {
      try {
        dispatchEditableInput(el, text, clear ? "insertReplacementText" : "insertText");
        if (clear) {
          el.textContent = text;
          // Keep a paragraph for ProseMirror-like editors
          if (!el.childNodes.length) {
            const p = document.createElement("p");
            p.textContent = text;
            el.appendChild(p);
          }
        } else {
          el.textContent = `${el.textContent || ""}${text}`;
        }
        inserted = true;
      } catch {
        el.innerText = clear ? text : `${el.innerText || ""}${text}`;
        inserted = true;
      }
    }

    dispatchEditableInput(el, text, "insertText");
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return inserted;
  }

  function typeInto(args = {}) {
    const text = String(typedValue(args));
    const locator = typeLocator(args);
    const el = resolveEditableTarget(locator);
    if (!el || el === document.body) {
      return { ok: false, error: describeTypeFailure(locator) };
    }

    const clear = args.clear !== false;
    const tag = el.tagName;
    const ce = contentEditableAttr(el);
    const asContentEditable =
      el.isContentEditable ||
      ce === "" ||
      ce === "true" ||
      ce === "plaintext-only" ||
      el.classList?.contains("ProseMirror") ||
      el.getAttribute("role") === "textbox";

    if (asContentEditable && tag !== "INPUT" && tag !== "TEXTAREA") {
      // If role=textbox wrapper slipped through, unwrap again.
      const target = deepestEditable(el) || el;
      typeIntoContentEditable(target, text, clear);
      return {
        ok: true,
        method: "type",
        kind: "contenteditable",
        css: cssPath(target),
      };
    }

    if (tag === "INPUT" || tag === "TEXTAREA" || "value" in el) {
      el.focus?.();
      const proto =
        tag === "TEXTAREA"
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      const next = clear ? text : `${el.value || ""}${text}`;
      if (setter) setter.call(el, next);
      else el.value = next;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, method: "type", kind: "value", css: cssPath(el) };
    }

    // Last resort: try contenteditable path anyway (some hosts lie about flags).
    try {
      typeIntoContentEditable(el, text, clear);
      return {
        ok: true,
        method: "type",
        kind: "fallback-contenteditable",
        css: cssPath(el),
      };
    } catch (err) {
      return {
        ok: false,
        error: `Element is not editable (${err?.message || "unknown"})`,
      };
    }
  }

  function pressKey(args = {}) {
    const key = String(args.key || "Enter");
    const el =
      resolveEditableTarget(args) ||
      resolveTarget(args) ||
      document.activeElement ||
      document.body;
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

  /** Native <select>: pick by option value or visible text. */
  function selectOption(args = {}) {
    const el = resolveTarget(args);
    if (!el || el.tagName !== "SELECT") {
      return {
        ok: false,
        error: "Target is not a native <select> — click the dropdown, then click the option",
      };
    }
    const wanted = String(args.option ?? "").trim().toLowerCase();
    const opt = [...el.options].find(
      (o) => o.value.toLowerCase() === wanted || textOf(o).toLowerCase() === wanted
    ) || [...el.options].find((o) => textOf(o).toLowerCase().includes(wanted));
    if (!opt) {
      return {
        ok: false,
        error: `No option "${args.option}". Options: ${[...el.options].map((o) => textOf(o)).join(" | ").slice(0, 300)}`,
      };
    }
    el.focus?.();
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    if (setter) setter.call(el, opt.value);
    else el.value = opt.value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, method: "select_option", selected: textOf(opt) };
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
        (e) =>
          `- [${e.ref}] ${e.role} "${e.name}"${e.value ? ` value="${e.value}"` : ""} css=${e.css}`
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
    "select_option",
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
      case "select_option":
        return selectOption(args);
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
    const args = normalizeTargetArgs(action?.args || {});
    const el = args.ref ? refMap.get(String(args.ref)) : null;
    const field = el ? labelOf(el) : "";
    const value =
      tool === "type" ? typedValue(args) : tool === "select_option" ? args.option : "";
    const target =
      [field || args.ref || args.css || (tool === "type" ? "" : args.text), value && `← "${value}"`]
        .filter(Boolean)
        .join(" ") ||
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
