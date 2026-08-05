"""Estructuras de datos usadas en todo el proyecto.

Los campos de CharacterSnapshot y BossStats reflejan la respuesta REAL y
confirmada de POST /character (ver api.py para el ejemplo completo).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Optional


@dataclass
class RosterMember:
    """Un personaje del roster que queremos trackear."""
    name: str
    spec: str
    server: str


@dataclass
class CharacterSnapshot:
    """Una foto en el tiempo del estado de un personaje (puntaje/rank)."""
    id: Optional[int]
    server: str
    name: str
    spec: str
    fetched_at: datetime
    class_i: Optional[int]
    overall_points: Optional[float]
    overall_rank: Optional[int]
    raw: dict


@dataclass
class BossStats:
    """Estadísticas de un personaje contra un boss puntual (tal como las devuelve la API)."""
    boss_name: str
    raid_id: Optional[str] = None
    rank_raids: Optional[int] = None
    rank_players: Optional[int] = None
    dps_max: Optional[float] = None
    raids: Optional[int] = None
    points: Optional[float] = None
    points_dps: Optional[float] = None
    points_rank_players: Optional[float] = None
    points_rank_raids: Optional[float] = None
    spec_total_players: Optional[int] = None
    spec_total_raids: Optional[int] = None
    spec_r1_dps: Optional[float] = None
    report_id: Optional[str] = None
    fastest_kill_duration: Optional[float] = None
    auras: Optional[str] = None


@dataclass
class LogEntry:
    """Un reporte/log individual subido a uwu-logs.xyz."""
    report_id: str
    date: Optional[datetime]
    author: Optional[str]
    server: Optional[str]

    @property
    def url(self) -> str:
        return f"https://uwu-logs.xyz/reports/{self.report_id}/"

    @classmethod
    def from_report_id(cls, report_id: str) -> "LogEntry":
        """Parsea el formato conocido: YY-MM-DD--HH-MM--Autor--Servidor"""
        try:
            date_part, time_part, author, server = report_id.split("--")
            yy, mm, dd = date_part.split("-")
            hh, mi = time_part.split("-")
            date = datetime(2000 + int(yy), int(mm), int(dd), int(hh), int(mi))
            return cls(report_id=report_id, date=date, author=author, server=server)
        except (ValueError, IndexError):
            return cls(report_id=report_id, date=None, author=None, server=None)
