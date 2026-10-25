# Medaily Copilot

Chromium Manifest V3 extension that injects a floating chat assistant on every page. Ask questions about the current page; the background service worker calls **medaily-ai** at `https://ai.medaily.id.vn`.

Built for **Ngô Nhân**.

**Load unpacked path (canonical):** `/home/awish/workspace/me/code/medaily-copilot`

## Load unpacked in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select this repository folder (the one that contains `manifest.json`)
4. Pin **Medaily Copilot** from the toolbar
5. Open any website — click the teal launcher (bottom-right) to open the chatbox

## Configure the API

Click the extension icon to open settings:

| Setting | Purpose |
| --- | --- |
| API key | `SERVICE_TOKEN` — sent as `Authorization: Bearer <key>` (required) |
| Chat launcher | Small × on the FAB (or the eye-off control in the open panel) hides the launcher; restore via **Show chat launcher again** |

The API host is fixed at `https://ai.medaily.id.vn` (not editable in the popup).

A stable `userId` UUID is created automatically on first live call and stored in `chrome.storage.sync` (required by medaily-ai). Replace it with a real Medaily user UUID if you want the agent to read that person's data.

## medaily-ai request / response

```http
POST https://ai.medaily.id.vn/api/chat
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
background/medaily-client.js   # live HTTP client
content/chatbox.js             # Shadow DOM chat UI on every page
content/chatbox.css            # Host-page isolation stub
popup/                         # API key + show launcher
shared/defaults.js             # Hardcoded AI host + settings defaults
icons/                         # Extension icons
```

## Manual test checklist

1. Load unpacked → open `https://example.com` → launcher appears bottom-right
2. Open chat without an API key → clear error asking for SERVICE_TOKEN
3. Paste SERVICE_TOKEN in the popup → Save → ask about the page → live reply (or clear HTTP error)
4. Hide the FAB with × → popup **Show chat launcher again** restores it

## Notes

- No account system or database — API key + auto `userId` in `chrome.storage.sync`
- The chat UI uses a closed Shadow DOM so host-page CSS does not restyle the panel
- Content scripts run at `document_idle` on `<all_urls>`
- `host_permissions` include `https://ai.medaily.id.vn/*` for the live AI host
