#!/usr/bin/env python3
"""Limble CMMS Dashboard — HTTP server + API proxy."""

import base64
import datetime
import json
import os
import sqlite3
import time
import urllib.parse
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

# Load config.env
_env_path = Path(__file__).parent / "config.env"
if _env_path.exists():
    for line in _env_path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip())

CLIENT_ID = os.environ.get("LIMBLE_CLIENT_ID", "")
CLIENT_SECRET = os.environ.get("LIMBLE_CLIENT_SECRET", "")
BASE_URL = os.environ.get("LIMBLE_BASE_URL", "https://api.limblecmms.com/v2").rstrip("/")
PORT = int(os.environ.get("PORT", 3002))

TRELLO_API_KEY = os.environ.get("TRELLO_API_KEY", "")
TRELLO_TOKEN   = os.environ.get("TRELLO_TOKEN", "")
TRELLO_LIST_ID = os.environ.get("TRELLO_LIST_ID", "")
TRELLO_BASE    = "https://api.trello.com/1"

DB_PATH = Path(os.environ.get("DB_PATH", str(Path(__file__).parent / "cache.db")))
TASKS_TTL = 300    # 5 minutes
REF_TTL   = 3600   # 1 hour

_creds = base64.b64encode(f"{CLIENT_ID}:{CLIENT_SECRET}".encode()).decode()
AUTH_HEADER = f"Basic {_creds}"

STATIC_FILES = {
    "/": ("index.html", "text/html"),
    "/app.js": ("app.js", "application/javascript"),
    "/styles.css": ("styles.css", "text/css"),
}


