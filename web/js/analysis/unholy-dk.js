// Análisis específico para Death Knight - Unholy.
//
// Mismo criterio que frost-dk.js: matching por spell ID (no por nombre,
// que viene en el idioma del cliente que grabó el log), y solo con IDs
// confirmados contra datos reales — nunca sacados de una wiki a ciegas.
//
// LIMITACIÓN CONOCIDA (igual que Frost, ver docs/API.md): no hay estado de
// Runic Power por evento, así que "Total Runic Power gained using AMS" y
// "Over-capped Runic Power" NO se calculan — se muestran como pendientes.
//
// Buffs de fuerza confirmados en Timeline/UwU Logs:
// - Fallen Crusader aparece como aura 'Unholy Strength' (spell 53365).
// - Sigil of Virulence aparece como aura 'Unholy Force' (spell 67383).
// - report_casts no incluye eventos cuya fuente sea una mascota. El daño de
//   Gárgola / Army / Ghoul se complementa desde la tabla HTML de Damage de
//   UwU Logs (player page) en app.js.

const SPELL = {
  BLOOD_PLAGUE: '55078',
  FROST_FEVER: '55095',
  DEATH_AND_DECAY: '52212',
  DEATH_AND_DECAY_CAST_IDS: ['49938', '52212'],
  DESOLATION: '66803',
  BONE_SHIELD: '49222',
  UNHOLY_BLIGHT: '50536',
  GHOUL_FRENZY: '63560',
  BLOOD_TAP: '45529',
  BLOOD_PRESENCE: '50475',
  FROST_PRESENCE: '48263',
  UNHOLY_PRESENCE: '48265',
  SUMMON_GARGOYLE: '49206',
  ARMY_OF_THE_DEAD: '42651',
  // "Raise Dead" salió con 2 IDs distintos en 2 logs reales distintos
  // (probablemente rangos/versiones distintas del hechizo) — se prueban
  // los 2 para ubicar el SPELL_SUMMON y sacar el nombre real del ghoul.
  RAISE_DEAD_IDS: ['52150', '46585'],
  EMPOWER_RUNE_WEAPON: '47568',
  ANTI_MAGIC_SHELL: '49088',
  BLOODLUST: '2825',
  HEROISM: '32182', // no confirmado contra datos reales (no vimos un log Horda) — mismo ID estable que ya usamos en app.js
  HYPERSPEED_ACCELERATION: '54758',
  SPEED_POTION: '53908',
  UNHOLY_MIGHT_T9: '67117',
  // "Paragon" tiene 2 IDs distintos confirmados en 2 logs reales
  // distintos — son trinkets diferentes que comparten nombre visual, no
  // el mismo ítem. Se tratan como procs separados.
  PARAGON_IDS: ['67708', '67773'],
  FALLEN_CRUSADER: '53365', // aura: Unholy Strength, proc de Rune of the Fallen Crusader
  SIGIL_OF_VIRULENCE: '67383', // aura: Unholy Force, +200 Strength / 20s
  SKYFLARE_SWIFTNESS: '55379',
  BLACK_MAGIC: '59626',
  SARONITE_BOMB: '56350',
  GLOBAL_THERMAL_SAPPER_CHARGE: '56488',
  FLASK_OF_ENDLESS_RAGE: '53760', // aura real observada en UwU Logs; 53903 es la receta que crea el item
};

// WotLK 3.3.5a: Summon Gargoyle tiene una duración máxima de 30 segundos.
// Si el aura del log se extiende más por cómo la representa UwU Logs, se
// recorta a 30s; si el pull termina antes, conservamos la duración menor.
const GARGOYLE_DURATION_MS = 30000;
const GARGOYLE_COOLDOWN_MS = 180000;
const BLOOD_TAP_COOLDOWN_MS = 60000;
const GLOBAL_THERMAL_SAPPER_COOLDOWN_MS = 300000;

export function isUnholyDk(result) {
  if (!result || (result.raw.CLASS || '').toLowerCase() !== 'death-knight') return false;
  const ids = new Set(result.spellCounts.map((s) => String(s.id)));
  result.uptimes.forEach((u) => ids.add(String(u.id)));
  return ids.has(SPELL.SUMMON_GARGOYLE) || ids.has(SPELL.BONE_SHIELD) || ids.has(SPELL.DESOLATION) || ids.has(SPELL.GHOUL_FRENZY);
}

function pct(part, whole) {
  return whole > 0 ? (part / whole) * 100 : 0;
}

