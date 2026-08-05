import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from uwu_tracker.models import LogEntry  # noqa: E402


def test_from_report_id_parses_valid_format():
    entry = LogEntry.from_report_id("26-07-08--20-15--Bompa--Onyxia")
    assert entry.date == datetime(2026, 7, 8, 20, 15)
    assert entry.author == "Bompa"
    assert entry.server == "Onyxia"
    assert entry.url == "https://uwu-logs.xyz/reports/26-07-08--20-15--Bompa--Onyxia/"


def test_from_report_id_handles_garbage_gracefully():
    entry = LogEntry.from_report_id("no-es-un-report-id-valido")
    assert entry.date is None
    assert entry.author is None
    assert entry.server is None


if __name__ == "__main__":
    test_from_report_id_parses_valid_format()
    test_from_report_id_handles_garbage_gracefully()
    print("Todos los tests pasaron.")
