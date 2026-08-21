// Boss-aware analysis for Fire Mage. Matching is done by spell ID so logs
// remain valid regardless of the game-client language.

const SPELL = {
  IGNITE: '12654',
  HOT_STREAK: '48108',
  PYROBLAST: '42891',
  LIVING_BOMB: '55360',
  FLAMESTRIKE_R9: '42926',
  FLAMESTRIKE_R8: '42925',
  COMBUSTION: '11129',
  MIRROR_IMAGE: '55342',
  STAGGERED_DAZE: '66758',
  HYPERSPEED_ACCELERATION: '54758',
  GLOBAL_THERMAL_SAPPER_CHARGE: '56488',
  SARONITE_BOMB: '56350',
  FLASK_OF_THE_FROST_WYRM: '53755',
  INVISIBILITY_IDS: ['66', '32612'],
};

const ICEHOWL_DAZE_DELAY_MS = 40000;
const ICEHOWL_DAZE_WINDOW_MS = 15000;
const PREPOT_WINDOW_MS = 60000;
const GLOBAL_THERMAL_SAPPER_COOLDOWN_MS = 300000;
const NORTHREND_BEASTS_POTIONS_EXPECTED = 3;

const PROC_CATALOG = {
  // Potions / engineering
  '53909': { name: 'Wild Magic', category: 'Potion' },
  '53908': { name: 'Speed', category: 'Potion' },
  '54758': { name: 'Hyperspeed Accelerators', category: 'Engineering' },
  // Tailoring / weapon enchants
  '55637': { name: 'Lightweave', category: null },
  '59626': { name: 'Black Magic', category: null },
  // Racials. Only the aura actually present in the log is displayed.
  '26297': { name: 'Berserking', category: 'Racial' },
  '20572': { name: 'Blood Fury', category: 'Racial' },
  '33697': { name: 'Blood Fury', category: 'Racial' },
  '33702': { name: 'Blood Fury', category: 'Racial' },
  '28730': { name: 'Arcane Torrent', category: 'Racial' },
  // Common WotLK caster trinket procs. This list is intentionally based on
  // the aura received, not on a hard-coded trinket slot for the character.
  '60494': { name: 'Dying Curse', category: 'Trinket' },
  '60492': { name: 'Embrace of the Spider', category: 'Trinket' },
  '60064': { name: 'Now is the Time!', category: 'Trinket' },
  '60486': { name: 'Illustration of the Dragon Soul', category: 'Trinket' },
  '65024': { name: 'Abyssal Rune', category: 'Trinket' },
  '64713': { name: 'Flare of the Heavens', category: 'Trinket' },
  '64707': { name: 'Scale of Fates', category: 'Trinket' },
  '65019': { name: 'Eye of the Broodmother', category: 'Trinket' },
  '65004': { name: 'Elemental Focus Stone', category: 'Trinket' },
  '67669': { name: 'Talisman of Resurgence', category: 'Trinket' },
  '71564': { name: 'Nevermelting Ice Crystal', category: 'Trinket' },
  '71572': { name: "Muradin's Spyglass", category: 'Trinket' },
  '71605': { name: "Phylactery of the Nameless Lich", category: 'Trinket' },
};

const TRINKET_NAME_PATTERN = /dying curse|embrace of the spider|now is the time|illustration of the dragon soul|abyssal rune|flare of the heavens|flame of the heavens|scale of fates|eye of the broodmother|elemental focus stone|talisman of resurgence|nevermelting ice crystal|muradin|phylactery|reign of the dead|reign of the unliving/i;

function rawData(result) {
  return (result.raw && (result.raw.DATA || result.raw.data)) || {};
}

function spellInfo(result) {
  return (result.raw && (result.raw.SPELLS || result.raw.spells)) || {};
}

function eventsOf(result, spellId) {
  const events = rawData(result)[String(spellId)];
  return Array.isArray(events) ? events : [];
}

function displayName(result, spellId) {
  const info = spellInfo(result)[String(spellId)];
  return (info && (info.name || info.NAME)) || `Spell #${spellId}`;
}

function normalizedSpellName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function isCombustionName(value) {
  return normalizedSpellName(value).includes('combustion');
}

