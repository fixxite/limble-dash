# Limble CMMS Dashboard

A lightweight, read-only web dashboard for [Limble CMMS](https://limblecmms.com) that displays Work Orders in a Kanban-style column layout grouped by location.

Built with Vanilla JS and Python — no frameworks, no build tools.

![Demo](demo.html)

## Features

- **Location columns** — Work orders grouped by physical location, horizontal scroll
- **Status & priority filters** — Dynamically built from your Limble account's actual statuses and priorities
- **Tag labels** — Local color-coded tags stored in the browser (not pushed to Limble)
- **Tag filter** — Filter work orders by local tag
- **Auto-refresh** — Reloads every 60 seconds
- **Demo mode** — `demo.html` runs entirely in the browser, no server or API key needed

## Setup

### 1. Clone and configure

```bash
git clone https://github.com/fixxite/limble-dash.git
cd limble-dash
cp config.env.example config.env
```

Edit `config.env`:
```
LIMBLE_CLIENT_ID=your_client_id
LIMBLE_CLIENT_SECRET=your_client_secret
LIMBLE_BASE_URL=https://api.limblecmms.com/v2
```

Credentials are available from your Limble account under **Settings → API**.

### 2. Run

```bash
python3 server.py
```

Open **http://localhost:3002**

### Docker

```bash
docker compose up -d
```

## Demo (no credentials needed)

```bash
python3 -m http.server 8099
# open http://localhost:8099/demo.html
```

The demo ships with 12 mock work orders spread across four locations (Building A, Production Floor, East Wing, Yard & Utilities) and pre-defined tags.

## Architecture

```
Browser  ──GET /api/workorders──▶  server.py  ──GET /v2/tasks──▶  Limble API
         ◀── JSON ──────────────              ◀── JSON ──────────
```

`server.py` acts as a proxy — Limble API credentials never leave the server.

| Browser route | Proxied to |
|---|---|
| `GET /api/workorders` | `GET /v2/tasks` |
| `GET /api/statuses` | `GET /v2/statuses` |
| `GET /api/priorities` | `GET /v2/priorities` |
| `GET /api/locations` | `GET /v2/locations` |

## Stack

- **Frontend:** Vanilla JS, plain HTML/CSS — no framework, no bundler
- **Backend:** Python `http.server` — serves static files and proxies API calls
- **Storage:** Browser `localStorage` for local tags

## Configuration

| Variable | Default | Description |
|---|---|---|
| `LIMBLE_CLIENT_ID` | *(required)* | Limble API client ID |
| `LIMBLE_CLIENT_SECRET` | *(required)* | Limble API client secret |
| `LIMBLE_BASE_URL` | `https://api.limblecmms.com/v2` | API base URL |
| `PORT` | `3002` | Local server port |
