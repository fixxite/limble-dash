#!/usr/bin/env python3
"""Limble CMMS Dashboard — HTTP server + API proxy."""

import base64
import json
import os
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

_creds = base64.b64encode(f"{CLIENT_ID}:{CLIENT_SECRET}".encode()).decode()
AUTH_HEADER = f"Basic {_creds}"

STATIC_FILES = {
    "/": ("index.html", "text/html"),
    "/app.js": ("app.js", "application/javascript"),
    "/styles.css": ("styles.css", "text/css"),
}


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

        if path == "/api/workorders":
            qs = self.path[len("/api/workorders"):]
            status, data = limble_request("GET", "/tasks" + qs)
            self.send_json(status, data)
            return

        if path == "/api/statuses":
            status, data = limble_request("GET", "/statuses")
            self.send_json(status, data)
            return

        if path == "/api/priorities":
            status, data = limble_request("GET", "/priorities")
            self.send_json(status, data)
            return

        if path == "/api/locations":
            status, data = limble_request("GET", "/locations")
            self.send_json(status, data)
            return

        self.send_error(404, "Not found")

    def do_POST(self):
        self.send_error(404, "Not found")

    def do_PATCH(self):
        self.send_error(404, "Not found")


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", PORT), Handler)
    print(f"Limble dashboard running on http://0.0.0.0:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Shutting down.")
