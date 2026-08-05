"""
Mapeo de `class_i` (tal como lo devuelve la API de uwu-logs.xyz) a nombre y
color de clase de WoW.

Confianza: SOLO class_i=0 está confirmado (Yongii, Death Knight, julio 2026).
El resto del mapeo se infiere asumiendo que el sitio usa un array en orden
ALFABÉTICO de las 10 clases de WotLK — un patrón común en este tipo de
sitios — pero no fue verificado. Si algún otro personaje muestra una clase
que no coincide con lo que predice esta tabla, actualizar acá.
"""

from __future__ import annotations

from typing import NamedTuple


class ClassInfo(NamedTuple):
    name: str
    color: str


# Orden alfabético (hipótesis, solo el índice 0 está confirmado en vivo).
CLASS_MAP: dict[int, ClassInfo] = {
    0: ClassInfo("Death Knight", "#C41F3B"),
    1: ClassInfo("Druid", "#FF7D0A"),
    2: ClassInfo("Hunter", "#ABD473"),
    3: ClassInfo("Mage", "#69CCF0"),
    4: ClassInfo("Paladin", "#F58CBA"),
    5: ClassInfo("Priest", "#FFFFFF"),
    6: ClassInfo("Rogue", "#FFF569"),
    7: ClassInfo("Shaman", "#0070DE"),
    8: ClassInfo("Warlock", "#9482C9"),
    9: ClassInfo("Warrior", "#C79C6E"),
}


def get_class_info(class_i: int | None) -> ClassInfo:
    if class_i is None or class_i not in CLASS_MAP:
        return ClassInfo(f"Clase #{class_i}" if class_i is not None else "?", "#9a9fab")
    return CLASS_MAP[class_i]


class SpecInfo(NamedTuple):
    name: str
    role: str


SPEC_MAP: dict[int, dict[str, SpecInfo]] = {
    0: {"1": SpecInfo("Blood", "Damage"), "2": SpecInfo("Frost", "Damage"), "3": SpecInfo("Unholy", "Damage")},
    1: {"1": SpecInfo("Balance", "Damage"), "2": SpecInfo("Feral", "Damage"), "3": SpecInfo("Restoration", "Healing")},
    2: {"1": SpecInfo("Beast Mastery", "Damage"), "2": SpecInfo("Marksmanship", "Damage"), "3": SpecInfo("Survival", "Damage")},
    3: {"1": SpecInfo("Arcane", "Damage"), "2": SpecInfo("Fire", "Damage"), "3": SpecInfo("Frost", "Damage")},
    4: {"1": SpecInfo("Holy", "Healing"), "2": SpecInfo("Protection", "Damage"), "3": SpecInfo("Retribution", "Damage")},
    5: {"1": SpecInfo("Discipline", "Healing"), "2": SpecInfo("Holy", "Healing"), "3": SpecInfo("Shadow", "Damage")},
    6: {"1": SpecInfo("Assassination", "Damage"), "2": SpecInfo("Combat", "Damage"), "3": SpecInfo("Subtlety", "Damage")},
    7: {"1": SpecInfo("Elemental", "Damage"), "2": SpecInfo("Enhancement", "Damage"), "3": SpecInfo("Restoration", "Healing")},
    8: {"1": SpecInfo("Affliction", "Damage"), "2": SpecInfo("Demonology", "Damage"), "3": SpecInfo("Destruction", "Damage")},
    9: {"1": SpecInfo("Arms", "Damage"), "2": SpecInfo("Fury", "Damage"), "3": SpecInfo("Protection", "Damage")},
}


def get_spec_info(class_i: int | None, spec: str | int | None) -> SpecInfo:
    spec_key = str(spec) if spec is not None else None
    if class_i is None or spec_key is None:
        return SpecInfo(f"Spec {spec_key}" if spec_key else "?", "Damage")
    class_specs = SPEC_MAP.get(class_i)
    if not class_specs or spec_key not in class_specs:
        return SpecInfo(f"Spec {spec_key}", "Damage")
    return class_specs[spec_key]