function castsOf(result, spellId) {
  return result.timeline
    .filter((t) => String(t.id) === spellId)
    .map((t) => t.ms)
    .sort((a, b) => a - b);
}

function intervalsOf(result, spellId) {
  return (result.debugIntervalsById && result.debugIntervalsById[spellId]) || [];
}

function uptimePctFor(result, spellId) {
  const found = result.uptimes.find((u) => String(u.id) === spellId);
  return found ? found.pct : null;
}

// Death and Decay is not reliably exposed as a normal APPLIED/REMOVED aura in
// report_casts. On real UwU Logs reports the rank-4 cast can appear as 49938,
// while the periodic effect is represented as 52212. Compute uptime from each
// real cast as a 10-second ground-effect window and merge overlaps. This also
// preserves the old aura-based value as a fallback when it is available.

function boneShieldUptimePct(result) {
  const detected = uptimePctFor(result, SPELL.BONE_SHIELD);
  if (detected != null) return detected;
  // Unholy DK normally pre-casts Bone Shield before combat. report_casts
  // often starts at the pull and therefore contains no APPLIED event at all.
  // With no Bone Shield aura evidence inside the segment, assume it was
  // already active at t=0 until the log provides evidence to the contrary.
  return 100;
}

function deathAndDecayUptimePct(result) {
  const fightMs = Number(result.raw && result.raw.RDURATION || 0) * 1000;
  if (!fightMs) return null;

  const castTimes = [...new Set(
    SPELL.DEATH_AND_DECAY_CAST_IDS.flatMap((id) => castsOf(result, id))
  )].sort((a, b) => a - b);

  if (castTimes.length) {
    const windows = castTimes.map((ms) => [Math.max(0, ms), Math.min(fightMs, ms + 10000)]);
    const merged = [];
    windows.forEach(([s, e]) => {
      if (e <= s) return;
      const last = merged[merged.length - 1];
      if (last && s <= last[1]) last[1] = Math.max(last[1], e);
      else merged.push([s, e]);
    });
    const activeMs = merged.reduce((sum, [s, e]) => sum + (e - s), 0);
    return Math.min(100, (activeMs / fightMs) * 100);
  }

  for (const id of SPELL.DEATH_AND_DECAY_CAST_IDS) {
    const auraPct = uptimePctFor(result, id);
    if (auraPct != null) return auraPct;
  }
  return null;
}

function isActiveAt(result, spellId, ms) {
  return intervalsOf(result, spellId).some(([s, e]) => ms >= s && ms <= e);
}

function anyActiveAt(result, spellIds, ms) {
  return spellIds.some((id) => isActiveAt(result, id, ms));
}

// Presence is a persistent DK state, not a normal short-lived buff. UwU Logs
// may start the encounter after the player already entered a Presence, so an
// APPLIED event is often absent at t=0. For Unholy DK we intentionally infer
// Unholy Presence as the initial state for Unholy DK. A pre-pull Presence
// often has no APPLIED event inside the encounter slice, so absence of an event
// must not be interpreted as absence of the aura. Every later Presence APPLIED
// event replaces the current state because only one Presence can be active at a time.
function inferredPresenceState(result) {
  const fightMs = (result.raw.RDURATION || 0) * 1000;
  const presenceIds = [SPELL.UNHOLY_PRESENCE, SPELL.BLOOD_PRESENCE, SPELL.FROST_PRESENCE];
  const rawData = (result.raw && (result.raw.DATA || result.raw.data)) || {};
  const selfName = result.raw && result.raw.NAME;
  const transitions = [];

  presenceIds.forEach((id) => {
    const events = rawData[id];
    if (!Array.isArray(events)) return;
    events.forEach((ev) => {
      if (!Array.isArray(ev)) return;
      const [ms, flag, source, target] = ev;
      if (flag !== 'SPELL_AURA_APPLIED') return;
      // Presence is self-only. Accept either source or target matching self to
      // tolerate the slightly different event shapes seen in UwU Logs.
      if (selfName && source !== selfName && target !== selfName) return;
      transitions.push({ ms: Number(ms) || 0, id });
    });
  });

  transitions.sort((a, b) => a.ms - b.ms);

  // De-duplicate simultaneous entries, preferring the last one encountered.
  const compact = [];
  transitions.forEach((tr) => {
    const prev = compact[compact.length - 1];
    if (prev && prev.ms === tr.ms && prev.id === tr.id) return;
    compact.push(tr);
  });

  let current = SPELL.UNHOLY_PRESENCE;
  let cursor = 0;
  const intervals = {
    [SPELL.UNHOLY_PRESENCE]: [],
    [SPELL.BLOOD_PRESENCE]: [],
    [SPELL.FROST_PRESENCE]: [],
  };

  compact.forEach(({ ms, id }) => {
    const t = Math.max(0, Math.min(fightMs, ms));
    if (current && t > cursor) intervals[current].push([cursor, t]);
    current = id;
    cursor = t;
  });

  if (current && fightMs > cursor) intervals[current].push([cursor, fightMs]);

  return { transitions: compact, intervals, initialAssumption: 'unholy' };
}

