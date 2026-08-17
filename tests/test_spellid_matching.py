from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = (ROOT / 'web/js/app.js').read_text(encoding='utf-8')
CFG = (ROOT / 'web/js/data/rotation-config.js').read_text(encoding='utf-8')
FROST = (ROOT / 'web/js/analysis/frost-dk.js').read_text(encoding='utf-8')


def test_core_rotation_matching_is_spellid_first():
    forbidden = [
        'rotationCfg.rotationNames.includes(name)',
        'rotationCfg.cooldownSnapshot.uptimeNames.includes(name)',
        'rotationCfg.timelineBuffExclude.includes(name)',
        'castsBySpellName[snap.summonSpellName]',
        "debugIntervalsByName['Combustion']",
    ]
    for token in forbidden:
        assert token not in APP


def test_gargoyle_damage_uses_spell_id():
    assert "r.spellId === '51963'" in APP
    assert '/Gargoyle Strike/i' not in APP
    assert '/Ebon Gargoyle/i' not in APP


def test_supported_classes_have_rotation_spell_ids():
    for cls in ['death-knight', 'warlock', 'mage', 'warrior', 'rogue', 'hunter', 'paladin', 'druid', 'priest', 'shaman']:
        needle = f"'{cls}': {{" if cls == 'death-knight' else f"{cls}: {{"
        start = CFG.index(needle)
        end = CFG.find('\n    },', start)
        block = CFG[start:end]
        assert 'rotationSpellIds:' in block, cls


def test_frost_indestructible_potion_is_spellid_based():
    assert "INDESTRUCTIBLE_POTION: '53720'" in FROST
    assert "debugIntervalsByName || {})['Indestructible Potion']" not in FROST
