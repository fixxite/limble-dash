# Limble CMMS Dashboard

A read-only web dashboard for [Limble CMMS](https://limblecmms.com) that displays Work Orders as a filterable card grid with location-based filtering, search, and a detail modal with comments.

Built with Vanilla JS and Python — no frameworks, no build tools, no dependencies.

## Features

- **Card grid** — one card per work order showing task number (linked to Limble), status badge, priority, assignee
- **Detail modal** — click any card to see requestor info and comments fetched live
- **Location switch** — pill buttons to filter by physical location
- **Status / Priority / Tag / Search filters** — all client-side, instant
- **Tags** — local color-coded labels stored in `localStorage`, not pushed to Limble
- **Server-side cache** — SQLite cache (tasks: 5 min TTL, reference data: 1 hr) reduces Limble API calls from ~240/hr to ~12/hr
- **Completed tasks hidden** — `status=Complete` tasks filtered server-side, never sent to the browser
- **Trello dispatch sync** — optionally pushes Open work orders to a Trello "To Dispatch" list after each refresh (see [Trello setup](#trello-dispatch-sync-optional))
- **Auto-refresh** every 60 seconds; Refresh button bypasses cache
- **Demo mode** — `demo.html` runs entirely in the browser, no server or credentials needed

## Quick start

### Docker (recommended)

```bash
git clone https://github.com/fixxite/limble-dash.git
cd limble-dash
cp config.env.example config.env
# edit config.env — add LIMBLE_CLIENT_ID and LIMBLE_CLIENT_SECRET
docker compose up -d
```

Open **http://localhost:3002**

### Dev (no Docker)

```bash
cp config.env.example config.env
# edit config.env
python3 server.py
```

### Demo (no credentials)

```bash
python3 -m http.server 8099
# open http://localhost:8099/demo.html
```

## Configuration

Edit `config.env` (copied from `config.env.example`, gitignored):

| Variable | Required | Description |
|---|---|---|
| `LIMBLE_CLIENT_ID` | Yes | Limble API client ID |
| `LIMBLE_CLIENT_SECRET` | Yes | Limble API client secret |
| `LIMBLE_BASE_URL` | No | API base (default: `https://api.limblecmms.com/v2`) |
| `PORT` | No | Server port (default: `3002`) |
| `DB_PATH` | No | SQLite cache path (default: `./cache.db`, Docker: `/data/cache.db`) |
| `TRELLO_API_KEY` | No | Trello API key (dispatch sync) |
| `TRELLO_TOKEN` | No | Trello user token |
| `TRELLO_LIST_ID` | No | Trello list ID for "To Dispatch" |

Credentials are available from your Limble account under **Settings → API**.

## Architecture

```
Browser  ──GET /api/workorders──▶  server.py  ──GET /v2/tasks──▶  Limble API
         ◀── JSON (cached) ──────              ◀── JSON ──────────

         ──GET /api/workorders/{id}/comments──▶ server.py ──▶ Limble API
         ◀── JSON (2 min cache) ──────────────

         ──POST /api/trello/sync──▶  server.py  ──POST /cards──▶  Trello API
```

`server.py` proxies all external API calls — credentials never reach the browser.

| Browser route | Proxied to | Cache TTL |
|---|---|---|
| `GET /api/workorders` | `GET /v2/tasks` (completed filtered out) | 5 min |
| `GET /api/statuses` | `GET /v2/statuses` | 1 hr |
| `GET /api/priorities` | `GET /v2/priorities` | 1 hr |
| `GET /api/locations` | `GET /v2/locations` | 1 hr |
| `GET /api/users` | `GET /v2/users` | 1 hr |
| `GET /api/workorders/{id}/comments` | `GET /v2/tasks/{id}/comments` | 2 min |
| `POST /api/trello/sync` | `POST /cards` (Trello) | — |

Append `?fresh=1` to any route to bypass cache (the Refresh button does this automatically).

## Trello dispatch sync (optional)

Dispatchers use a Trello board to assign work orders to technicians each day. Open WOs are automatically pushed to a "To Dispatch" list after every dashboard refresh. Already-synced cards are never duplicated (tracked in SQLite).

**One-time board setup:**

1. Create a Trello board — e.g. **"Daily Dispatch"**
2. Create lists: **"To Dispatch"** + one per technician (e.g. "Nick", "Shanda")
3. Get API key from [trello.com/power-ups/admin](https://trello.com/power-ups/admin)
4. Get token: `https://trello.com/1/authorize?expiration=never&scope=read,write&response_type=token&key=YOUR_KEY`
5. Find list ID: `GET http://localhost:3002/api/trello/boards` → copy the `id` of "To Dispatch"
6. Add to `config.env`:
   ```
   TRELLO_API_KEY=...
   TRELLO_TOKEN=...
   TRELLO_LIST_ID=...
   ```
7. Restart — new Open WOs will appear in Trello automatically

## Stack

- **Frontend:** Vanilla JS, plain HTML/CSS — no framework, no bundler
- **Backend:** Python `http.server` — serves static files and proxies API calls
- **Cache:** SQLite via Python stdlib `sqlite3`
- **Storage:** `localStorage` for local tags only
