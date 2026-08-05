"""
CLI de uwu-tracker.

    uwu-tracker fetch  --server Onyxia --name Yongii --spec 3
    uwu-tracker bosses --server Onyxia --name Yongii --spec 3
    uwu-tracker plot   --server Onyxia --name Yongii --spec 3
    uwu-tracker logs   --server Onyxia --name Yongii [--year 2026] [--month 7]
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

from .api import UwuLogsClient, UwuLogsError
from .db import DEFAULT_DB_PATH, Database
from .models import LogEntry
from .plotting import plot_evolution
from .scoring import format_score, score_tier
from .wow_classes import get_class_info, get_spec_info

OUTPUT_DIR = Path(__file__).resolve().parent.parent.parent / "data"


def cmd_fetch(args: argparse.Namespace) -> None:
    client = UwuLogsClient()
    auto_detected = args.spec is None
    try:
        if auto_detected:
            spec, data = client.get_character_auto(args.server, args.name)
        else:
            spec = args.spec
            data = client.get_character(args.server, args.name, args.spec)
    except UwuLogsError as exc:
        print(exc, file=sys.stderr)
        sys.exit(1)

    with Database(args.db) as db:
        snapshot_id = db.save_snapshot(args.server, args.name, spec, data)

    class_info = get_class_info(data.get("class_i"))
    spec_info = get_spec_info(data.get("class_i"), spec)
    bosses_with_data = {k: v for k, v in (data.get("bosses") or {}).items() if v}

    detected_note = " (auto-detectada: es la que tiene más puntos)" if auto_detected else ""
    print(f"Snapshot #{snapshot_id} guardado para {args.name} ({args.server}, spec {spec}{detected_note}).")
    print(f"  clase          = {class_info.name} (class_i={data.get('class_i')})")
    print(f"  spec           = {spec_info.name} ({spec_info.role})")
    print(f"  overall_points = {format_score(data.get('overall_points'))} ({score_tier(data.get('overall_points'))})")
    print(f"  overall_rank   = {data.get('overall_rank')}")
    print(f"  bosses con datos: {len(bosses_with_data)} / {len(data.get('bosses', {}))} totales")


def cmd_bosses(args: argparse.Namespace) -> None:
    with Database(args.db) as db:
        kills = db.get_boss_kills(args.server, args.name, args.spec)

    if not kills:
        print("No hay datos guardados todavía. Corré 'fetch' primero.")
        return

    print(f"{'Boss':25s} {'Rank raids':11s} {'Rank plyrs':11s} {'Points':8s} {'Tier':8s} {'Dps max':10s} {'Dur(s)':8s} {'Raids':6s}")
    print("-" * 100)
    for k in kills:
        dur_str = f"{k.fastest_kill_duration:.1f}" if k.fastest_kill_duration is not None else "?"
        dps_str = f"{k.dps_max:.0f}" if k.dps_max is not None else "?"
        print(
            f"{k.boss_name:25s} {str(k.rank_raids or '?'):11s} {str(k.rank_players or '?'):11s} "
            f"{format_score(k.points):8s} {score_tier(k.points):8s} {dps_str:10s} {dur_str:8s} {str(k.raids or '?'):6s}"
        )


def cmd_plot(args: argparse.Namespace) -> None:
    out_path = OUTPUT_DIR / f"{args.name}_{args.server}_spec{args.spec}_evolucion.png"
    with Database(args.db) as db:
        try:
            plot_evolution(db, args.server, args.name, args.spec, out_path)
        except ValueError as exc:
            print(exc)
            return
    print(f"Gráfico guardado en: {out_path}")


def cmd_logs(args: argparse.Namespace) -> None:
    client = UwuLogsClient()
    try:
        report_ids = client.list_logs(args.server, player=args.name, year=args.year, month=args.month)
    except UwuLogsError as exc:
        print(exc, file=sys.stderr)
        sys.exit(1)

    if not report_ids:
        print(f"No se encontraron logs para {args.name} en {args.server}.")
        return

    entries = [LogEntry.from_report_id(rid) for rid in report_ids]
    entries.sort(key=lambda e: (e.date is None, e.date), reverse=True)

    print(f"Logs encontrados para {args.name} ({args.server}): {len(entries)}\n")
    print(f"{'Fecha':20s} {'Subido por':20s} URL")
    print("-" * 90)
    for e in entries:
        date_str = e.date.strftime("%Y-%m-%d %H:%M") if e.date else "?"
        print(f"{date_str:20s} {(e.author or '?'):20s} {e.url}")


def cmd_export(args: argparse.Namespace) -> None:
    if not args.all and not (args.server and args.name and args.spec):
        print("Especificá --server/--name/--spec, o usá --all para exportar todo el roster guardado.", file=sys.stderr)
        sys.exit(1)

    with Database(args.db) as db:
        characters = db.get_all_characters() if args.all else [(args.server, args.name, args.spec)]

        rows = []
        for server, name, spec in characters:
            snap = db.get_latest_snapshot(server, name, spec)
            class_name = get_class_info(snap.class_i).name if snap else ""
            for k in db.get_boss_kills(server, name, spec):
                rows.append({
                    "server": server,
                    "name": name,
                    "spec": spec,
                    "class": class_name,
                    "overall_points": format_score(snap.overall_points) if snap else "",
                    "overall_tier": score_tier(snap.overall_points) if snap else "",
                    "overall_rank": snap.overall_rank if snap else "",
                    "boss": k.boss_name,
                    "points": format_score(k.points),
                    "tier": score_tier(k.points),
                    "rank_players": k.rank_players,
                    "rank_raids": k.rank_raids,
                    "dps_max": k.dps_max,
                    "fastest_kill_duration": k.fastest_kill_duration,
                    "raids": k.raids,
                    "report_id": k.report_id,
                })

    if not rows:
        print("No hay datos guardados para exportar. Corré 'fetch' primero.")
        return

    out_path = args.out or (OUTPUT_DIR / "export.csv")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    print(f"Exportadas {len(rows)} filas a: {out_path}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="uwu-tracker", description="Tracker histórico para uwu-logs.xyz")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH, help="Ruta a la base SQLite")
    sub = parser.add_subparsers(dest="command", required=True)

    p_fetch = sub.add_parser("fetch")
    p_fetch.add_argument("--server", required=True, help="Nombre exacto del servidor, ej: Onyxia")
    p_fetch.add_argument("--name", required=True, help="Nombre del personaje")
    p_fetch.add_argument(
        "--spec", required=False, default=None,
        help="Spec: 1, 2 o 3. Si se omite, se prueban las 3 y se guarda la que tenga más puntos (auto-detección).",
    )
    p_fetch.set_defaults(func=cmd_fetch)

    for name, fn in (("plot", cmd_plot), ("bosses", cmd_bosses)):
        p = sub.add_parser(name)
        p.add_argument("--server", required=True, help="Nombre exacto del servidor, ej: Onyxia")
        p.add_argument("--name", required=True, help="Nombre del personaje")
        p.add_argument("--spec", required=True, help="Spec: 1, 2 o 3 (tiene que coincidir con un fetch guardado)")
        p.set_defaults(func=fn)

    p_logs = sub.add_parser("logs", help="Lista los reportes subidos donde participó el personaje")
    p_logs.add_argument("--server", required=True, help="Nombre exacto del servidor, ej: Onyxia")
    p_logs.add_argument("--name", required=True, help="Nombre del personaje")
    p_logs.add_argument("--year", type=int, default=None, help="Filtrar por año (opcional, ej: 2026)")
    p_logs.add_argument("--month", type=int, default=None, help="Filtrar por mes (opcional, 1-12)")
    p_logs.set_defaults(func=cmd_logs)

    p_export = sub.add_parser("export", help="Exportar los datos guardados a un CSV")
    p_export.add_argument("--server", help="Nombre exacto del servidor, ej: Onyxia")
    p_export.add_argument("--name", help="Nombre del personaje")
    p_export.add_argument("--spec", help="Spec: 1, 2 o 3")
    p_export.add_argument("--all", action="store_true", help="Exportar todos los personajes guardados en la DB")
    p_export.add_argument("--out", type=Path, default=None, help="Ruta del CSV de salida (default: data/export.csv)")
    p_export.set_defaults(func=cmd_export)

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