function combustionSpellIds(result) {
  const ids = new Set([SPELL.COMBUSTION]);
  Object.keys(spellInfo(result)).forEach((id) => {
    if (isCombustionName(displayName(result, id))) ids.add(String(id));
  });
  Object.keys(rawData(result)).forEach((id) => {
    if (isCombustionName(displayName(result, id))) ids.add(String(id));
  });
  (result.timeline || []).forEach((cast) => {
    if (isCombustionName(cast.name) && cast.id != null) ids.add(String(cast.id));
  });
  return [...ids];
}

function auraSeries(result, spellId, targetMatcher = null) {
  const selfName = result.raw && result.raw.NAME;
  const fightMs = Number(result.raw && result.raw.RDURATION || 0) * 1000;
  const events = eventsOf(result, spellId)
    .filter((ev) => ['SPELL_AURA_APPLIED', 'SPELL_AURA_REFRESH', 'SPELL_AURA_REMOVED'].includes(ev[1]))
    // UwU Logs is not consistent about self-buff targets: some events use
    // target=self, while Combustion can arrive with source=self and target=nil.
    .filter((ev) => targetMatcher
      ? targetMatcher(String(ev[3] || ''))
      : (!selfName || ev[3] === selfName || ev[2] === selfName))
    .sort((a, b) => Number(a[0]) - Number(b[0]));
  const intervals = [];
  const activations = [];
  let start = null;
  events.forEach((ev) => {
    const ms = Number(ev[0]) || 0;
    if (ev[1] === 'SPELL_AURA_APPLIED' || ev[1] === 'SPELL_AURA_REFRESH') {
      activations.push(ms);
      if (start === null) start = ms;
    } else if (start !== null) {
      intervals.push([start, ms]);
      start = null;
    }
  });
  if (start !== null) intervals.push([start, fightMs || (start + 15000)]);
  return { intervals, activations };
}

function castsOf(result, spellId) {
  return (result.timeline || [])
    .filter((cast) => String(cast.id) === String(spellId))
    .sort((a, b) => a.ms - b.ms);
}

function allSelfEvents(result) {
  const selfName = result.raw && result.raw.NAME;
  return Object.values(rawData(result))
    .flatMap((events) => Array.isArray(events) ? events : [])
    .filter((ev) => !selfName || ev[2] === selfName)
    .sort((a, b) => Number(a[0]) - Number(b[0]));
}

function allEventsWithSpell(result) {
  return Object.entries(rawData(result)).flatMap(([id, events]) => {
    if (!Array.isArray(events)) return [];
    return events.map((ev) => ({ id: String(id), name: displayName(result, id), ev }));
  }).sort((a, b) => Number(a.ev[0]) - Number(b.ev[0]));
}

function dedupeTimes(times, toleranceMs = 750) {
  const sorted = [...times].map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.filter((ms, index) => index === 0 || ms - sorted[index - 1] > toleranceMs);
}

function spellIdsMatching(result, knownIds, nameMatcher) {
  const ids = new Set(knownIds.map(String));
  Object.keys(spellInfo(result)).forEach((id) => {
    if (nameMatcher(displayName(result, id))) ids.add(String(id));
  });
  Object.keys(rawData(result)).forEach((id) => {
    if (nameMatcher(displayName(result, id))) ids.add(String(id));
  });
  (result.timeline || []).forEach((cast) => {
    if (cast.id != null && nameMatcher(String(cast.name || ''))) ids.add(String(cast.id));
  });
  return [...ids];
}

function activationTimes(result, spellIds, nameMatcher = () => false) {
  const idSet = new Set(spellIds.map(String));
  const selfName = result.raw && result.raw.NAME;
  const timelineTimes = (result.timeline || [])
    .filter((cast) => idSet.has(String(cast.id)) || nameMatcher(String(cast.name || '')))
    .map((cast) => Number(cast.ms));
  const rawTimes = [...idSet].flatMap((id) => eventsOf(result, id)
    .filter((ev) => ['SPELL_CAST_SUCCESS', 'SPELL_CAST_START', 'SPELL_AURA_APPLIED', 'SPELL_AURA_REFRESH'].includes(ev[1]))
    .filter((ev) => !selfName || ev[2] === selfName || ev[3] === selfName)
    .map((ev) => Number(ev[0])));
  return dedupeTimes([...timelineTimes, ...rawTimes]);
}

