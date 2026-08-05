"""
Cliente para la API (no oficial) de uwu-logs.xyz.

`get_character` está CONFIRMADO funcionando (probado en vivo por el usuario,
julio 2026): POST a /character con body {server, name, spec_i}.

`list_logs` (endpoint /logs_list) sigue reconstruido leyendo el código
fuente público del proyecto original (github.com/Ridepad/uwu-logs), no
verificado contra respuestas reales. Si falla, revisar acá primero.
"""

from __future__ import annotations

from typing import Optional

import requests

CHARACTER_URL = "https://uwu-logs.xyz/character"
LOGS_LIST_URL = "https://uwu-logs.xyz/logs_list"
REPORT_URL = "https://uwu-logs.xyz/reports/{report_id}/"


class UwuLogsError(Exception):
    """Error genérico al comunicarse con uwu-logs.xyz."""


class UwuLogsClient:
    def __init__(self, timeout: int = 15, session: Optional[requests.Session] = None):
        self.timeout = timeout
        self.session = session or requests.Session()

    def get_character(self, server: str, name: str, spec: str) -> dict:
        """Trae class_i / overall_points / overall_rank / bosses de un personaje.

        Confirmado en vivo — respuesta real de ejemplo (Yongii, Onyxia, spec 3):
        {
          "class_i": 0, "name": "Yongii", "server": "Onyxia",
          "overall_points": 9034.58, "overall_rank": 17,
          "bosses": {
            "Northrend Beasts": {
              "raid_id": "...", "rank_raids": 24, "rank_players": 18,
              "dps_max": 8421.83, "raids": 2, "points": 9547.24,
              "points_dps": ..., "points_rank_players": ..., "points_rank_raids": ...,
              "spec_total_players": 305, "spec_total_raids": 509, "spec_r1_dps": 9640.26,
              "report_id": "26-07-10--20-03--Deathtopia--Onyxia",
              "fastest_kill_duration": 339.32,
              "auras": "#2825/1/11.8/0#53908/2/8.7/1..."
            },
            "Koralon the Flame Watcher": {}   # boss sin intentos registrados: dict vacío
          }
        }
        """
        payload = {"server": server, "name": name, "spec_i": str(spec)}
        try:
            resp = self.session.post(CHARACTER_URL, json=payload, timeout=self.timeout)
            resp.raise_for_status()
            return resp.json()
        except requests.exceptions.RequestException as exc:
            raise UwuLogsError(
                f"No se pudo obtener el personaje {name} ({server}, spec {spec}): {exc}"
            ) from exc

    def get_character_auto(
        self, server: str, name: str, specs: tuple[str, ...] = ("1", "2", "3")
    ) -> tuple[str, dict]:
        """Detecta automáticamente la spec "principal" de un personaje.

        No hay endpoint que devuelva las 3 specs de una — cada llamada a
        /character exige un spec_i puntual. Esta función prueba las specs
        dadas (default 1, 2 y 3) y se queda con la que tenga más
        `overall_points`, asumiendo que esa es la spec con la que el jugador
        realmente juega/loguea. Devuelve (spec_detectada, data).

        Si alguna spec falla (personaje no tiene logs en esa spec, timeout,
        etc.) simplemente se ignora esa spec y se sigue con las demás. Si
        todas fallan, se relanza el último error.
        """
        best_spec: Optional[str] = None
        best_data: Optional[dict] = None
        best_points = float("-inf")
        last_error: Optional[UwuLogsError] = None

        for spec in specs:
            try:
                data = self.get_character(server, name, spec)
            except UwuLogsError as exc:
                last_error = exc
                continue
            points = data.get("overall_points") or 0
            if points > best_points:
                best_points = points
                best_spec = spec
                best_data = data

        if best_data is None:
            raise last_error or UwuLogsError(
                f"No se pudo detectar la spec de {name} ({server}): ninguna spec devolvió datos."
            )
        return best_spec, best_data

    def list_logs(
        self,
        server: str,
        player: Optional[str] = None,
        year: Optional[int] = None,
        month: Optional[int] = None,
    ) -> list[str]:
        """Devuelve una lista de report_ids que matchean el filtro. SIN VERIFICAR."""
        payload: dict = {"server": server}
        if player:
            payload["player"] = player
        if year:
            payload["year"] = year
        if month:
            payload["month"] = month

        try:
            resp = self.session.post(LOGS_LIST_URL, json=payload, timeout=self.timeout)
            resp.raise_for_status()
            return resp.json()
        except requests.exceptions.RequestException as exc:
            raise UwuLogsError(f"No se pudo listar logs para {payload}: {exc}") from exc

    @staticmethod
    def report_url(report_id: str) -> str:
        return REPORT_URL.format(report_id=report_id)
