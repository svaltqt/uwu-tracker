"""Capa de persistencia: guarda snapshots históricos en SQLite.

Schema alineado a la respuesta REAL confirmada de POST /character (ver api.py).
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from .models import BossStats, CharacterSnapshot

SCHEMA = """
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

DEFAULT_DB_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "uwu_logs.db"

_BOSS_FIELDS = [
    "raid_id", "rank_raids", "rank_players", "dps_max", "raids", "points",
    "points_dps", "points_rank_players", "points_rank_raids",
    "spec_total_players", "spec_total_raids", "spec_r1_dps", "report_id",
    "fastest_kill_duration", "auras",
]


class Database:
    def __init__(self, path: Path = DEFAULT_DB_PATH):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self.conn = sqlite3.connect(path)
        self.conn.executescript(SCHEMA)
        self.conn.commit()

    def close(self) -> None:
        self.conn.close()

    def __enter__(self) -> "Database":
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    # -- writes ---------------------------------------------------------

    def save_snapshot(self, server: str, name: str, spec: str, data: dict) -> int:
        """`data` es la respuesta cruda (ya parseada) de UwuLogsClient.get_character."""
        now = datetime.now(timezone.utc).isoformat()

        cur = self.conn.execute(
            """
            INSERT INTO snapshots (server, name, spec, fetched_at, class_i, overall_points, overall_rank, raw_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (server, name, spec, now, data.get("class_i"), data.get("overall_points"), data.get("overall_rank"), json.dumps(data)),
        )
        snapshot_id = cur.lastrowid

        for boss_name, b in (data.get("bosses") or {}).items():
            if not b:
                # Boss sin intentos registrados todavía (la API manda {} vacío).
                continue
            values = [b.get(f) for f in _BOSS_FIELDS]
            self.conn.execute(
                f"""
                INSERT INTO boss_kills (snapshot_id, boss_name, {", ".join(_BOSS_FIELDS)})
                VALUES (?, ?, {", ".join("?" for _ in _BOSS_FIELDS)})
                """,
                (snapshot_id, boss_name, *values),
            )

        self.conn.commit()
        return snapshot_id

    # -- reads ------------------------------------------------------------

    def get_snapshots(self, server: str, name: str, spec: str) -> list[CharacterSnapshot]:
        rows = self.conn.execute(
            """
            SELECT id, server, name, spec, fetched_at, class_i, overall_points, overall_rank, raw_json
            FROM snapshots
            WHERE server = ? AND name = ? AND spec = ?
            ORDER BY fetched_at ASC
            """,
            (server, name, spec),
        ).fetchall()

        return [
            CharacterSnapshot(
                id=r[0],
                server=r[1],
                name=r[2],
                spec=r[3],
                fetched_at=datetime.fromisoformat(r[4]),
                class_i=r[5],
                overall_points=r[6],
                overall_rank=r[7],
                raw=json.loads(r[8]),
            )
            for r in rows
        ]

    def get_latest_snapshot(self, server: str, name: str, spec: str) -> Optional[CharacterSnapshot]:
        snapshots = self.get_snapshots(server, name, spec)
        return snapshots[-1] if snapshots else None

    def get_all_characters(self) -> list[tuple[str, str, str]]:
        """Devuelve (server, name, spec) de todos los personajes con al menos un snapshot."""
        return self.conn.execute("SELECT DISTINCT server, name, spec FROM snapshots").fetchall()

    def get_boss_kills(self, server: str, name: str, spec: str) -> list[BossStats]:
        cols = ", ".join(f"b.{f}" for f in _BOSS_FIELDS)
        rows = self.conn.execute(
            f"""
            SELECT b.boss_name, {cols}
            FROM boss_kills b
            JOIN snapshots s ON s.id = b.snapshot_id
            WHERE s.server = ? AND s.name = ? AND s.spec = ?
            ORDER BY s.fetched_at DESC, b.fastest_kill_duration ASC
            """,
            (server, name, spec),
        ).fetchall()

        seen = set()
        kills = []
        for row in rows:
            boss_name = row[0]
            if boss_name in seen:
                continue
            seen.add(boss_name)
            kwargs = dict(zip(_BOSS_FIELDS, row[1:]))
            kills.append(BossStats(boss_name=boss_name, **kwargs))
        return kills
