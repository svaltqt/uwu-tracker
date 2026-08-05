"""Generación de gráficos de evolución a partir de snapshots guardados."""

from __future__ import annotations

from pathlib import Path

from .db import Database


def plot_evolution(db: Database, server: str, name: str, spec: str, out_path: Path) -> Path:
    """Grafica overall_points y overall_rank en el tiempo. Devuelve la ruta del PNG."""
    import matplotlib.pyplot as plt

    snapshots = db.get_snapshots(server, name, spec)
    if not snapshots:
        raise ValueError("No hay snapshots guardados para ese personaje todavía.")

    dates = [s.fetched_at for s in snapshots]
    points = [s.overall_points for s in snapshots]
    ranks = [s.overall_rank for s in snapshots]

    fig, ax1 = plt.subplots(figsize=(10, 5))

    ax1.set_xlabel("Fecha")
    ax1.set_ylabel("Overall points", color="tab:blue")
    ax1.plot(dates, points, color="tab:blue", marker="o", label="Overall points")
    ax1.tick_params(axis="y", labelcolor="tab:blue")

    ax2 = ax1.twinx()
    ax2.set_ylabel("Overall rank (menor = mejor)", color="tab:red")
    ax2.plot(dates, ranks, color="tab:red", marker="s", label="Overall rank")
    ax2.invert_yaxis()
    ax2.tick_params(axis="y", labelcolor="tab:red")

    plt.title(f"Evolución de {name} ({server}, spec {spec})")
    fig.autofmt_xdate()
    fig.tight_layout()

    out_path.parent.mkdir(parents=True, exist_ok=True)
    plt.savefig(out_path, dpi=150)
    plt.close(fig)
    return out_path