function procDefinition(result, spellId) {
  const known = PROC_CATALOG[String(spellId)];
  if (known) {
    const detectedName = displayName(result, spellId);
    const name = /^Spell #/i.test(detectedName) ? known.name : detectedName;
    return { id: String(spellId), ...known, name };
  }
  const name = displayName(result, spellId);
  if (TRINKET_NAME_PATTERN.test(name)) return { id: String(spellId), name, category: 'Trinket' };
  if (/wild magic|speed potion/i.test(name)) return { id: String(spellId), name, category: 'Potion' };
  if (/hyperspeed/i.test(name)) return { id: String(spellId), name: 'Hyperspeed Accelerators', category: 'Engineering' };
  if (/berserking|blood fury|arcane torrent/i.test(name)) return { id: String(spellId), name, category: 'Racial' };
  if (/lightweave|black magic/i.test(name)) return { id: String(spellId), name, category: null };
  return null;
}

function relevantProcSeries(result) {
  return Object.keys(rawData(result)).map((id) => {
    const definition = procDefinition(result, id);
    if (!definition) return null;
    const series = auraSeries(result, id);
    return series.intervals.length || series.activations.length ? { ...definition, ...series } : null;
  }).filter(Boolean);
}

function procsForWindow(result, start, end) {
  const active = [];
  const triggered = [];
  relevantProcSeries(result).forEach((proc) => {
    if (proc.intervals.some(([s, e]) => start >= s && start <= e)) active.push(proc);
    else if (proc.activations.some((ms) => ms > start && ms <= end)) triggered.push(proc);
  });
  return { active, triggered };
}

function combustionWindows(result) {
  const spellIds = combustionSpellIds(result);
  const auraSeriesById = spellIds.map((id) => auraSeries(result, id));
  // Read the same entries shown by Timeline. Name matching is intentional:
  // some UwU Logs servers expose Combustion with a non-standard spell/aura ID.
  const castStarts = (result.timeline || [])
    .filter((cast) => spellIds.includes(String(cast.id)) || isCombustionName(cast.name))
    .map((cast) => Number(cast.ms));
  const selfName = result.raw && result.raw.NAME;
  const rawStarts = spellIds.flatMap((id) => eventsOf(result, id)
    .filter((ev) => ['SPELL_CAST_SUCCESS', 'SPELL_CAST_START', 'SPELL_AURA_APPLIED', 'SPELL_AURA_REFRESH'].includes(ev[1]))
    .filter((ev) => !selfName || ev[2] === selfName || ev[3] === selfName)
    .map((ev) => Number(ev[0])));
  const activations = auraSeriesById.flatMap((series) => series.activations);
  const intervals = auraSeriesById.flatMap((series) => series.intervals);
  const starts = dedupeTimes([...activations, ...castStarts, ...rawStarts]);
  return starts.map((start) => {
    const interval = intervals.find(([s, e]) => start >= s && start <= e) || [start, start + 15000];
    return { start, end: interval[1], ...procsForWindow(result, start, interval[1]) };
  });
}

function firstTargetTime(result, pattern) {
  const timelineTimes = (result.timeline || [])
    .filter((cast) => pattern.test(String(cast.target || '')))
    .map((cast) => Number(cast.ms));
  const selfName = result.raw && result.raw.NAME;
  const rawTimes = allEventsWithSpell(result)
    .filter(({ ev }) => (!selfName || ev[2] === selfName) && pattern.test(String(ev[3] || '')))
    .map(({ ev }) => Number(ev[0]));
  const times = [...timelineTimes, ...rawTimes].filter((ms) => Number.isFinite(ms) && ms >= 0);
  return times.length ? Math.min(...times) : null;
}

function gormokEndTime(result) {
  const explicitDeaths = allEventsWithSpell(result)
    .filter(({ ev }) => ev[1] === 'UNIT_DIED' && /gormok/i.test(String(ev[3] || '')))
    .map(({ ev }) => Number(ev[0]))
    .filter(Number.isFinite);
  if (explicitDeaths.length) return Math.max(...explicitDeaths);

  const selfName = result.raw && result.raw.NAME;
  const timelineTimes = (result.timeline || [])
    .filter((cast) => /gormok/i.test(String(cast.target || '')))
    .map((cast) => Number(cast.ms));
  const rawTimes = allEventsWithSpell(result)
    .filter(({ ev }) => (!selfName || ev[2] === selfName) && /gormok/i.test(String(ev[3] || '')))
    .map(({ ev }) => Number(ev[0]));
  const times = [...timelineTimes, ...rawTimes].filter(Number.isFinite);
  return times.length ? Math.max(...times) : null;
}

