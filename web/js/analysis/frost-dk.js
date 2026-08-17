// Análisis específico para Death Knight - Frost.
//
// Depende únicamente de `result`, el objeto que ya arma
// `summarizeDkTimeline()` en app.js (result.raw, result.timeline,
// result.uptimes, result.spellCounts, result.debugIntervalsById). No
// vuelve a leer el DATA crudo de report_casts — reusa lo que ese parseo ya
// calculó, para no tener dos lugares leyendo el mismo evento crudo con
// criterios distintos.
//
// MATCHING POR SPELL ID, NO POR NOMBRE — IMPORTANTE:
// uwu-logs.xyz devuelve el nombre de cada hechizo tal como lo capturó el
// addon del jugador que subió el log, en SU idioma de cliente (confirmado:
// logs de personajes con cliente en español devuelven nombres en español,
// ej. "Fiebre de Escarcha" en vez de "Frost Fever"). Comparar por texto en
// inglés rompía el análisis para esos logs. El spell ID en cambio es fijo
// sin importar el idioma, así que todo el matching de acá es por ID.
//
// Los IDs de abajo se sacaron de datos REALES de report_casts (no de una
// wiki externa) — confirmados contra un log en inglés del propio
// servidor, para evitar el riesgo de un ID de rango/versión distinto. La
// única excepción marcada es Flask of Endless Rage, sacado de wowhead/
// wotlkdb (no apareció en el log de prueba porque ese personaje no lo
// tenía puesto) — si en algún momento se confirma o corrige contra datos
// reales, actualizar el comentario.
//
// LIMITACIÓN CONOCIDA (ver docs/API.md): el proxy/API nunca confirmó que
// report_casts exponga el estado de Runic Power ni de las Runas por
// evento — solo aplicaciones/remociones de auras y casteos. Por eso ACÁ
// TAMPOCO se calcula "Runic Power Capping" (categoría del puntaje) ni el
// drift de runas de Obliterate (sección Speed): se muestran marcados como
// pendientes en vez de inventar un número. El puntaje se reparte solo
// entre las categorías que sí se pueden calcular hoy (Disease Uptime,
// Cooldown Alignment). Si en algún momento se confirma ese campo, esas dos
// métricas son las próximas a sumar.

const SPELL = {
  FROST_FEVER: '55095',
  BLOOD_PLAGUE: '55078',
  KILLING_MACHINE: '51124',
  // El talento se llama "Rime", pero el BUFF que realmente aparece en el
  // combat log cuando procea se llama "Freezing Fog" — confirmado con
  // datos reales (no aparece ningún "Rime" en el mapa id->nombre de un
  // log real, sí "Freezing Fog": 59052).
  FREEZING_FOG_RIME_PROC: '59052',
  UNBREAKABLE_ARMOR: '51271',
  EMPOWER_RUNE_WEAPON: '47568',
  OBLITERATE: '51425',
  FROST_STRIKE: '55268',
  HOWLING_BLAST: '51411',
  // Buff de Potion of Speed — confirmado contra datos reales (nombre real: "Speed").
  SPEED_POTION: '53908',
  HYPERSPEED_ACCELERATION: '54758',
  SARONITE_BOMB: '56350',
  GLOBAL_THERMAL_SAPPER_CHARGE: '56488',
  // Aura real observada en UwU Logs. 53903 es la receta, no el buff.
  FLASK_OF_ENDLESS_RAGE: '53760',
  INDESTRUCTIBLE_POTION: '53720',
};

const DISEASE_UPTIME_TARGET = 95; // % — debajo de esto la categoría empieza a perder puntos

const PROC_DEFS = [
  // Howling Blast también consume Killing Machine en este servidor (no
  // solo Obliterate/Frost Strike) — cuando coincide con Rime activo a la
  // vez, es el combo grande: tiro gratis + crítico garantizado.
  { buffId: SPELL.KILLING_MACHINE, spenderIds: [SPELL.OBLITERATE, SPELL.FROST_STRIKE, SPELL.HOWLING_BLAST], label: 'Killing Machine' },
  { buffId: SPELL.FREEZING_FOG_RIME_PROC, spenderIds: [SPELL.HOWLING_BLAST], label: 'Rime' },
];

// ERW casteado hasta 3s antes de que arranque la ventana de UA cuenta como
// el mismo "burst" de cooldowns (orden de casteo puede variar por macro).
const ERW_LOOKBACK_MS = 3000;
// Benchmark de Obliterates dentro de una ventana de 20s de UA: 6 con ERW
// (más runas/haste disponibles), 5 sin. Es el mismo número que usa la
// comunidad de Frost DK WotLK como referencia — no viene de un tooltip,
// así que tratalo como una vara de medir aproximada, no una regla exacta.
const OBLITERATE_TARGET_WITH_ERW = 6;
const OBLITERATE_TARGET_NO_ERW = 5;

