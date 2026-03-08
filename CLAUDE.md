# Limble CMMS Dashboard — Project Summary

## What this is
A standalone web dashboard for Limble CMMS that displays, creates, and updates Work Orders via the Limble API v2. Vanilla JS + Python, no build tools, Dockerized.

## Stack
- **Frontend:** Vanilla JS (`app.js`), plain HTML (`index.html`), plain CSS (`styles.css`)
- **Backend:** Python `http.server` (`server.py`) — serves static files AND proxies Limble API calls (keeps credentials server-side, avoids CORS)
- **Port:** 3002
- **Demo:** `demo.html` — fully self-contained, no server needed, uses mock data

## File map
```
limble-dash/
├── server.py          # Python HTTP + API proxy server (port 3002)
├── index.html         # Real dashboard shell (loads app.js + styles.css)
├── app.js             # All frontend logic for real dashboard
├── styles.css         # Shared styles
├── demo.html          # Self-contained demo with 12 mock work orders (no API)
├── config.env         # Credentials — GITIGNORED, copy from config.env.example
├── config.env.example # Template: LIMBLE_CLIENT_ID, LIMBLE_CLIENT_SECRET, LIMBLE_BASE_URL
├── Dockerfile
└── docker-compose.yml
```

## Running

### Demo (no credentials needed)
```bash
# Option 1: open directly in browser
xdg-open /root/claudetest/limble-dash/demo.html

# Option 2: serve over HTTP (currently running on 8099)
cd /root/claudetest/limble-dash && python3 -m http.server 8099 &
# open http://localhost:8099/demo.html
```

### Real dashboard (needs Limble credentials)
```bash
cp config.env.example config.env
# edit config.env with real LIMBLE_CLIENT_ID and LIMBLE_CLIENT_SECRET
docker compose up -d   # runs on port 3002
# open http://localhost:3002
```

### Dev server (no Docker)
```bash
cd /root/claudetest/limble-dash
python3 server.py
# open http://localhost:3002
```

## Limble API
- **Base URL:** `https://api.limblecmms.com`
- **Auth:** `Authorization: Basic base64(clientID:clientSecret)`
- **Endpoints used:**
  - `GET  /workOrders` → list
  - `POST /workOrders` → create
  - `PATCH /workOrders/{id}` → update

## Proxy routes (server.py)
| Browser calls | server.py proxies to |
|---|---|
| `GET /api/workorders` | `GET /workOrders` |
| `POST /api/workorders` | `POST /workOrders` |
| `PATCH /api/workorders/{id}` | `PATCH /workOrders/{id}` |

## Features implemented
- Work order card grid with status badges and priority color dots
- Filter by status (Open / In Progress / Completed), priority, and tag
- Create / edit work orders via modal form
- Auto-refresh every 60 seconds (real dashboard)
- **Custom tags with color coding:**
  - Tags stored in `localStorage` (demo) or layered on top of API data (real)
  - Toggle tags per work order in the modal
  - Create new tags with a name + color picker inline
  - Delete tags globally from the manage list in modal
  - Filter work orders by tag in the filter bar
  - Tag chips displayed on cards with color-coded backgrounds

## State shape (app.js)
```js
state = {
  workOrders: [],             // from Limble API
  filter: { status, priority, tag },  // 'all' or specific value
  loading: bool,
  error: null | string,
  editTarget: null | wo,      // null = create mode
  tags: [{ id, label, color }],       // persisted in localStorage
  nextTagId: number,
  woTagMap: { [woId]: [tagId] },      // persisted in localStorage
  modalTagIds: Set,           // selected tags in open modal session
}
```

## Key design decisions
- `server.py` never exposes credentials to the browser
- Tags are a local overlay (not sent to Limble API, stored in localStorage) so they work without any API changes
- `demo.html` is completely standalone — ships with DEFAULT_TAGS and DEFAULT_WO_TAGS pre-wired
- Port 3002 chosen to avoid conflicts with Grafana (3000) and jobstimer (3001) on this host

## Known ports on this host
- 3000 — Grafana
- 3001 — jobstimer project
- 3002 — this dashboard
- 8080 — Jetty (something else)
- 8099 — temp Python file server for demo preview