function presenceActiveAt(result, spellId, ms) {
  const state = inferredPresenceState(result);
  return (state.intervals[spellId] || []).some(([s, e]) => ms >= s && ms <= e);
}

// Suma de ms "up" para un spell ID, RECORTANDO por fuera de una lista de
// ventanas [start,end] a excluir (ej: Blood Presence afuera de Gárgola).
function uptimeMsExcluding(result, spellId, excludeWindows) {
  const intervals = intervalsOf(result, spellId);
  let total = 0;
  intervals.forEach(([s, e]) => {
    // Recortamos el intervalo contra cada ventana excluida.
    let segments = [[s, e]];
    excludeWindows.forEach(([ws, we]) => {
      const next = [];
      segments.forEach(([segS, segE]) => {
        if (we <= segS || ws >= segE) { next.push([segS, segE]); return; } // no se solapan
        if (ws > segS) next.push([segS, ws]);
        if (we < segE) next.push([we, segE]);
      });
      segments = next;
    });
    segments.forEach(([segS, segE]) => { total += Math.max(0, segE - segS); });
  });
  return total;
}

function analyzeGargoyle(result) {
  // IMPORTANTE: contamos invocaciones por SPELL_CAST_SUCCESS, no por
  // intervalos de aura. Un intervalo puede fusionar o perder invocaciones
  // en peleas largas; cada cast 49206 es una Gargoyle real independiente.
  const summonCasts = castsOf(result, SPELL.SUMMON_GARGOYLE);
  if (!summonCasts.length) return null;
  const fightMs = (result.raw.RDURATION || 0) * 1000;
  const erwCasts = castsOf(result, SPELL.EMPOWER_RUNE_WEAPON);
  const uses = summonCasts.map((start, i) => {
    const end = Math.min(fightMs || (start + GARGOYLE_DURATION_MS), start + GARGOYLE_DURATION_MS);
    const snapshot = (spellId) => isActiveAt(result, spellId, start);
    return {
      index: i + 1,
      start,
      end,
      durationSec: Math.max(0, (end - start) / 1000),
      withErw: erwCasts.some((ms) => ms >= start - 3000 && ms <= end),
      unholyPresence: presenceActiveAt(result, SPELL.UNHOLY_PRESENCE, start),
      bloodlustOrHeroism: anyActiveAt(result, [SPELL.BLOODLUST, SPELL.HEROISM], start),
      hyperspeed: snapshot(SPELL.HYPERSPEED_ACCELERATION),
      speedPotion: snapshot(SPELL.SPEED_POTION),
      unholyMightT9: snapshot(SPELL.UNHOLY_MIGHT_T9),
      trinket1: isActiveAt(result, SPELL.PARAGON_IDS[0], start),
      trinket2: isActiveAt(result, SPELL.PARAGON_IDS[1], start),
      paragon: anyActiveAt(result, SPELL.PARAGON_IDS, start),
      skyflareSwiftness: snapshot(SPELL.SKYFLARE_SWIFTNESS),
      blackMagic: snapshot(SPELL.BLACK_MAGIC),
      fallenCrusader: snapshot(SPELL.FALLEN_CRUSADER),
      sigilOfVirulence: snapshot(SPELL.SIGIL_OF_VIRULENCE),
    };
  });
  const possible = Math.max(1, Math.floor(fightMs / GARGOYLE_COOLDOWN_MS) + 1);
  return { uses: uses.length, possible, windows: uses };
}

