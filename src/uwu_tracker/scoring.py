"""
La API de uwu-logs.xyz devuelve el puntaje en escala 0-10000 (percentil × 100,
ej. 9459 = percentil 94.59). Este módulo lo convierte a la escala real y lo
clasifica en los mismos tramos de color que usa el sitio (confirmados por el
usuario inspeccionando uwu-logs.xyz en vivo, julio 2026 — los tramos por
debajo de 90 son una aproximación al estilo Warcraftlogs, sin confirmar).
"""

from __future__ import annotations

from typing import Optional

# (umbral de percentil, etiqueta, hex)
TIERS = [
    (100, "Dorado", "#F4C35A"),      # confirmado
    (95, "Naranja intenso", "#F39A2D"),  # confirmado
    (90, "Naranja rojizo", "#F05A28"),   # confirmado
    (75, "Morado", "#a335ee"),        # sin confirmar
    (50, "Azul", "#0070de"),          # sin confirmar
    (25, "Verde", "#1eff00"),         # sin confirmar
    (0, "Gris", "#808080"),           # sin confirmar
]


def format_score(raw_points: Optional[float]) -> str:
    """9459 -> '94.59'"""
    if raw_points is None:
        return "?"
    return f"{raw_points / 100:.2f}"


def score_tier(raw_points: Optional[float]) -> str:
    if raw_points is None:
        return "?"
    pct = raw_points / 100
    for threshold, label, _hex in TIERS:
        if pct >= threshold:
            return label
    return "Gris"


def score_color(raw_points: Optional[float]) -> str:
    if raw_points is None:
        return "#9a9fab"
    pct = raw_points / 100
    for threshold, _label, hex_color in TIERS:
        if pct >= threshold:
            return hex_color
    return "#808080"
