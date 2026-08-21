from pathlib import Path


ROOT = Path(__file__).parents[1]
APP = (ROOT / "web" / "js" / "app.js").read_text(encoding="utf-8")
FIRE = (ROOT / "web" / "js" / "analysis" / "fire-mage.js").read_text(encoding="utf-8")


def test_fire_mage_summary_is_boss_aware():
    assert "computeFireMageAnalysis(result, bossName)" in APP
    assert "isNorthrendBeasts(bossName)" in FIRE
    assert "usedPriorityWindows" in FIRE


def test_northrend_beasts_metrics_use_spell_ids():
    for spell_id in ("12654", "48108", "55360", "42926", "42925", "11129", "55342", "66", "32612"):
        assert f"'{spell_id}'" in FIRE


def test_combustion_reads_actual_player_buffs():
    assert "relevantProcSeries(result)" in FIRE
    assert "category: 'Trinket'" in FIRE
    assert "category: 'Racial'" in FIRE
    assert "Active at activation:" in APP
    assert "Triggered during the window:" in APP


def test_damage_breakdown_is_reused_for_ignite():
    assert "result.damageBreakdown = parsePlayerDamageBreakdownHtml(playerHtml)" in APP
    assert "breakdown.entries" in FIRE


def test_combustion_and_invisibility_use_encounter_windows():
    assert "window.start >= 0 && window.start <= 15000" in FIRE
    assert "ICEHOWL_DAZE_DELAY_MS = 40000" in FIRE
    assert "ICEHOWL_DAZE_WINDOW_MS = 15000" in FIRE
    assert "isCombustionName(cast.name)" in FIRE
    assert "combustionSpellIds(result)" in FIRE
    assert "invisibilityBetweenWormsAndIcehowl" in FIRE
    assert "You used Invisibility after the Jormungars" in APP


def test_three_priority_potion_windows_are_reported():
    assert "possiblePriorityWindows: 3" in FIRE
    assert "use.ms >= -15000 && use.ms <= 0" in FIRE
    assert "Potion #1 — Pre-pull" in APP
    assert "Potion #2 — After Gormok died" in APP
    assert "Potion #3 — Icehowl: Staggered Daze" in APP


def test_fire_mage_miscellaneous_consumables_are_reported():
    for spell_id in ("54758", "56488", "56350", "53755"):
        assert f"'{spell_id}'" in FIRE
    assert "NORTHREND_BEASTS_POTIONS_EXPECTED = 3" in FIRE
    assert "PREPOT_WINDOW_MS = 60000" in FIRE
    assert "You had a Flask of the Frost Wyrm" in APP
    assert "Potions used (Wild Magic / Speed)" in APP


def test_hot_streak_reaction_time_and_proc_details_are_reported():
    assert "hotStreakProcWindows(result)" in FIRE
    assert "averageReactionMs" in FIRE
    assert "fastestReactionMs" in FIRE
    assert "slowestReactionMs" in FIRE
    assert "Hot Streak proc details" in APP
    assert "Average reaction time" in APP
    assert "overwritten at" in APP
