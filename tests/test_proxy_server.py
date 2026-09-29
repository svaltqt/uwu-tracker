"""Reproduce bugs de proxy_server.py contra un upstream falso en localhost.

No llama a uwu-logs.xyz: UWU_LOGS_BASE apunta a un servidor local que graba
los paths recibidos. Las DBs van a un directorio temporal.
"""

import http.client
import http.server
import json
import os
import socket
import sys
import tempfile
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

UPSTREAM_DELAY = 0.5
upstream_paths = []
_inflight = {"now": 0, "max": 0}
_inflight_lock = threading.Lock()


class _ThreadingUpstream(http.server.ThreadingHTTPServer):
    # En Windows el backlog por defecto (5) pierde conexiones simultáneas.
    request_queue_size = 64


class _FakeUpstream(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        self.rfile.read(length)
        upstream_paths.append(self.path)
        if self.path == "/character":
            with _inflight_lock:
                _inflight["now"] += 1
                _inflight["max"] = max(_inflight["max"], _inflight["now"])
            time.sleep(UPSTREAM_DELAY)
            with _inflight_lock:
                _inflight["now"] -= 1
        body = json.dumps({"class_i": 0, "overall_points": 1, "bosses": {}}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _boot():
    upstream = _ThreadingUpstream(("127.0.0.1", 0), _FakeUpstream)
    threading.Thread(target=upstream.serve_forever, daemon=True).start()

    tmp = tempfile.mkdtemp(prefix="uwu-proxy-test-")
    os.environ["UWU_LOGS_BASE"] = f"http://127.0.0.1:{upstream.server_address[1]}"
    os.environ["ANALYSIS_CACHE_DB"] = str(Path(tmp) / "cache.db")
    os.environ["UWU_TRACKER_DB"] = str(Path(tmp) / "history.db")

    sys.path.insert(0, str(ROOT))
    import proxy_server

    proxy_server.PORT = _free_port()
    # main() es el entry point real: así el test ejerce la clase de servidor
    # que de verdad se usa (HTTPServer vs ThreadingHTTPServer).
    threading.Thread(target=proxy_server.main, daemon=True).start()
    deadline = time.time() + 5
    while time.time() < deadline:
        try:
            socket.create_connection(("127.0.0.1", proxy_server.PORT), timeout=0.2).close()
            break
        except OSError:
            time.sleep(0.05)
    return proxy_server


proxy_server = _boot()


def _post(path, body=b"{}", timeout=10):
    conn = http.client.HTTPConnection("127.0.0.1", proxy_server.PORT, timeout=timeout)
    conn.request("POST", path, body=body, headers={"Content-Type": "application/json"})
    resp = conn.getresponse()
    resp.read()
    conn.close()
    return resp.status


def _post_quiet(path, body):
    try:
        _post(path, body, timeout=4)
    except OSError:
        pass  # una conexión perdida no invalida la medición de concurrencia


def test_concurrent_character_requests_are_not_serialized():
    # Un servidor de un solo hilo atiende de a una: el upstream nunca vería
    # dos requests en vuelo a la vez. (Se mide concurrencia en el upstream y
    # no tiempos de reloj, porque en Windows el loopback pierde alguna
    # conexión simultánea de vez en cuando.)
    _inflight["max"] = 0
    body = json.dumps({"server": "Onyxia", "name": "Concurrent", "spec_i": "1"}).encode()
    threads = [threading.Thread(target=_post_quiet, args=("/api/character", body)) for _ in range(3)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert _inflight["max"] >= 2, f"máx. requests simultáneas en el upstream: {_inflight['max']}"


def test_failed_boss_insert_leaves_no_orphan_snapshot():
    db = proxy_server.HISTORY_DB
    data = {
        "class_i": 0, "overall_points": 5000, "overall_rank": 1,
        # entero fuera del rango de SQLite: falla el INSERT de boss_kills
        # después de haber insertado el snapshot
        "bosses": {"Boss A": {"points": 1, "rank_raids": 2 ** 70}},
    }
    try:
        proxy_server._save_history_snapshot("Onyxia", "Orphan", "1", data)
    except Exception:
        pass
    db.commit()  # lo que haría el próximo guardado exitoso
    n = db.execute("SELECT COUNT(*) FROM snapshots WHERE name = 'Orphan'").fetchone()[0]
    assert n == 0, f"snapshot huérfano guardado ({n})"


def test_list_and_dict_boss_fields_are_stored_as_json():
    db = proxy_server.HISTORY_DB
    data = {
        "class_i": 0, "overall_points": 5000, "overall_rank": 1,
        "bosses": {"Boss A": {"points": 1, "auras": ["#1/2/3"]}},
    }
    proxy_server._save_history_snapshot("Onyxia", "ListAuras", "1", data)
    row = db.execute(
        "SELECT b.auras FROM boss_kills b JOIN snapshots s ON s.id = b.snapshot_id WHERE s.name = 'ListAuras'"
    ).fetchone()
    assert row is not None and json.loads(row[0]) == ["#1/2/3"]


def test_report_id_cannot_change_upstream_route():
    for route in ("report_segments", "report_casts"):
        upstream_paths.clear()
        conn = http.client.HTTPConnection("127.0.0.1", proxy_server.PORT, timeout=10)
        conn.request("POST", f"/api/{route}/x/../../character", body=b"{}",
                     headers={"Content-Type": "application/json"})
        conn.getresponse().read()
        conn.close()
        assert upstream_paths, "el upstream no recibió nada"
        parts = upstream_paths[-1].split("/")
        # "/reports/<un solo segmento>/<ruta>/" => ["", "reports", id, ruta, ""]
        assert len(parts) == 5 and parts[1] == "reports", f"{route}: upstream recibió {upstream_paths[-1]}"


def test_invalid_content_length_returns_400():
    with socket.create_connection(("127.0.0.1", proxy_server.PORT), timeout=3) as s:
        s.sendall(
            b"POST /api/character HTTP/1.1\r\nHost: x\r\nContent-Length: abc\r\n\r\n"
        )
        try:
            data = s.recv(1024)
        except socket.timeout:
            data = b""
    assert data.startswith(b"HTTP/1.") and b" 400 " in data.split(b"\r\n", 1)[0], (
        f"respuesta: {data[:60]!r}"
    )
