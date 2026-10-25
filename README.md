# Medaily Copilot

Chromium Manifest V3 extension that injects a floating chat assistant on every page. Ask questions about the current page; the background service worker calls a **medaily-ai** HTTP API (or a built-in mock when no credentials are configured).

Built for **Ngô Nhân**.

## Load unpacked in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select this repository folder (the one that contains `manifest.json`)
4. Pin **Medaily Copilot** from the toolbar
5. Open any website — click the teal launcher (bottom-right) to open the chatbox

## Configure the API

Click the extension icon to open settings:

| Setting | Default | Purpose |
| --- | --- | --- |
| API base URL | `http://127.0.0.1:8787` | Origin of your medaily-ai service (no trailing slash required) |
| API key | _(empty)_ | Sent as `Authorization: Bearer <key>` |
| Mock mode | **on** | Skip the network and invent replies from page context |

Mock mode stays on by default so the extension works with zero credentials. Turn it off and set a base URL + key to hit a real service.

## medaily-ai request / response contract

The service worker sends:

```http
POST {apiBaseUrl}/v1/chat
Content-Type: application/json
Authorization: Bearer {apiKey}
```

```json
{
  "messages": [
    { "role": "user", "content": "What is this page about?" }
  ],
  "context": {
    "url": "https://example.com/docs",
    "title": "Example Docs",
    "selection": "optional selected text",
    "pageText": "truncated visible page text (up to ~4000 chars)"
  }
}
```

Expected JSON response (any one of these shapes works):

```json
{ "reply": "This page explains…" }
```

Also accepted:

```json
{ "message": { "role": "assistant", "content": "…" } }
```

```json
{ "choices": [{ "message": { "content": "…" } }] }
```

Wire your real medaily-ai service to that path, paste the base URL and key into the popup, disable Mock mode, and reload the extension if needed.

## Project layout

```
manifest.json
background/service-worker.js   # message router + storage bootstrap
background/medaily-client.js   # HTTP client + mock fallback
content/chatbox.js             # Shadow DOM chat UI on every page
content/chatbox.css            # Host-page isolation stub
popup/                         # API URL / key / mock toggle
shared/defaults.js             # Shared settings defaults + contract notes
icons/                         # Extension icons
```

## Manual test checklist

1. Load unpacked → open `https://example.com` → launcher appears bottom-right
2. Open chat → empty state shows → ask “Summarize this page” → mock reply references the title/URL
3. Select text on the page → ask about the selection → mock reply includes the selection
4. Open the popup → turn Mock mode off without a key → Save shows a validation error
5. Point API base URL at a local stub that implements `POST /v1/chat`, add a key, disable mock → live reply appears (or a clear HTTP error banner)

## Notes

- No account system or database — only the API key in `chrome.storage.sync`
- The chat UI uses a closed Shadow DOM so host-page CSS does not restyle the panel
- Content scripts run at `document_idle` on `<all_urls>`
