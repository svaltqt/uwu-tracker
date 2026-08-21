from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = (ROOT / 'web/js/app.js').read_text()
PROXY = (ROOT / 'proxy_server.py').read_text()
CSS = (ROOT / 'web/css/style.css').read_text()


def test_proxy_exposes_uwu_get_dps_endpoint():
    assert '"report_dps": "/reports/{report_id}/get_dps"' in PROXY
    assert '"report_dps"' in PROXY


def test_replay_uses_one_second_buckets_and_limits_top10_requests():
    assert "attempt: String(info.attempt ?? 0)" in APP
    assert "slice(0, 10)" in APP
    assert "mapWithConcurrency(candidates, 3" in APP
    assert "fetchDpsSeriesWithAttemptFallback(reportId, bossHtml, attempt, name, 1)" in APP


def test_replay_tab_is_after_timeline():
    timeline = APP.index('data-dktab="timeline">Timeline')
    replay = APP.index('data-dktab="replay">Raid Replay')
    assert replay > timeline


def test_replay_has_play_pause_and_top10_table_without_dps_now():
    assert '▶ PLAY' in APP
    assert '⏸ PAUSE' in APP
    assert 'DPS now' not in APP
    assert '<th>Avg DPS</th>' in APP
    assert '<th>Damage</th>' in APP
    assert 'replay.players' in APP
    assert ".sort((a, b) => b.avg - a.avg" in APP


def test_empty_dps_responses_are_not_cached():
    assert 'if upstream_path.endswith("/get_dps")' in PROXY
    assert 'should_cache = bool(parsed)' in PROXY
    assert 'stale_empty_dps' in PROXY


def test_dps_proxy_mimics_in_page_request_context():
    assert '"Origin": UWU_LOGS_BASE' in PROXY
    assert '"Referer": f"{UWU_LOGS_BASE}/reports/' in PROXY
    assert 'player_name = str(payload.get("player_name") or "")' in PROXY


def test_dps_proxy_has_dedicated_local_post_route_before_generic_404():
    assert 'REPORT_DPS_ROUTE_RE = re.compile(r"^/api/report_dps/([^/?]+)$")' in PROXY
    assert 'parsed = urlsplit(self.path)' in PROXY
    assert 'path = parsed.path' in PROXY
    dps_match = PROXY.index('match = REPORT_DPS_ROUTE_RE.match(path)')
    local_404 = PROXY.index('self.send_error(404, "Ruta de proxy desconocida")')
    assert dps_match < local_404


def test_replay_highlights_bloodlust_and_heroism_windows():
    assert "['2825', '32182']" in APP
    assert 'data-bloodlust-windows=' in APP
    assert 'raid-replay-bloodlust-band' in APP
    assert "Bloodlust / Heroism active" in APP
    assert "t * 1000 >= startMs" in APP
    assert "height: 16px" in CSS
    assert "background: rgba(18, 126, 255, 0.82)" in CSS
    assert ".raid-replay-slider::-webkit-slider-thumb" in CSS
