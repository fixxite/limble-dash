# Limble Dash — Development Context

## Current state (as of 2026-03-10)
Dashboard is **read-only**. Write operations (create/edit WOs) were intentionally disabled while the Limble API integration is being validated. Once validated, the modal and write routes can be re-added (see "Re-enabling writes" below).

## Feature history

### Phase 1 — Initial dashboard
- Flat card grid, status/priority filters (hardcoded generic 1/2/3 mappings)
- Create/edit modal with tag management
- Auto-refresh every 60s

### Phase 2 — Read-only + location columns (later reverted)
- Removed all write UI and routes
- Added Kanban column layout by location

### Phase 3 — Location switch + flat grid
- Reverted Kanban columns back to flat card grid
- Added pill-button location switch in filter bar

### Phase 4 — Live Limble API v2 integration
- Fixed endpoint: `/tasks` (not `/workOrders`)
- Added `/statuses`, `/priorities`, `/locations`, `/users` proxy routes
- Dynamic status/priority filter dropdowns from API data
- `User-Agent` header required to bypass Cloudflare
- Completed tasks (`status=2`) and templates excluded server-side

### Phase 5 — Performance + Trello dispatch sync
- SQLite cache (tasks: 5 min, reference data: 1 hr, comments: 2 min)
- `?fresh=1` param for cache busting (Refresh button uses it)
- Trello sync: Open WOs auto-pushed to "To Dispatch" list after each refresh
- `DB_PATH` env var for configurable cache location (Docker volumes)

### Phase 6 — Card UX improvements
- Added task number as link to Limble (header, replaces footer "Limble ↗")
- Removed due date from cards
- Added assigned-to (resolved from userMap), shows "Unassigned" if none
- Task type shown on card (Planned Maintenance / Work Order / PM / Work Request)
- Overdue highlighting (`.overdue` class) — still in CSS but due date row removed from cards
- Detail modal: requestor info + comments with author names

## API discovery notes
- `/v2/me` → confirms auth, returns customer name
- `/v2/tasks` → work orders (not `/workOrders`)
- `/v2/statuses` → Open(0), In Progress(1), Complete(2), Waiting for Parts(6272)
- `/v2/priorities` → customer-defined: Urgent(level 1), Standard(level 2), Can Wait(level 3)
- `/v2/locations` → two sites for this customer
- `/v2/users` → user list for assignee name resolution
- `/v2/tasks/{id}/comments` → per-task comments
- Cloudflare blocks Python `urllib` default UA — set User-Agent header

## WO field notes
- `status` (0/1/2) is the display status integer; `statusID` is a foreign key to the statuses table
- `priority` integer = `priorityLevel` from `/priorities`; `priorityID` is Limble's internal ID
- All timestamps are unix seconds

## Re-enabling write mode
1. Add `do_POST` to `server.py` proxying to `POST /tasks`
2. Add `do_PATCH` proxying to `PATCH /tasks/{taskID}`
3. Re-add modal HTML to `index.html`
4. Re-add `openModal()`, `closeModal()`, `handleFormSubmit()` to `app.js`
5. Add `card.addEventListener('click', () => openModal(wo))` in `renderCard()`
6. Add `cursor: pointer` and hover lift back to `.card` in `styles.css`
7. Field names for create/update: `name`, `statusID`, `priorityID`, `due` (unix seconds), `locationID`, `userID`

## Trello setup reference
- API key: https://trello.com/power-ups/admin
- Token URL: `https://trello.com/1/authorize?expiration=never&scope=read,write&response_type=token&key=YOUR_KEY`
- List IDs: `GET http://localhost:3002/api/trello/boards`
- Sync table: `trello_sync(task_id, trello_card_id, synced_at)` in `cache.db`

## Ports on this host
- 3000 — Grafana
- 3001 — jobstimer
- 3002 — this dashboard
- 3003 — syspro-picklist
- 8099 — static file server for demo preview