function priorityPotions(result, gormokEndMs, icehowlFirstTargetMs, daze) {
  const potionActivations = relevantProcSeries(result)
    .filter((proc) => proc.category === 'Potion')
    .flatMap((proc) => proc.activations.map((ms) => ({ ms, id: proc.id, name: proc.name })))
    .sort((a, b) => a.ms - b.ms)
    .filter((use, index, uses) => index === 0 || use.id !== uses[index - 1].id || use.ms - uses[index - 1].ms > 750);
  const prepullCandidates = potionActivations.filter((use) => use.ms >= -15000 && use.ms <= 0);
  const prepull = prepullCandidates.length ? prepullCandidates[prepullCandidates.length - 1] : null;
  const afterGormok = gormokEndMs == null || icehowlFirstTargetMs == null
    ? null
    : potionActivations.find((use) => use.ms >= gormokEndMs && use.ms < icehowlFirstTargetMs) || null;
  const staggeredDaze = !daze
    ? null
    : potionActivations.find((use) => use.ms >= daze[0] && use.ms <= daze[1]) || null;
  return {
    usedPriorityWindows: Number(Boolean(prepull)) + Number(Boolean(afterGormok)) + Number(Boolean(staggeredDaze)),
    possiblePriorityWindows: 3,
    prepull,
    afterGormok,
    staggeredDaze,
    gormokEndMs,
  };
}

function miscellaneous(result) {
  const fightMs = Number(result.raw && result.raw.RDURATION || 0) * 1000;
  const oneMinutePossible = Math.max(1, Math.floor(fightMs / 60000) + 1);
  const sapperPossible = Math.max(1, Math.floor(fightMs / GLOBAL_THERMAL_SAPPER_COOLDOWN_MS) + 1);

  const hyperspeedName = (name) => /hyperspeed|hipervelocidad/i.test(name);
  const sapperName = (name) => /global thermal sapper|carga termica global|carga t[eé]rmica global/i.test(name);
  const saroniteName = (name) => /saronite bomb|bomba de saronita/i.test(name);
  const flaskName = (name) => /flask of the frost wyrm|frasco de la vermis de escarcha/i.test(name);

  const hyperspeedIds = spellIdsMatching(result, [SPELL.HYPERSPEED_ACCELERATION], hyperspeedName);
  const sapperIds = spellIdsMatching(result, [SPELL.GLOBAL_THERMAL_SAPPER_CHARGE], sapperName);
  const saroniteIds = spellIdsMatching(result, [SPELL.SARONITE_BOMB], saroniteName);
  const flaskIds = spellIdsMatching(result, [SPELL.FLASK_OF_THE_FROST_WYRM], flaskName);

  const potionUses = relevantProcSeries(result)
    .filter((proc) => proc.category === 'Potion')
    .flatMap((proc) => proc.activations)
    .filter(Number.isFinite);
  const uniquePotionUses = dedupeTimes(potionUses);
  const firstPotionMs = uniquePotionUses.length ? uniquePotionUses[0] : null;

  const selfName = result.raw && result.raw.NAME;
  const flaskUsed = flaskIds.some((id) => eventsOf(result, id).some((ev) => {
    const isAuraEvidence = ['SPELL_AURA_APPLIED', 'SPELL_AURA_REFRESH', 'SPELL_AURA_REMOVED'].includes(ev[1]);
    return isAuraEvidence && (!selfName || ev[2] === selfName || ev[3] === selfName);
  })) || flaskIds.some((id) => {
    const intervals = result.debugIntervalsById && result.debugIntervalsById[String(id)];
    return Array.isArray(intervals) && intervals.length > 0;
  });

  return {
    hyperspeed: {
      used: activationTimes(result, hyperspeedIds, hyperspeedName).length,
      possible: oneMinutePossible,
    },
    globalThermalSapperCharge: {
      used: activationTimes(result, sapperIds, sapperName).length,
      possible: sapperPossible,
    },
    saroniteBomb: {
      used: activationTimes(result, saroniteIds, saroniteName).length,
      possible: oneMinutePossible,
    },
    flaskUsed,
    potionUses: uniquePotionUses,
    potionsPossible: NORTHREND_BEASTS_POTIONS_EXPECTED,
    prepotOk: firstPotionMs == null ? false : firstPotionMs >= -PREPOT_WINDOW_MS && firstPotionMs <= 0,
  };
}