def init_db():
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS cache (
                key        TEXT PRIMARY KEY,
                data       TEXT NOT NULL,
                fetched_at INTEGER NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS trello_sync (
                task_id       INTEGER PRIMARY KEY,
                trello_card_id TEXT NOT NULL,
                synced_at     INTEGER NOT NULL
            )
        """)

def cache_get(key: str, ttl: int) -> bytes | None:
    with sqlite3.connect(DB_PATH) as conn:
        row = conn.execute(
            "SELECT data, fetched_at FROM cache WHERE key = ?", (key,)
        ).fetchone()
    if row and (time.time() - row[1]) < ttl:
        return row[0].encode()
    return None

def cache_set(key: str, data: bytes):
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            "INSERT OR REPLACE INTO cache (key, data, fetched_at) VALUES (?, ?, ?)",
            (key, data.decode(), int(time.time()))
        )


def trello_request(method, path, params=None, body=None):
    base_params = f"key={TRELLO_API_KEY}&token={TRELLO_TOKEN}"
    qs = ("&" + "&".join(f"{k}={urllib.parse.quote(str(v))}" for k, v in params.items())) if params else ""
    url = f"{TRELLO_BASE}{path}?{base_params}{qs}"
    req = urllib.request.Request(url, data=body, method=method)
    if body:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def build_trello_card(task):
    PRIORITY_NAMES = {3: "Critical", 2: "High", 1: "Medium", 0: "Low"}
    TYPE_NAMES = {1: "Planned Maintenance", 2: "Work Order", 4: "Preventive Maintenance", 6: "Work Request"}
    limble_url = f"https://app.limblecmms.com/taskList?taskID={task['taskID']}"
    due_iso = None
    if task.get("due"):
        due_iso = datetime.datetime.utcfromtimestamp(task["due"]).strftime("%Y-%m-%dT%H:%M:%S.000Z")

    lines = []
    if task.get("priority") is not None:
        lines.append(f"**Priority:** {PRIORITY_NAMES.get(task['priority'], task['priority'])}")
    if task.get("type"):
        lines.append(f"**Type:** {TYPE_NAMES.get(task['type'], task['type'])}")
    if task.get("requestorName"):
        lines.append(f"**Requestor:** {task['requestorName']}")
    if task.get("requestorDescription"):
        lines.append(f"\n{task['requestorDescription']}")
    lines.append(f"\n🔗 [Open in Limble]({limble_url})")

    card = {
        "idList": TRELLO_LIST_ID,
        "name": task.get("name") or "Untitled",
        "desc": "\n".join(lines),
    }
    if due_iso:
        card["due"] = due_iso
    return json.dumps(card).encode()


def limble_request(method: str, path: str, body: bytes | None = None) -> tuple[int, bytes]:
    url = BASE_URL + path
    headers = {
        "Authorization": AUTH_HEADER,
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; LimbleDash/1.0)",
    }
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f"[{self.address_string()}] {fmt % args}")

    def send_json(self, status: int, data: bytes):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def send_static(self, filename: str, content_type: str):
        path = Path(__file__).parent / filename
        if not path.exists():
            self.send_error(404, "File not found")
            return
        data = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        # Strip query string for routing
        path = self.path.split("?")[0]

        if path in STATIC_FILES:
            filename, ct = STATIC_FILES[path]
            self.send_static(filename, ct)
            return

        # /api/workorders/<taskID>/comments
        parts = path.split("/")
        if len(parts) == 5 and parts[1] == "api" and parts[2] == "workorders" and parts[4] == "comments" and parts[3].isdigit():
            task_id = parts[3]
            cache_key = f"comments:{task_id}"
            cached = cache_get(cache_key, 120)  # 2-minute TTL
            if cached:
                self.send_json(200, cached)
                return
            _, data = limble_request("GET", f"/tasks/{task_id}/comments")
            cache_set(cache_key, data)
            self.send_json(200, data)
            return

        if path == "/api/workorders":
            fresh = "fresh=1" in self.path
            cached = None if fresh else cache_get("tasks", TASKS_TTL)
            if cached:
                self.send_json(200, cached)
                return
            _, raw = limble_request("GET", "/tasks?limit=2000")
            try:
                tasks = json.loads(raw)
                if isinstance(tasks, list):
                    tasks = [t for t in tasks
                             if not t.get("template") and t.get("statusID") != 2]
                data = json.dumps(tasks).encode()
            except Exception:
                data = raw
            cache_set("tasks", data)
            self.send_json(200, data)
            return

        if path == "/api/statuses":
            fresh = "fresh=1" in self.path
            cached = None if fresh else cache_get("statuses", REF_TTL)
            if cached:
                self.send_json(200, cached)
                return
            _, data = limble_request("GET", "/statuses")
            cache_set("statuses", data)
            self.send_json(200, data)
            return

        if path == "/api/priorities":
            fresh = "fresh=1" in self.path
            cached = None if fresh else cache_get("priorities", REF_TTL)
            if cached:
                self.send_json(200, cached)
                return
            _, data = limble_request("GET", "/priorities")
            cache_set("priorities", data)
            self.send_json(200, data)
            return

        if path == "/api/locations":
            fresh = "fresh=1" in self.path
            cached = None if fresh else cache_get("locations", REF_TTL)
            if cached:
                self.send_json(200, cached)
                return
            _, data = limble_request("GET", "/locations")
            cache_set("locations", data)
            self.send_json(200, data)
            return

        if path == "/api/users":
            fresh = "fresh=1" in self.path
            cached = None if fresh else cache_get("users", REF_TTL)
            if cached:
                self.send_json(200, cached)
                return
            _, data = limble_request("GET", "/users")
            cache_set("users", data)
            self.send_json(200, data)
            return

        if path == "/api/trello/boards":
            _, data = trello_request("GET", "/members/me/boards", {"fields": "name,id"})
            boards = json.loads(data)
            result = []
            for b in boards:
                _, ldata = trello_request("GET", f"/boards/{b['id']}/lists", {"fields": "name,id"})
                result.append({"board": b["name"], "boardID": b["id"], "lists": json.loads(ldata)})
            self.send_json(200, json.dumps(result).encode())
            return

        self.send_error(404, "Not found")

    def do_POST(self):
        path = self.path.split("?")[0]
        if path == "/api/trello/sync":
            if not (TRELLO_API_KEY and TRELLO_TOKEN and TRELLO_LIST_ID):
                self.send_json(200, b'{"skipped": true, "reason": "Trello not configured"}')
                return

            cached = cache_get("tasks", TASKS_TTL * 2)
            if not cached:
                self.send_json(200, b'{"skipped": true, "reason": "No cached tasks"}')
                return
            tasks = json.loads(cached)
            open_tasks = [t for t in tasks if t.get("statusID") == 0]

            with sqlite3.connect(DB_PATH) as conn:
                synced = {row[0] for row in conn.execute("SELECT task_id FROM trello_sync")}

            created = 0
            for task in open_tasks:
                tid = task["taskID"]
                if tid in synced:
                    continue
                card_body = build_trello_card(task)
                status, resp = trello_request("POST", "/cards", body=card_body)
                if status == 200:
                    card = json.loads(resp)
                    with sqlite3.connect(DB_PATH) as conn:
                        conn.execute(
                            "INSERT OR REPLACE INTO trello_sync (task_id, trello_card_id, synced_at) VALUES (?,?,?)",
                            (tid, card["id"], int(time.time()))
                        )
                    created += 1

            self.send_json(200, json.dumps({"created": created, "total_open": len(open_tasks)}).encode())
            return
        self.send_error(404, "Not found")

    def do_PATCH(self):
        self.send_error(404, "Not found")


if __name__ == "__main__":
    init_db()
    server = HTTPServer(("0.0.0.0", PORT), Handler)
    print(f"Limble dashboard running on http://0.0.0.0:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Shutting down.")