function analyzeArmyOfTheDead(result) {
  const casts = castsOf(result, SPELL.ARMY_OF_THE_DEAD);
  if (!casts.length) return null;
  return casts.map((ms) => ({
    ms,
    bloodlustOrHeroism: anyActiveAt(result, [SPELL.BLOODLUST, SPELL.HEROISM], ms),
    hyperspeed: isActiveAt(result, SPELL.HYPERSPEED_ACCELERATION, ms),
    speedPotion: isActiveAt(result, SPELL.SPEED_POTION, ms),
    skyflareSwiftness: isActiveAt(result, SPELL.SKYFLARE_SWIFTNESS, ms),
    blackMagic: isActiveAt(result, SPELL.BLACK_MAGIC, ms),
    // Daño de Army of the Dead: no implementado — requiere sumar eventos
    // fuente = las mascotas invocadas (no el jugador), ver nota arriba.
  }));
}

// Ghoul permanente: buscamos el SPELL_SUMMON de Raise Dead para sacar el
// nombre real de la mascota (es aleatorio por jugador/pelea), y a partir
// de ahí medimos su uptime "vivo" (mientras exista como target de algo)
// y de melee (mientras aparezca como SOURCE de daño de arma).
function findGhoulName(result) {
  for (const id of SPELL.RAISE_DEAD_IDS) {
    const summonEntry = (result.raw.DATA && result.raw.DATA[id]) || (result.raw.data && result.raw.data[id]);
    if (!Array.isArray(summonEntry)) continue;
    const summonEvent = summonEntry.find((ev) => ev[1] === 'SPELL_SUMMON' && ev[2] === result.raw.NAME);
    if (summonEvent && summonEvent[3] && summonEvent[3] !== 'nil') return summonEvent[3];
  }
  return null;
}

function analyzeConsumables(result) {
  // Flask lasts 1 hour and persists through death. The encounter slice often
  // begins after the aura was already active, so absence of an APPLIED event
  // inside the pull must not be treated as "no flask". For Unholy Summary we
  // therefore assume it is active at pull unless the log explicitly gives us
  // a later application; either way, "You had a Flask" is true for the fight.
  const flaskIntervals = intervalsOf(result, SPELL.FLASK_OF_ENDLESS_RAGE);
  const flaskDetectedInLog = flaskIntervals.length > 0;
  const flaskUsed = true;

  const fightMs = (result.raw.RDURATION || 0) * 1000;
  const oneMinutePossible = Math.max(1, Math.floor(fightMs / 60000) + 1);
  // Global Thermal Sapper Charge has a 5 minute cooldown. Therefore a fight
  // shorter than 5:00 has a maximum of one use; >5:00 can allow a second, etc.
  const sapperPossible = Math.max(1, Math.floor(fightMs / GLOBAL_THERMAL_SAPPER_COOLDOWN_MS) + 1);
  const hyperspeedUses = castsOf(result, SPELL.HYPERSPEED_ACCELERATION).length
    || intervalsOf(result, SPELL.HYPERSPEED_ACCELERATION).length;
  const saroniteUses = castsOf(result, SPELL.SARONITE_BOMB).length;
  const globalThermalUses = castsOf(result, SPELL.GLOBAL_THERMAL_SAPPER_CHARGE).length;
  return {
    flaskUsed,
    flaskDetectedInLog,
    flaskInferredAtPull: !flaskDetectedInLog,
    hyperspeed: { used: hyperspeedUses, possible: oneMinutePossible },
    saroniteBomb: { used: saroniteUses, possible: oneMinutePossible },
    globalThermalSapperCharge: { used: globalThermalUses, possible: sapperPossible },
  };
}

