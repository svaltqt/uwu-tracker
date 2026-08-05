"""
Sirve el dashboard (web/) y actúa de proxy hacia uwu-logs.xyz.

Por qué hace falta: el navegador bloquea el fetch() del dashboard directo a
uwu-logs.xyz por CORS (el sitio no manda Access-Control-Allow-Origin). Este
proxy corre en tu máquina, recibe la petición del navegador (mismo origen,
sin problema) y él sí le pega a uwu-logs.xyz del lado del servidor, donde
CORS no aplica — igual que hace `requests` en el CLI.

Uso:
    python3 proxy_server.py
    # abrir http://localhost:8000
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
from datetime import datetime, timezone
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import unquote
from urllib.request import Request, urlopen

WEB_DIR = Path(__file__).resolve().parent / "web"
UWU_LOGS_BASE = os.environ.get("UWU_LOGS_BASE", "https://uwu-logs.xyz")
PORT = int(os.environ.get("PORT", 8000))

# Caché en SQLite para las rutas atadas a un report_id (report_segments,
# report_casts, report_page): una vez que una pelea pasó, ese combat log no
# cambia más — cachearlo evita pegarle a uwu-logs.xyz de nuevo cada vez que
# se abre "View analysis" para el mismo intento. character/logs_list NO se
# cachean porque esos sí cambian (rankings/dps se actualizan).
DEFAULT_CACHE_DB_PATH = Path(__file__).resolve().parent / "data" / "analysis_cache.db"
CACHE_DB_PATH = Path(os.environ.get("ANALYSIS_CACHE_DB", str(DEFAULT_CACHE_DB_PATH)))
CACHE_SCHEMA = """
CREATE TABLE IF NOT EXISTS analysis_cache (
    cache_key TEXT PRIMARY KEY,
    upstream_path TEXT NOT NULL,
    request_body TEXT,
    status INTEGER NOT NULL,
    content_type TEXT NOT NULL,
    response_body BLOB NOT NULL,
    fetched_at TEXT NOT NULL
);
"""


def _init_cache_db() -> sqlite3.Connection:
    CACHE_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(CACHE_DB_PATH, check_same_thread=False)
    conn.executescript(CACHE_SCHEMA)
    conn.commit()
    return conn


CACHE_DB = _init_cache_db()

# --- Historial para "Progreso en el tiempo" -----------------------------
# Mismo schema que src/uwu_tracker/db.py (el que usa el CLI), y por default
# el MISMO archivo data/uwu_logs.db — así lo que guarda `uwu-tracker fetch`
# desde la terminal y lo que guarda este proxy al refrescar el roster desde
# la web terminan en la misma base y se complementan.
DEFAULT_HISTORY_DB_PATH = Path(__file__).resolve().parent / "data" / "uwu_logs.db"
HISTORY_DB_PATH = Path(os.environ.get("UWU_TRACKER_DB", str(DEFAULT_HISTORY_DB_PATH)))
HISTORY_SCHEMA = """
CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server TEXT NOT NULL,
    name TEXT NOT NULL,
    spec TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    class_i INTEGER,
    overall_points REAL,
    overall_rank INTEGER,
    raw_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS boss_kills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id INTEGER NOT NULL,
    boss_name TEXT NOT NULL,
    raid_id TEXT,
    rank_raids INTEGER,
    rank_players INTEGER,
    dps_max REAL,
    raids INTEGER,
    points REAL,
    points_dps REAL,
    points_rank_players REAL,
    points_rank_raids REAL,
    spec_total_players INTEGER,
    spec_total_raids INTEGER,
    spec_r1_dps REAL,
    report_id TEXT,
    fastest_kill_duration REAL,
    auras TEXT,
    FOREIGN KEY (snapshot_id) REFERENCES snapshots (id)
);
"""

_HISTORY_BOSS_FIELDS = [
    "raid_id", "rank_raids", "rank_players", "dps_max", "raids", "points",
    "points_dps", "points_rank_players", "points_rank_raids",
    "spec_total_players", "spec_total_raids", "spec_r1_dps", "report_id",
    "fastest_kill_duration", "auras",
]

# No guardamos un snapshot en CADA refresh (el usuario puede refrescar el
# roster muchas veces por día) — solo si pasaron al menos estas horas desde
# el último snapshot guardado para ese personaje+spec.
SNAPSHOT_MIN_INTERVAL_HOURS = 12


def _init_history_db() -> sqlite3.Connection:
    HISTORY_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(HISTORY_DB_PATH, check_same_thread=False)
    conn.executescript(HISTORY_SCHEMA)
    conn.commit()
    return conn


HISTORY_DB = _init_history_db()


def _should_save_snapshot(server: str, name: str, spec: str) -> bool:
    row = HISTORY_DB.execute(
        "SELECT fetched_at FROM snapshots WHERE server = ? AND name = ? AND spec = ? ORDER BY fetched_at DESC LIMIT 1",
        (server, name, spec),
    ).fetchone()
    if row is None:
        return True
    try:
        last = datetime.fromisoformat(row[0])
    except ValueError:
        return True
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - last).total_seconds() >= SNAPSHOT_MIN_INTERVAL_HOURS * 3600


def _save_history_snapshot(server: str, name: str, spec: str, data: dict) -> None:
    if not _should_save_snapshot(server, name, spec):
        return
    now = datetime.now(timezone.utc).isoformat()
    cur = HISTORY_DB.execute(
        """
        INSERT INTO snapshots (server, name, spec, fetched_at, class_i, overall_points, overall_rank, raw_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (server, name, spec, now, data.get("class_i"), data.get("overall_points"), data.get("overall_rank"), json.dumps(data)),
    )
    snapshot_id = cur.lastrowid
    for boss_name, b in (data.get("bosses") or {}).items():
        if not b:
            continue
        values = [b.get(f) for f in _HISTORY_BOSS_FIELDS]
        HISTORY_DB.execute(
            f"""
            INSERT INTO boss_kills (snapshot_id, boss_name, {", ".join(_HISTORY_BOSS_FIELDS)})
            VALUES (?, ?, {", ".join("?" for _ in _HISTORY_BOSS_FIELDS)})
            """,
            (snapshot_id, boss_name, *values),
        )
    HISTORY_DB.commit()


