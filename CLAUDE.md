# Limble CMMS Dashboard — Project Instructions

## What this is
A read-only web dashboard for Limble CMMS. Displays active (non-completed) Work Orders as a filterable card grid. Cards link to Limble, have a detail modal with comments, and can be filtered by location, status, priority, tag, and search. Vanilla JS + Python, no build tools.

## Stack
- **Frontend:** Vanilla JS (`app.js`), plain HTML (`index.html`), plain CSS (`styles.css`)
- **Backend:** Python `http.server` (`server.py`) — serves static files, proxies Limble API, caches in SQLite, optionally syncs to Trello
- **Port:** 3002
- **Demo:** `demo.html` — self-contained, no server needed, uses 12 mock work orders

## File map
```
limble-dash/
├── server.py            # HTTP server + API proxy + SQLite cache + Trello sync
├── index.html           # Dashboard shell
├── app.js               # All frontend logic
├── styles.css           # Styles
├── demo.html            # Self-contained demo (mock data, no API)
├── Dockerfile           # python:3.12-slim, exposes 3002, DB on /data volume
├── docker-compose.yml   # Mounts limble-cache volume → /data
├── config.env           # Credentials — GITIGNORED
├── config.env.example   # Template
├── cache.db             # SQLite cache — GITIGNORED (auto-created on first run)
├── CLAUDE.md            # This file
└── CLAUDE_CONTEXT.md    # Dev history and notes
```

## Running

```bash
# Docker
docker compose up -d

# Dev
python3 server.py

# Demo (no credentials)
python3 -m http.server 8099  # open /demo.html
```

## Limble API v2
- **Base URL:** `https://api.limblecmms.com/v2`
- **Auth:** `Authorization: Basic base64(clientID:clientSecret)`
- **User-Agent must be set** — Cloudflare blocks Python's default urllib agent

## Proxy routes & cache TTLs
| Browser route | Limble endpoint | TTL |
|---|---|---|
| `GET /api/workorders` | `GET /tasks?limit=2000` | 5 min |
| `GET /api/statuses` | `GET /statuses` | 1 hr |
| `GET /api/priorities` | `GET /priorities` | 1 hr |
| `GET /api/locations` | `GET /locations` | 1 hr |
| `GET /api/users` | `GET /users` | 1 hr |
| `GET /api/workorders/{id}/comments` | `GET /tasks/{id}/comments` | 2 min |
| `POST /api/trello/sync` | `POST /cards` (Trello) | — |

Append `?fresh=1` to bypass cache. The Refresh button sends `?fresh=1` to all routes.

**Write routes (POST, PATCH) return 404 — dashboard is read-only.**

## Limble field mapping
| API field | Meaning |
|---|---|
| `taskID` | Work order ID |
| `name` | Title |
| `statusID` | Status (key into `/statuses` list) |
| `status` | Status integer (used for filtering — `status=2` = Complete, excluded server-side) |
| `priority` | Priority level int (key into `priorityMap` by `priorityLevel`) |
| `priorityID` | Limble's internal priority ID |
| `due` | Due date — unix timestamp (seconds) |
| `lastEdited` | Last updated — unix timestamp (seconds) |
| `locationID` | Foreign key into `/locations` |
| `userID` | Assigned user — resolved via `userMap` |
| `template` | Boolean — filtered out server-side |
| `type` | Task type: 1=Planned Maintenance, 2=WO, 4=PM, 6=Work Request |
| `requestorName/Email/Description` | Shown in detail modal |

## State shape (app.js)
```js
state = {
  workOrders: [],
  filter: { status, priority, tag, location, search },
  loading, error,
  tags: [{ id, label, color }],     // localStorage
  woTagMap: { [taskID]: [tagId] },  // localStorage
  statusMap: { [statusID]: { label, cls } },
  priorityMap: { [priorityLevel]: { label, cls, color } },
  locationMap: { [locationID]: name },
  userMap: { [userID]: 'First Last' },
}
```

## Key design decisions
- **Completed tasks excluded** server-side (`status=2` filtered in proxy before caching)
- **Template WOs excluded** server-side (`template=true` filtered in proxy)
- **SQLite cache** reduces Limble API calls from ~240/hr to ~12/hr at idle
- **DB_PATH env var** — defaults to `./cache.db`, overridden to `/data/cache.db` in Docker for volume persistence
- **Trello sync** — fire-and-forget POST after each fetch; skipped silently if not configured
- **Tags** — local overlay in localStorage, never pushed to Limble
- **Credentials** — never sent to browser; all Limble/Trello calls are server-side
