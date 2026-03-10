# Limble CMMS Dashboard — Project Instructions

## What this is
A read-only web dashboard for Limble CMMS that displays Work Orders in a Kanban-style column layout grouped by location. Vanilla JS + Python, no build tools.

## Stack
- **Frontend:** Vanilla JS (`app.js`), plain HTML (`index.html`), plain CSS (`styles.css`)
- **Backend:** Python `http.server` (`server.py`) — serves static files and proxies Limble API calls (keeps credentials server-side, avoids CORS)
- **Port:** 3002
- **Demo:** `demo.html` — fully self-contained, no API connection, uses 12 mock work orders

## File map
```
limble-dash/
├── server.py          # Python HTTP + API proxy server (port 3002)
├── index.html         # Dashboard shell (loads app.js + styles.css)
├── app.js             # All frontend logic
├── styles.css         # Styles
├── demo.html          # Self-contained demo with mock data and location columns
├── config.env         # Credentials — GITIGNORED, copy from config.env.example
├── config.env.example # Template: LIMBLE_CLIENT_ID, LIMBLE_CLIENT_SECRET, LIMBLE_BASE_URL
├── Dockerfile
└── docker-compose.yml
```

## Running

### Demo (no credentials needed)
```bash
cd /root/claudetest/limble-dash && python3 -m http.server 8099 &
# open http://localhost:8099/demo.html
```

### Real dashboard
```bash
cp config.env.example config.env
# edit config.env with real credentials
python3 server.py
# open http://localhost:3002
```

## Limble API v2
- **Base URL:** `https://api.limblecmms.com/v2`
- **Auth:** `Authorization: Basic base64(clientID:clientSecret)`
- **User-Agent:** Must be set — Cloudflare blocks Python's default urllib agent
- **Endpoints proxied:**
  - `GET /api/workorders` → `GET /tasks`
  - `GET /api/statuses`   → `GET /statuses`
  - `GET /api/priorities` → `GET /priorities`
  - `GET /api/locations`  → `GET /locations`
- **Write routes (POST, PATCH) return 404 — dashboard is read-only**

## Limble API field mapping
| API field | Meaning |
|---|---|
| `taskID` | Work order ID |
| `name` | Title |
| `status` | Status integer (key into `/statuses` list by `statusID`) |
| `priority` | Priority level integer (key into `/priorities` list by `priorityLevel`) |
| `due` | Due date — unix timestamp (seconds) |
| `lastEdited` | Last updated — unix timestamp (seconds) |
| `locationID` | Foreign key into `/locations` list |
| `template` | Boolean — filter out template WOs (`template: true`) |

## State shape (app.js)
```js
state = {
  workOrders: [],               // from Limble API (templates filtered out)
  filter: { status, priority, tag },
  loading: bool,
  error: null | string,
  tags: [{ id, label, color }], // local labels, persisted in localStorage
  nextTagId: number,
  woTagMap: { [taskID]: [tagId] }, // persisted in localStorage
  statusMap: { [wo.status]: { label, cls } },       // built from /api/statuses
  priorityMap: { [wo.priority]: { label, cls, color } }, // built from /api/priorities
  locationMap: { [locationID]: name },              // built from /api/locations
}
```

## Key design decisions
- **Read-only:** No create/edit UI — write routes removed from server.py while API integration is validated
- **Column layout:** Work orders grouped by `locationMap[wo.locationID]`, one column per location, horizontal scroll
- **Dynamic filters:** Status and priority dropdowns built at runtime from API data, not hardcoded
- **Priority colors:** Use the color field from Limble's `/priorities` API (inline style on dot), not CSS classes
- **Credentials:** Never exposed to the browser — server.py proxies all Limble calls server-side
- **Tags:** Local overlay stored in localStorage — not sent to Limble API