export function computeUnholyAnalysis(result) {
  const gargoyle = analyzeGargoyle(result);
  const gargoyleWindows = gargoyle ? gargoyle.windows.map(({ start, end }) => [start, end]) : [];

  const diseaseUptimes = result.uptimes.filter((u) => [SPELL.BLOOD_PLAGUE, SPELL.FROST_FEVER].includes(String(u.id)));
  const diseaseAvgPct = diseaseUptimes.length
    ? diseaseUptimes.reduce((s, u) => s + u.pct, 0) / diseaseUptimes.length
    : null;

  const fightMs = (result.raw.RDURATION || 0) * 1000;
  const presenceState = inferredPresenceState(result);
  // Reuse the inferred state for Blood Presence too, so Presence metrics are
  // mutually exclusive and are not distorted by a missing pre-pull APPLIED.
  const originalBloodIntervals = result.debugIntervalsById && result.debugIntervalsById[SPELL.BLOOD_PRESENCE];
  if (!result.debugIntervalsById) result.debugIntervalsById = {};
  result.debugIntervalsById[SPELL.BLOOD_PRESENCE] = presenceState.intervals[SPELL.BLOOD_PRESENCE];
  const bloodPresenceOutsideGargoyleMs = uptimeMsExcluding(result, SPELL.BLOOD_PRESENCE, gargoyleWindows);
  if (originalBloodIntervals) result.debugIntervalsById[SPELL.BLOOD_PRESENCE] = originalBloodIntervals;
  else delete result.debugIntervalsById[SPELL.BLOOD_PRESENCE];
  const nonGargoyleMs = Math.max(0, fightMs - gargoyleWindows.reduce((s, [a, b]) => s + (b - a), 0));

  // Unholy Score (0-100). Only use metrics that this tracker can measure
  // reliably. Do not penalize unavailable RP/ghoul-state data or optional
  // raid/gear procs that a character may not have equipped.
  const categories = [];
  const rotationParts = [];
  const normalizeUptime = (value, target = 90) => value == null ? null : Math.max(0, Math.min(100, (value / target) * 100));
  [
    diseaseAvgPct,
    uptimePctFor(result, SPELL.DESOLATION),
    uptimePctFor(result, '1'),
  ].forEach((value) => {
    const normalized = normalizeUptime(value);
    if (normalized != null) rotationParts.push(normalized);
  });
  if (rotationParts.length) {
    categories.push({
      key: 'rotation',
      label: 'Rotation',
      score: rotationParts.reduce((a, b) => a + b, 0) / rotationParts.length,
    });
  }

  if (gargoyle && gargoyle.windows.length) {
    const usageScore = Math.min(100, pct(gargoyle.uses, gargoyle.possible));
    const snapshotScores = gargoyle.windows.map((w) => {
      // Core, trackable Gargoyle snapshot requirements. Bloodlust/trinkets/
      // Skyflare/Black Magic are optional, so their absence must not lower score.
      const checks = [w.unholyPresence, w.hyperspeed, w.speedPotion, w.unholyMightT9, w.fallenCrusader, w.sigilOfVirulence];
      return pct(checks.filter(Boolean).length, checks.length);
    });
    const snapshotScore = snapshotScores.reduce((a, b) => a + b, 0) / snapshotScores.length;
    categories.push({ key: 'gargoyle', label: 'Gargoyle', score: (usageScore + snapshotScore) / 2 });
  }

  const consumables = analyzeConsumables(result);
  if (consumables) {
    const ratios = [
      pct(Math.min(consumables.hyperspeed.used, consumables.hyperspeed.possible), consumables.hyperspeed.possible),
      pct(Math.min(consumables.globalThermalSapperCharge.used, consumables.globalThermalSapperCharge.possible), consumables.globalThermalSapperCharge.possible),
      pct(Math.min(consumables.saroniteBomb.used, consumables.saroniteBomb.possible), consumables.saroniteBomb.possible),
      consumables.flaskUsed ? 100 : 0,
    ];
    categories.push({ key: 'misc', label: 'Miscellaneous', score: ratios.reduce((a, b) => a + b, 0) / ratios.length });
  }

  const score = categories.length
    ? Math.round(categories.reduce((sum, c) => sum + c.score, 0) / categories.length)
    : null;

  return {
    score,
    categories,
    presenceState,
    diseaseAvgPct,
    diseaseUptimes,
    deathAndDecayPct: deathAndDecayUptimePct(result),
    desolationPct: uptimePctFor(result, SPELL.DESOLATION),
    boneShieldPct: boneShieldUptimePct(result),
    unholyMightT9Pct: uptimePctFor(result, SPELL.UNHOLY_MIGHT_T9),
    fallenCrusaderPct: uptimePctFor(result, SPELL.FALLEN_CRUSADER),
    sigilOfVirulencePct: uptimePctFor(result, SPELL.SIGIL_OF_VIRULENCE),
    bloodPresenceOutsideGargoylePct: nonGargoyleMs > 0 ? Math.min(100, (bloodPresenceOutsideGargoyleMs / nonGargoyleMs) * 100) : null,
    bloodTapCount: castsOf(result, SPELL.BLOOD_TAP).length,
    bloodTapPossible: Math.max(1, Math.floor(fightMs / BLOOD_TAP_COOLDOWN_MS) + 1),
    meleePct: uptimePctFor(result, '1'),
    ghoulName: findGhoulName(result),
    gargoyle,
    armyOfTheDead: analyzeArmyOfTheDead(result),
    consumables,
  };
}
