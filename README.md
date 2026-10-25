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

A dedicated Copilot `userId` UUID is created automatically and stored in `chrome.storage.sync`. It is **not** your Medaily login id. Copilot calls a **separate** AI path that never uses the in-app assistant prompt, never files finance/plan notes, and never reads your Medaily ledger/goals tables.

## medaily-ai request / response

```http
POST https://ai.medaily.id.vn/api/extension/chat
Content-Type: application/json
Authorization: Bearer {apiKey}
```

```json
{
  "message": "[Browser Copilot] …\n\n[Current page]\nURL: …\nTitle: …\n\n[User question]\n…",
  "userId": "copilot-uuid",
  "threadId": "optional",
  "history": [{ "role": "user", "text": "…" }]
}
```

Response:

```json
{ "answer": "Bạn đang ở Facebook (https://…).", "threadId": "…" }
```

The product app still uses `POST /api/chat/live` via its BFF — unchanged.

## Project layout

```
manifest.json
background/service-worker.js   # message router + storage bootstrap
background/medaily-client.js   # live HTTP client
content/page-kit.js            # Pluggable extractors + composer insert/send
content/chatbox.js             # Shadow DOM chat UI on every page
content/chatbox.css            # Host-page isolation stub
popup/                         # API key + show launcher
shared/defaults.js             # Hardcoded AI host + settings defaults
icons/                         # Extension icons
```

## Page actions

Panel buttons (Vietnamese labels): **Tóm tắt**, **Gợi ý trả lời**, **Chèn**, **Gửi**.

- Extractors: generic (any site), Facebook/Messenger thread, Gmail open email
- “nhắn giúp / gửi giúp” → suggest flow; each draft is a card with **Chèn** / **Gửi** (confirm before send)
- **History** in the header — local `chrome.storage.local` threads; click to reopen
- Drag the panel **header** to reposition (saved locally); FAB stays bottom-right

## Manual test checklist

1. Load unpacked → open `https://example.com` → launcher appears bottom-right
2. Open chat without an API key → clear error asking for SERVICE_TOKEN
3. Paste SERVICE_TOKEN in the popup → Save → ask about the page → live reply (or clear HTTP error)
4. Hide the FAB with × → popup **Show chat launcher again** restores it
5. On FB/Messenger/Gmail: type “nhắn giúp tôi đi” → draft cards → **Chèn** / confirmed **Gửi**
6. **History** → reopen a past chat; drag header → reopen panel still at that spot

## Notes

- No account system or database — API key + auto `userId` in `chrome.storage.sync`
- The chat UI uses a closed Shadow DOM so host-page CSS does not restyle the panel
- Content scripts run at `document_idle` on `<all_urls>`
- `host_permissions` include `https://ai.medaily.id.vn/*` for the live AI host
