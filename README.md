# Medaily Copilot

Chromium Manifest V3 extension that injects a floating chat assistant on every page. Ask questions about the current page; the background service worker calls **medaily-ai** at `https://ai.medaily.id.vn` (or a built-in mock when Mock mode is on / no key is set).

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
| API base URL | `https://ai.medaily.id.vn` | Origin of medaily-ai (no trailing slash required) |
| API key | _(empty)_ | `SERVICE_TOKEN` — sent as `Authorization: Bearer <key>` |
| Mock mode | **on** | Skip the network and invent replies from page context |
| Chat launcher | visible | Small × on the FAB (or the eye-off control in the open panel) hides the launcher; restore via **Show chat launcher again** in the popup |

Mock mode stays on by default so the extension works with zero credentials. Turn it off, paste the service token, and leave the base URL at the production host to hit the real API.

A stable `userId` UUID is created automatically on first live call and stored in `chrome.storage.sync` (required by medaily-ai). Replace it with a real Medaily user UUID if you want the agent to read that person's data.

## medaily-ai request / response

Live calls:

```http
POST {apiBaseUrl}/api/chat
Content-Type: application/json
Authorization: Bearer {apiKey}
```

```json
{
  "message": "What is this page about?\n\n[Page context]\nTitle: …\nURL: …",
  "userId": "00000000-0000-4000-8000-000000000000",
  "threadId": "optional-from-previous-reply",
  "timezone": "Asia/Ho_Chi_Minh"
}
```

Response field used for the chat bubble:

```json
{ "answer": "This page explains…", "threadId": "…" }
```

The product web app streams the same body via `POST /api/chat/live` through its own BFF; the extension uses the non-streaming `/api/chat` JSON route.

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
5. Set API key to the real `SERVICE_TOKEN`, disable mock, keep base URL `https://ai.medaily.id.vn` → live reply appears (or a clear HTTP error banner)

## Notes

- No account system or database — API key + auto `userId` in `chrome.storage.sync`
- The chat UI uses a closed Shadow DOM so host-page CSS does not restyle the panel
- Content scripts run at `document_idle` on `<all_urls>`
- `host_permissions` include `https://ai.medaily.id.vn/*` for the live AI host