function invisibilityBetweenWormsAndIcehowl(result, icehowlFirstTargetMs) {
  const WORM_PATTERNS = [/acidmaw|ácido/i, /dreadscale|pavor/i];
  const allEvents = allEventsWithSpell(result);
  const explicitExitFor = (pattern) => allEvents
    .filter(({ name, ev }) => {
      const target = String(ev[3] || '');
      const died = ev[1] === 'UNIT_DIED';
      const submerged = /submerge|burrow|sumerg|ocult/i.test(name)
        && ['SPELL_CAST_SUCCESS', 'SPELL_AURA_APPLIED', 'SPELL_AURA_REFRESH'].includes(ev[1]);
      return pattern.test(target) && (died || submerged);
    })
    .map(({ ev }) => Number(ev[0]))
    .filter((ms) => Number.isFinite(ms) && (icehowlFirstTargetMs == null || ms <= icehowlFirstTargetMs));
  const lastSeenFor = (pattern) => allEvents
    .filter(({ ev }) => pattern.test(String(ev[3] || '')))
    .map(({ ev }) => Number(ev[0]))
    .filter((ms) => Number.isFinite(ms) && (icehowlFirstTargetMs == null || ms <= icehowlFirstTargetMs));
  const exits = WORM_PATTERNS.map((pattern) => {
    const explicit = explicitExitFor(pattern);
    if (explicit.length) return Math.max(...explicit);
    const lastSeen = lastSeenFor(pattern);
    return lastSeen.length ? Math.max(...lastSeen) : null;
  }).filter((ms) => ms != null);
  const phaseStart = exits.length ? Math.max(...exits) : null;

  const timelineCasts = SPELL.INVISIBILITY_IDS.flatMap((id) => castsOf(result, id).map((cast) => cast.ms));
  const rawCasts = SPELL.INVISIBILITY_IDS.flatMap((id) => eventsOf(result, id)
    .filter((ev) => ['SPELL_CAST_SUCCESS', 'SPELL_CAST_START', 'SPELL_AURA_APPLIED'].includes(ev[1]))
    .filter((ev) => !result.raw.NAME || ev[2] === result.raw.NAME || ev[3] === result.raw.NAME)
    .map((ev) => Number(ev[0])));
  const castTimes = dedupeTimes([...timelineCasts, ...rawCasts]);
  const validTimes = phaseStart == null || icehowlFirstTargetMs == null
    ? []
    : castTimes.filter((ms) => ms >= phaseStart && ms < icehowlFirstTargetMs);
  return {
    used: validTimes.length > 0,
    count: validTimes.length,
    times: validTimes,
    phaseStart,
    phaseEnd: icehowlFirstTargetMs,
  };
}

function livingBombCoverage(result) {
  const targets = castsOf(result, SPELL.LIVING_BOMB).map((cast) => String(cast.target || ''));
  const has = (pattern) => targets.some((target) => pattern.test(target));
  const coverage = {
    gormok: has(/gormok/i),
    snobolds: has(/snobold|snowbold/i),
    acidmaw: has(/acidmaw|ácido/i),
    dreadscale: has(/dreadscale|pavor/i),
    icehowl: has(/icehowl|aullaneve/i),
  };
  return { targets, coverage, complete: Object.values(coverage).every(Boolean) };
}