HISTORY_ROUTE_RE = re.compile(r"^/api/history/([^/]+)/([^/]+)/([^/]+)$")


# Rutas que el dashboard puede pedir vía /api/... -> a dónde se reenvían en uwu-logs.xyz
PROXY_ROUTES = {
    "/api/character": "/character",
    "/api/logs_list": "/logs_list",
}

# Rutas con un report_id dinámico en el medio (para el análisis de rotación/DK):
# /api/report_segments/<report_id> -> /reports/<report_id>/report_slices/
# /api/report_casts/<report_id>    -> /reports/<report_id>/casts/
# Ninguna de las dos está documentada oficialmente — se armaron leyendo el
# código fuente público del sitio (Z_SERVER.py / logs_spells_order.py), no
# fueron probadas contra la API real todavía.
DYNAMIC_PROXY_ROUTES = {
    "report_segments": "/reports/{report_id}/report_slices/",
    "report_casts": "/reports/{report_id}/casts/",
}
DYNAMIC_ROUTE_RE = re.compile(r"^/api/(report_segments|report_casts)/(.+)$")

# /api/report_page/<report_id> -> /reports/<report_id>/  (GET, HTML)
# El JSON de report_segments NO trae la dificultad (10N/10H/25N/25H) de cada
# intento ni los índices s/f — esos datos solo están en los <a class="kill-link">
# de la página HTML que arma el servidor. Traemos esa página cruda acá y el
# frontend la parsea para sacar mode/attempt/s/f de cada intento real.
REPORT_PAGE_ROUTE_RE = re.compile(r"^/api/report_page/(.+)$")

# Rutas cacheables (atadas a un report_id ya jugado, inmutables) vs. las que
# no (rankings/dps que cambian con el tiempo).
CACHEABLE_ROUTE_NAMES = {"report_segments", "report_casts"}


def _cache_key(upstream_path: str, body: bytes | None) -> str:
    # Normalizamos el body (si es JSON) reordenando las keys, para que dos
    # requests con el mismo contenido pero distinto orden de propiedades
    # generen la misma cache_key.
    normalized_body = ""
    if body:
        try:
            normalized_body = json.dumps(json.loads(body.decode("utf-8")), sort_keys=True)
        except (UnicodeDecodeError, json.JSONDecodeError):
            normalized_body = body.decode("utf-8", "replace")
    raw = f"{upstream_path}\n{normalized_body}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _cache_get(cache_key: str) -> tuple[int, str, bytes] | None:
    row = CACHE_DB.execute(
        "SELECT status, content_type, response_body FROM analysis_cache WHERE cache_key = ?",
        (cache_key,),
    ).fetchone()
    return row if row else None


