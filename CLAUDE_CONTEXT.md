# Limble Dash — Development Context

## Current state (as of 2026-03-10)
Dashboard is **read-only**. Write operations (create/edit WOs) were intentionally disabled while the Limble API integration is being validated in production. Once validated, the modal and write routes can be re-added.

## What was built in each phase

### Phase 1 — Initial dashboard
- Flat card grid layout, one card per work order
- Status/priority filters (hardcoded to generic 1/2/3 mappings)
- Create/edit modal with tag management
- Auto-refresh every 60s
- Local tags system (localStorage overlay, not pushed to Limble)

### Phase 2 — Read-only + location columns (current)
- Removed all write UI: modal, "New Work Order" button, create/edit functions
- Added Kanban-style column layout grouped by `locationID` → location name
- Replaced hardcoded status/priority maps with dynamic data fetched from `/statuses`, `/priorities`, `/locations` at load time
- Fixed Limble API v2 endpoint path: `/tasks` (not `/workOrders`)
- Added `User-Agent` header to bypass Cloudflare browser signature check
- Priority color dots now use Limble's API-provided hex color (inline style)
- Status/priority filter dropdowns now populated dynamically from API data
- Template WOs (`template: true`) filtered out from display

## API discovery notes
- `/v2/me` → confirms auth works, returns customer name
- `/v2/workOrders` → 404 (wrong path)
- `/v2/tasks` → correct work orders endpoint
- `/v2/statuses` → Open(0), In Progress(1), Complete(2), Waiting for Parts(6272)
- `/v2/priorities` → customer-defined: Urgent(level 1), Standard(level 2), Can Wait(level 3)
- `/v2/locations` → two sites for this customer
- Cloudflare blocks Python `urllib` default user-agent — must set `User-Agent` header

## WO field notes
Tasks have both `status` (integer 0/1/2, the actual display status) and `statusID` (appears to be a separate reference). The `status` field is used for display and filtering.

Priority: tasks have `priority` (integer = priorityLevel) and `priorityID` (Limble's internal ID like 71543). The `priority` integer is used as the key into the priorityMap.

## What to do next (when resuming write mode)
1. Re-add `do_POST` and `do_PATCH` in `server.py` proxying to `/tasks` and `/tasks/{id}`
2. Re-add modal HTML to `index.html`
3. Re-add write functions to `app.js`: `createWorkOrder()`, `updateWorkOrder()`, `handleFormSubmit()`, `openModal()`, `closeModal()`, `renderModalTagSelector()`
4. Add `card.addEventListener('click', ...)` back in `renderCard()`
5. Add `cursor: pointer` and hover lift back to `.card` in `styles.css`
6. Note: POST/PATCH to Limble uses `/tasks` and `/tasks/{taskID}` — verify field names match

## Ports on this host
- 3000 — Grafana
- 3001 — jobstimer
- 3002 — this dashboard (real, with credentials)
- 3003 — syspro-picklist
- 8099 — static file server for demo preview