function flamestrikeOnStackedSnobolds(result) {
  const rank9 = castsOf(result, SPELL.FLAMESTRIKE_R9);
  const rank8 = castsOf(result, SPELL.FLAMESTRIKE_R8);
  const all = [...rank9.map((cast) => ({ ...cast, rank: 9 })), ...rank8.map((cast) => ({ ...cast, rank: 8 }))]
    .sort((a, b) => a.ms - b.ms);
  const events = allSelfEvents(result);
  const gormokDeath = events
    .filter((ev) => ev[1] === 'UNIT_DIED' && /gormok/i.test(String(ev[3] || '')))
    .map((ev) => Number(ev[0]));
  const gormokLast = events.filter((ev) => /gormok/i.test(String(ev[3] || ''))).map((ev) => Number(ev[0]));
  const wormsFirst = events
    .filter((ev) => /acidmaw|dreadscale|jormungar|ácido|pavor/i.test(String(ev[3] || '')))
    .map((ev) => Number(ev[0]));
  const phaseStart = gormokDeath.length ? Math.max(...gormokDeath) : (gormokLast.length ? Math.max(...gormokLast) : null);
  const phaseEnd = wormsFirst.length ? Math.min(...wormsFirst) : null;
  let selected = [];
  if (phaseStart != null) {
    selected = all.filter((cast) => cast.ms >= phaseStart && (phaseEnd == null || cast.ms <= phaseEnd));
  }
  if (!selected.length) selected = all.filter((cast) => /snobold|snowbold/i.test(String(cast.target || '')));
  return {
    used: selected.length > 0,
    rank9: selected.filter((cast) => cast.rank === 9).length,
    rank8: selected.filter((cast) => cast.rank === 8).length,
  };
}

function igniteDamage(result) {
  const breakdown = result.damageBreakdown || {};
  const row = (breakdown.entries || []).find((entry) => String(entry.spellId) === SPELL.IGNITE);
  const damage = row ? Number(row.damage) || 0 : 0;
  const totalDamage = Number(breakdown.totalDamage) || 0;
  return { damage, sharePct: totalDamage > 0 ? (damage / totalDamage) * 100 : null };
}

function hotStreakProcWindows(result) {
  const selfName = result.raw && result.raw.NAME;
  const fightMs = Number(result.raw && result.raw.RDURATION || 0) * 1000;
  const events = eventsOf(result, SPELL.HOT_STREAK)
    .filter((ev) => ['SPELL_AURA_APPLIED', 'SPELL_AURA_REFRESH', 'SPELL_AURA_REMOVED'].includes(ev[1]))
    .filter((ev) => !selfName || ev[2] === selfName || ev[3] === selfName)
    .sort((a, b) => Number(a[0]) - Number(b[0]));
  const windows = [];
  let active = null;
  events.forEach((ev) => {
    const ms = Number(ev[0]) || 0;
    if (ev[1] === 'SPELL_AURA_APPLIED' || ev[1] === 'SPELL_AURA_REFRESH') {
      // A refresh is a new proc. If the previous Hot Streak was still active,
      // close it here so it can be reported as overwritten when no Pyroblast
      // consumed it first.
      if (active) windows.push({ ...active, end: ms, endReason: 'refreshed' });
      active = { start: ms };
    } else if (active) {
      windows.push({ ...active, end: ms, endReason: 'removed' });
      active = null;
    }
  });
  if (active) windows.push({
    ...active,
    end: fightMs || active.start + 10000,
    endReason: 'fight-ended',
  });
  return windows;
}

function rawCastTimes(result, spellId) {
  const selfName = result.raw && result.raw.NAME;
  const events = eventsOf(result, spellId).filter((ev) => !selfName || ev[2] === selfName);
  const hasSuccess = events.some((ev) => ev[1] === 'SPELL_CAST_SUCCESS');
  const flag = hasSuccess ? 'SPELL_CAST_SUCCESS' : 'SPELL_CAST_START';
  return events.filter((ev) => ev[1] === flag).map((ev) => Number(ev[0]));
}