def _cache_set(cache_key: str, upstream_path: str, body: bytes | None, status: int, content_type: str, response_body: bytes) -> None:
    CACHE_DB.execute(
        """INSERT OR REPLACE INTO analysis_cache
           (cache_key, upstream_path, request_body, status, content_type, response_body, fetched_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (
            cache_key,
            upstream_path,
            (body or b"").decode("utf-8", "replace"),
            status,
            content_type,
            response_body,
            datetime.now(timezone.utc).isoformat(),
        ),
    )
    CACHE_DB.commit()


class ProxyHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_DIR), **kwargs)

    def do_POST(self):
        if self.path == "/api/character":
            self._proxy_json("/character", cacheable=False, on_success=self._maybe_save_snapshot)
            return

        upstream_path = PROXY_ROUTES.get(self.path)
        if upstream_path is not None:
            self._proxy_json(upstream_path, cacheable=False)
            return

        match = DYNAMIC_ROUTE_RE.match(self.path)
        if match is not None:
            route_name, report_id = match.groups()
            upstream_path = DYNAMIC_PROXY_ROUTES[route_name].format(report_id=report_id)
            self._proxy_json(upstream_path, cacheable=route_name in CACHEABLE_ROUTE_NAMES)
            return

        self.send_error(404, "Ruta de proxy desconocida")

    def do_GET(self):
        match = HISTORY_ROUTE_RE.match(self.path)
        if match is not None:
            server, name, spec = (unquote(p) for p in match.groups())
            self._handle_get_history(server, name, spec)
            return

        match = REPORT_PAGE_ROUTE_RE.match(self.path)
        if match is not None:
            report_id = match.group(1)
            self._proxy_html_get(f"/reports/{report_id}/", cacheable=True)
            return
        super().do_GET()

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    def _send_json(self, status: int, payload) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self._cors_headers()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _handle_get_history(self, server: str, name: str, spec: str) -> None:
        rows = HISTORY_DB.execute(
            "SELECT fetched_at, overall_points, overall_rank FROM snapshots WHERE server = ? AND name = ? AND spec = ? ORDER BY fetched_at ASC",
            (server, name, spec),
        ).fetchall()
        self._send_json(200, [{"fetched_at": r[0], "overall_points": r[1], "overall_rank": r[2]} for r in rows])

    def _maybe_save_snapshot(self, request_body: bytes, response_data: bytes) -> None:
        try:
            req = json.loads(request_body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return
        server = req.get("server")
        name = req.get("name")
        spec = str(req.get("spec_i") if req.get("spec_i") is not None else (req.get("spec") or ""))
        if not server or not name or not spec:
            return
        try:
            data = json.loads(response_data.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return
        if not isinstance(data, dict):
            return
        try:
            _save_history_snapshot(server, name, spec, data)
        except sqlite3.Error as exc:
            print(f"[proxy] no se pudo guardar el snapshot de historial: {exc}")

    def _proxy_json(self, upstream_path: str, cacheable: bool = False, on_success=None) -> None:
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)

        cache_key = _cache_key(upstream_path, body) if cacheable else None
        if cache_key is not None:
            cached = _cache_get(cache_key)
            if cached is not None:
                status, content_type, response_body = cached
                self.send_response(status)
                self._cors_headers()
                self.send_header("Content-Type", content_type)
                self.send_header("X-Cache", "HIT")
                self.end_headers()
                self.wfile.write(response_body)
                return

        req = Request(
            UWU_LOGS_BASE + upstream_path,
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urlopen(req, timeout=15) as resp:
                data = resp.read()
                status = resp.status
        except HTTPError as exc:
            data = exc.read()
            status = exc.code
        except URLError as exc:
            self.send_response(502)
            self._cors_headers()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(exc)}).encode("utf-8"))
            return

        # Solo cacheamos respuestas 200 — un error/404 no queremos que quede
        # pegado para siempre si después el intento sí existe.
        if cache_key is not None and status == 200:
            _cache_set(cache_key, upstream_path, body, status, "application/json", data)

        if on_success is not None and status == 200:
            on_success(body, data)

        self.send_response(status)
        self._cors_headers()
        self.send_header("Content-Type", "application/json")
        self.send_header("X-Cache", "MISS")
        self.end_headers()
        self.wfile.write(data)

    def _proxy_html_get(self, upstream_path: str, cacheable: bool = False) -> None:
        cache_key = _cache_key(upstream_path, None) if cacheable else None
        if cache_key is not None:
            cached = _cache_get(cache_key)
            if cached is not None:
                status, content_type, response_body = cached
                self.send_response(status)
                self._cors_headers()
                self.send_header("Content-Type", content_type)
                self.send_header("X-Cache", "HIT")
                self.end_headers()
                self.wfile.write(response_body)
                return

        req = Request(
            UWU_LOGS_BASE + upstream_path,
            headers={"User-Agent": "Mozilla/5.0"},
            method="GET",
        )
        try:
            with urlopen(req, timeout=15) as resp:
                data = resp.read()
                status = resp.status
        except HTTPError as exc:
            data = exc.read()
            status = exc.code
        except URLError as exc:
            self.send_response(502)
            self._cors_headers()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(exc)}).encode("utf-8"))
            return

        if cache_key is not None and status == 200:
            _cache_set(cache_key, upstream_path, None, status, "text/html; charset=utf-8", data)

        self.send_response(status)
        self._cors_headers()
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("X-Cache", "MISS")
        self.end_headers()
        self.wfile.write(data)

    def _cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def log_message(self, fmt: str, *args) -> None:
        print(f"[proxy] {self.address_string()} - {fmt % args}")


def main() -> None:
    server = HTTPServer(("localhost", PORT), ProxyHandler)
    print(f"Sirviendo dashboard + proxy en http://localhost:{PORT}")
    print(f"Reenviando /api/* -> {UWU_LOGS_BASE}")
    print("Ctrl+C para parar")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nApagando servidor...")
        server.shutdown()


if __name__ == "__main__":
    main()
