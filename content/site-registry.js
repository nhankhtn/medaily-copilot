/**
 * Host → capability registry for Medaily Copilot panel actions.
 * Loaded before page-kit / chatbox (classic content script).
 *
 * insert/send are Facebook/Messenger only — other sites get summarize + suggest.
 */
(() => {
  /** @typedef {{ summarize: boolean, suggestReply: boolean, insert: boolean, send: boolean }} Caps */

  /** @type {Caps} */
  const DEFAULT_CAPS = {
    summarize: true,
    suggestReply: true,
    insert: false,
    send: false,
  };

  /** @type {Caps} */
  const FACEBOOK_CAPS = {
    summarize: true,
    suggestReply: true,
    insert: true,
    send: true,
  };

  /**
   * First matching rule wins. Host is compared without leading www.
   * @type {{ test: (host: string) => boolean, caps: Caps, id: string }[]}
   */
  const RULES = [
    {
      id: "facebook",
      test: (host) =>
        host === "facebook.com" || host.endsWith(".facebook.com"),
      caps: FACEBOOK_CAPS,
    },
    {
      id: "messenger",
      test: (host) =>
        host === "messenger.com" || host.endsWith(".messenger.com"),
      caps: FACEBOOK_CAPS,
    },
  ];

  function normalizeHost(hostname) {
    try {
      return String(hostname || location.hostname || "")
        .replace(/^www\./i, "")
        .toLowerCase();
    } catch {
      return "";
    }
  }

  /**
   * @param {string} [hostname]
   * @returns {Caps & { host: string, siteId: string }}
   */
  function getCapabilities(hostname) {
    const host = normalizeHost(hostname);
    for (const rule of RULES) {
      if (rule.test(host)) {
        return { ...rule.caps, host, siteId: rule.id };
      }
    }
    return { ...DEFAULT_CAPS, host, siteId: "generic" };
  }

  function canInsert(hostname) {
    return Boolean(getCapabilities(hostname).insert);
  }

  function canSend(hostname) {
    return Boolean(getCapabilities(hostname).send);
  }

  globalThis.MedailySiteRegistry = {
    DEFAULT_CAPS,
    FACEBOOK_CAPS,
    RULES,
    normalizeHost,
    getCapabilities,
    canInsert,
    canSend,
  };
})();