function hotStreak(result) {
  const windows = hotStreakProcWindows(result);
  const pyroblastTimes = dedupeTimes([
    ...castsOf(result, SPELL.PYROBLAST).map((cast) => cast.ms),
    ...rawCastTimes(result, SPELL.PYROBLAST),
  ]);
  const usedPyroblasts = new Set();
  const procs = windows.map((window, index) => {
    const pyroIndex = pyroblastTimes.findIndex((ms, candidateIndex) => (
      !usedPyroblasts.has(candidateIndex) && ms >= window.start && ms <= window.end
    ));
    const consumed = pyroIndex >= 0;
    if (consumed) usedPyroblasts.add(pyroIndex);
    const pyroblastMs = consumed ? pyroblastTimes[pyroIndex] : null;
    return {
      index: index + 1,
      start: window.start,
      end: window.end,
      endReason: window.endReason,
      consumed,
      pyroblastMs,
      reactionMs: consumed ? Math.max(0, pyroblastMs - window.start) : null,
    };
  });
  const reactionTimes = procs.filter((proc) => proc.consumed).map((proc) => proc.reactionMs);
  const consumed = reactionTimes.length;
  const total = procs.length;
  return {
    total,
    consumed,
    missed: Math.max(0, total - consumed),
    efficiencyPct: total > 0 ? (consumed / total) * 100 : 0,
    averageReactionMs: reactionTimes.length
      ? reactionTimes.reduce((sum, ms) => sum + ms, 0) / reactionTimes.length
      : null,
    fastestReactionMs: reactionTimes.length ? Math.min(...reactionTimes) : null,
    slowestReactionMs: reactionTimes.length ? Math.max(...reactionTimes) : null,
    procs,
  };
}

function isNorthrendBeasts(bossName) {
  return /northrend beasts|beasts of northrend|bestias de nortrend|gormok|icehowl|aullaneve/i.test(String(bossName || ''));
}

export function isFireMage(result) {
  if (!result || String(result.raw && result.raw.CLASS || '').toLowerCase() !== 'mage') return false;
  const ids = new Set((result.spellCounts || []).map((spell) => String(spell.id)));
  const hasKnownFireSpell = [SPELL.IGNITE, SPELL.HOT_STREAK, SPELL.LIVING_BOMB, SPELL.COMBUSTION].some((id) => ids.has(id));
  const hasNamedCombustion = (result.timeline || []).some((cast) => isCombustionName(cast.name))
    || Object.keys(spellInfo(result)).some((id) => isCombustionName(displayName(result, id)));
  return hasKnownFireSpell || hasNamedCombustion;
}

export function computeFireMageAnalysis(result, bossName) {
  if (!isFireMage(result) || !isNorthrendBeasts(bossName)) return null;
  const combustions = combustionWindows(result);
  const icehowlFirstTargetMs = firstTargetTime(result, /icehowl|aullaneve/i);
  const gormokEndMs = gormokEndTime(result);
  // Encounter-specific rule requested for this server: Staggered Daze is
  // inferred 40s after Icehowl first appears as this player's target.
  const daze = icehowlFirstTargetMs == null
    ? null
    : [icehowlFirstTargetMs + ICEHOWL_DAZE_DELAY_MS, icehowlFirstTargetMs + ICEHOWL_DAZE_DELAY_MS + ICEHOWL_DAZE_WINDOW_MS];
  const pullUse = combustions.find((window) => window.start >= 0 && window.start <= 15000) || null;
  const dazeUse = daze ? combustions.find((window) => window.start >= daze[0] && window.start <= daze[1]) || null : null;
  const fightMs = Number(result.raw && result.raw.RDURATION || 0) * 1000;
  const mirrorImageUsed = castsOf(result, SPELL.MIRROR_IMAGE).length;
  const mirrorImagePossible = Math.max(1, Math.floor(fightMs / 180000) + 1);
  return {
    encounter: 'Northrend Beasts',
    ignite: igniteDamage(result),
    hotStreak: hotStreak(result),
    livingBomb: livingBombCoverage(result),
    flamestrike: flamestrikeOnStackedSnobolds(result),
    invisibility: invisibilityBetweenWormsAndIcehowl(result, icehowlFirstTargetMs),
    potions: priorityPotions(result, gormokEndMs, icehowlFirstTargetMs, daze),
    miscellaneous: miscellaneous(result),
    combustion: {
      usedPriorityWindows: Number(Boolean(pullUse)) + Number(Boolean(dazeUse)),
      possiblePriorityWindows: 2,
      pull: pullUse,
      daze: dazeUse,
      dazeStart: daze ? daze[0] : null,
      dazeDurationSec: ICEHOWL_DAZE_WINDOW_MS / 1000,
      icehowlFirstTargetMs,
    },
    mirrorImage: { used: mirrorImageUsed, possible: mirrorImagePossible },
  };
}
