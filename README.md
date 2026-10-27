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
| Model provider | **Medaily AI** (via `ai.medaily.id.vn`), **Gemini** or **Claude** (called directly from the service worker, bypassing medaily-ai) |
| API key | Medaily: `SERVICE_TOKEN` — sent as `Authorization: Bearer <key>` |
| Gemini API key / model | Free key from [AI Studio](https://aistudio.google.com/apikey); pick a model in the dropdown (default `gemini-3.5-flash-lite`) or enter a custom ID; free tier is RPM/RPD limited |
| Claude API key / model | Anthropic API key (paid, no free tier); dropdown Haiku / Sonnet / Opus 5.5 (default `claude-haiku-5-5`) or a custom ID |
| Chat launcher | Small × on the FAB (or the eye-off control in the open panel) hides the launcher; restore via **Show chat launcher again** |

The medaily-ai host is fixed at `https://ai.medaily.id.vn` (not editable in the popup).

**Key encryption (optional):** in the popup, set a passphrase and click **Encrypt keys**. All keys move into one AES-GCM blob in `chrome.storage.local` (AES key derived with PBKDF2-SHA256, 600k iterations); the plaintext copies, including the synced `SERVICE_TOKEN`, are removed. **Unlock** keeps the decrypted keys in `chrome.storage.session` (memory only, not readable by content scripts) until the browser restarts, the extension reloads, or you click **Lock now**. A forgotten passphrase cannot be recovered — use **Delete all saved keys** and paste them again. Code: `shared/secrets.js`.

Without encryption, Gemini/Claude keys are stored in `chrome.storage.local` (not synced) and read only by the service worker; content scripts ask `MEDAILY_KEY_STATUS` for presence. With these providers the agent uses native function calling — tool declarations live in `background/llm/tools.js`, and each step is stateless (goal + step history + fresh snapshot).

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
background/medaily-client.js   # medaily-ai HTTP client
background/llm/                # BYOK providers: gemini.js, anthropic.js, tools.js, index.js
content/page-kit.js            # Pluggable extractors + composer insert/send
content/chatbox.js             # Shadow DOM chat UI on every page
content/chatbox.css            # Host-page isolation stub
popup/                         # API key + show launcher
shared/defaults.js             # Hardcoded AI host + settings defaults
icons/                         # Extension icons
```

## Modes

- **Chat** — Ask / Tóm tắt / Gợi ý; FB-only Chèn·Gửi (site registry)
- **Agent** — goal → planner (medaily-ai `/api/extension/agent`, or Gemini/Claude tool calling) → confirm → tools (click/type/…)

## Images (Gemini / Claude only)

- **Chat:** paste (Ctrl+V), drag-and-drop, the 📎 button, or the 📷 button (screenshot of the visible tab with the panel hidden). Up to 4 images per question; downscaled to JPEG ≤1568px in `content/page-capture.js`. Images are not saved to History.
- **Agent:** each planning step attaches a viewport screenshot (≤1280px) so the model can see dropdowns, date pickers and errors. Toggle in the popup ("Agent sends a screenshot each step").
- medaily-ai does not accept images: Chat with images errors, Agent drops the screenshot.

## Page actions (Chat)

Panel buttons (Vietnamese labels): **Tóm tắt**, **Gợi ý trả lời**, **Chèn**, **Gửi**.

- Extractors: generic (any site), Facebook/Messenger thread, Gmail open email
- Site registry (`content/site-registry.js`): **Chèn / Gửi chỉ trên Facebook & Messenger**
- **History** · drag header · FAB bottom-right

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