const PREPOT_WINDOW_MS = 60000; // una pot casteada hasta 60s antes del pull cuenta como prepot
const GLOBAL_THERMAL_SAPPER_COOLDOWN_MS = 300000;
export const MAX_POTIONS_EXPECTED = 2; // prepot + 1 durante el intento (comparten cooldown)

// Detecta Frost por presencia de spell IDs (no nombres) — inmune al
// idioma del log. Un DK con Killing Machine, el proc de Rime, o
// Unbreakable Armor en sus datos es Frost, sin importar cómo se llamen
// esos hechizos en el idioma en que se grabó el log.
export function isFrostDk(result) {
  if (!result || (result.raw.CLASS || '').toLowerCase() !== 'death-knight') return false;
  const ids = new Set(result.spellCounts.map((s) => String(s.id)));
  result.uptimes.forEach((u) => ids.add(String(u.id)));
  return ids.has(SPELL.KILLING_MACHINE) || ids.has(SPELL.FREEZING_FOG_RIME_PROC) || ids.has(SPELL.UNBREAKABLE_ARMOR);
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

// Nombre real (en el idioma del log) para mostrar en el panel — el
// matching es por ID, pero al usuario le mostramos el texto tal cual lo
// devuelve el sitio.
function displayNameFor(result, spellId) {
  const fromUptime = result.uptimes.find((u) => String(u.id) === spellId);
  if (fromUptime) return fromUptime.name;
  const fromCount = result.spellCounts.find((s) => String(s.id) === spellId);
  return fromCount ? fromCount.name : `Spell #${spellId}`;
}

function analyzeProc(result, def) {
  const intervals = intervalsOf(result, def.buffId);
  if (!intervals.length) return null;
  const spenderCasts = def.spenderIds.flatMap((id) => castsOf(result, id)).sort((a, b) => a - b);
  let used = 0;
  const delays = [];
  intervals.forEach(([start, end]) => {
    // El casteo que REALMENTE consume el proc es el que coincide con el
    // FINAL del intervalo (ahí es cuando el juego saca el buff) — no
    // cualquiera que caiga en el medio. Si hay más de un casteo dentro de
    // la ventana (pasa seguido en los datos reales), nos quedamos con el
    // ÚLTIMO, no con el primero que encuentre .find().
    const castsInWindow = spenderCasts.filter((ms) => ms >= start && ms <= end);
    if (castsInWindow.length) {
      used += 1;
      const consumingCast = castsInWindow[castsInWindow.length - 1];
      delays.push(consumingCast - start);
    }
  });
  return {
    label: def.label,
    total: intervals.length,
    used,
    avgDelayMs: delays.length ? delays.reduce((a, b) => a + b, 0) / delays.length : null,
  };
}

function analyzeUnbreakableArmor(result) {
  const intervals = intervalsOf(result, SPELL.UNBREAKABLE_ARMOR);
  if (!intervals.length) return null;
  const erwCasts = castsOf(result, SPELL.EMPOWER_RUNE_WEAPON);
  const obliterateCasts = castsOf(result, SPELL.OBLITERATE);
  const windows = intervals.map(([start, end], i) => {
    const withErw = erwCasts.some((ms) => ms >= start - ERW_LOOKBACK_MS && ms <= end);
    const target = withErw ? OBLITERATE_TARGET_WITH_ERW : OBLITERATE_TARGET_NO_ERW;
    const hits = obliterateCasts.filter((ms) => ms >= start && ms <= end).length;
    return { index: i + 1, start, end, obliterateHits: hits, target, withErw };
  });
  return { uses: intervals.length, windows };
}

function analyzeHowlingBlast(result) {
  const casts = castsOf(result, SPELL.HOWLING_BLAST);
  if (!casts.length) return null;
  const rimeIntervals = intervalsOf(result, SPELL.FREEZING_FOG_RIME_PROC);
  const kmIntervals = intervalsOf(result, SPELL.KILLING_MACHINE);
  const rows = casts.map((ms) => ({
    ms,
    withRime: rimeIntervals.some(([s, e]) => ms >= s && ms <= e),
    withKillingMachine: kmIntervals.some(([s, e]) => ms >= s && ms <= e),
  }));
  return {
    casts: rows,
    goodCount: rows.filter((r) => r.withRime).length,
    total: rows.length,
    // El combo grande: Rime (tiro gratis) + Killing Machine (crítico
    // garantizado) consumidos juntos en el mismo Howling Blast.
    comboCount: rows.filter((r) => r.withRime && r.withKillingMachine).length,
  };
}

function analyzeConsumables(result) {
  // Igual que en Unholy: el Flask puede haberse aplicado antes del pull y el
  // slice no contener SPELL_AURA_APPLIED. Para DK asumimos que está activo
  // desde el pull salvo evidencia explícita en contrario.
  const flaskIntervals = intervalsOf(result, SPELL.FLASK_OF_ENDLESS_RAGE);
  const flaskDetectedInLog = flaskIntervals.length > 0;
  const flaskUsed = true;

  const fightMs = (result.raw.RDURATION || 0) * 1000;
  const oneMinutePossible = Math.max(1, Math.floor(fightMs / 60000) + 1);
  const sapperPossible = Math.max(1, Math.floor(fightMs / GLOBAL_THERMAL_SAPPER_COOLDOWN_MS) + 1);
  const hyperspeedUses = castsOf(result, SPELL.HYPERSPEED_ACCELERATION).length
    || intervalsOf(result, SPELL.HYPERSPEED_ACCELERATION).length;
  const saroniteUses = castsOf(result, SPELL.SARONITE_BOMB).length;
  const globalThermalUses = castsOf(result, SPELL.GLOBAL_THERMAL_SAPPER_CHARGE).length;

  const potionUses = [];
  intervalsOf(result, SPELL.SPEED_POTION).forEach(([start]) => potionUses.push({ name: displayNameFor(result, SPELL.SPEED_POTION), ms: start }));
  // SpellID-only: nunca depender del nombre traducido del buff.
  const indestructibleIntervals = intervalsOf(result, SPELL.INDESTRUCTIBLE_POTION);
  indestructibleIntervals.forEach(([start]) => potionUses.push({ name: displayNameFor(result, SPELL.INDESTRUCTIBLE_POTION), ms: start }));
  potionUses.sort((a, b) => a.ms - b.ms);
  const prepotOk = potionUses.length ? (potionUses[0].ms <= 0 && potionUses[0].ms >= -PREPOT_WINDOW_MS) : null;
  return {
    flaskUsed,
    flaskDetectedInLog,
    flaskInferredAtPull: !flaskDetectedInLog,
    hyperspeed: { used: hyperspeedUses, possible: oneMinutePossible },
    saroniteBomb: { used: saroniteUses, possible: oneMinutePossible },
    globalThermalSapperCharge: { used: globalThermalUses, possible: sapperPossible },
    potionUses,
    prepotOk,
  };
}

// Devuelve el análisis completo de Frost, o null si no aplica (no es DK, o
// no hay suficientes datos como para armar ninguna categoría del puntaje).
export function computeFrostAnalysis(result) {
  const diseaseUptimes = result.uptimes.filter((u) => [SPELL.FROST_FEVER, SPELL.BLOOD_PLAGUE].includes(String(u.id)));
  const diseaseAvgPct = diseaseUptimes.length
    ? diseaseUptimes.reduce((s, u) => s + u.pct, 0) / diseaseUptimes.length
    : null;

  const procs = PROC_DEFS.map((d) => analyzeProc(result, d)).filter(Boolean);
  const killingMachine = procs.find((p) => p.label === 'Killing Machine') || null;
  const rime = procs.find((p) => p.label === 'Rime') || null;

  const ua = analyzeUnbreakableArmor(result);
  const howlingBlast = analyzeHowlingBlast(result);
  const consumables = analyzeConsumables(result);

  // --- Puntaje (0-100), repartido en partes iguales entre las categorías
  // que se pudieron calcular. Runic Power Capping y Rune Efficiency quedan
  // afuera del promedio (ver nota arriba) hasta que haya datos para ellas.
  const categories = [];
  if (diseaseAvgPct != null) {
    categories.push({
      key: 'diseases',
      label: 'Disease Uptime',
      score: Math.max(0, Math.min(100, (diseaseAvgPct / DISEASE_UPTIME_TARGET) * 100)),
    });
  }
  if (ua) {
    const totalHits = ua.windows.reduce((s, w) => s + w.obliterateHits, 0);
    const idealTotal = ua.windows.reduce((s, w) => s + w.target, 0);
    categories.push({ key: 'cooldown', label: 'Cooldown Alignment', score: Math.max(0, Math.min(100, pct(totalHits, idealTotal))) });
  }
  const score = categories.length
    ? Math.round(categories.reduce((s, c) => s + c.score, 0) / categories.length)
    : null;

  return { score, categories, diseaseAvgPct, diseaseUptimes, killingMachine, rime, ua, howlingBlast, consumables };
}
