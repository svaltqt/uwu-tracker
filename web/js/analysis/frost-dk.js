// Análisis específico para Death Knight - Frost.
//
// Depende únicamente de `result`, el objeto que ya arma
// `summarizeDkTimeline()` en app.js (result.raw, result.timeline,
// result.uptimes, result.spellCounts, result.debugIntervalsByName). No
// vuelve a leer el DATA crudo de report_casts — reusa lo que ese parseo ya
// calculó, para no tener dos lugares leyendo el mismo evento crudo con
// criterios distintos.
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

const DISEASE_NAMES = ['Frost Fever', 'Blood Plague'];
const DISEASE_UPTIME_TARGET = 95; // % — debajo de esto la categoría empieza a perder puntos

const PROC_DEFS = [
  { buffName: 'Killing Machine', spenderNames: ['Obliterate', 'Frost Strike'], label: 'Killing Machine' },
  { buffName: 'Rime', spenderNames: ['Howling Blast'], label: 'Rime' },
];

const UA_NAME = 'Unbreakable Armor';
const ERW_NAME = 'Empower Rune Weapon';
const OBLITERATE_NAME = 'Obliterate';
const HOWLING_BLAST_NAME = 'Howling Blast';
// ERW casteado hasta 3s antes de que arranque la ventana de UA cuenta como
// el mismo "burst" de cooldowns (orden de casteo puede variar por macro).
const ERW_LOOKBACK_MS = 3000;
// Benchmark de Obliterates dentro de una ventana de 20s de UA: 6 con ERW
// (más runas/haste disponibles), 5 sin. Es el mismo número que usa la
// comunidad de Frost DK WotLK como referencia — no viene de un tooltip,
// así que tratalo como una vara de medir aproximada, no una regla exacta.
const OBLITERATE_TARGET_WITH_ERW = 6;
const OBLITERATE_TARGET_NO_ERW = 5;

const FLASK_NAMES = ['Flask of Endless Rage'];
const POTION_NAMES = ['Speed', 'Indestructible Potion', 'Potion of Speed'];
const PREPOT_WINDOW_MS = 60000; // una pot casteada hasta 60s antes del pull cuenta como prepot
export const MAX_POTIONS_EXPECTED = 2; // prepot + 1 durante el intento (comparten cooldown)

export function isFrostDk(result) {
  if (!result || (result.raw.CLASS || '').toLowerCase() !== 'death-knight') return false;
  const names = new Set(result.uptimes.map((u) => u.name));
  result.spellCounts.forEach((s) => names.add(s.name));
  return names.has('Killing Machine') || names.has('Rime') || names.has(UA_NAME);
}

function pct(part, whole) {
  return whole > 0 ? (part / whole) * 100 : 0;
}

function castsOf(result, name) {
  return result.timeline
    .filter((t) => t.name === name)
    .map((t) => t.ms)
    .sort((a, b) => a - b);
}

function intervalsOf(result, name) {
  return (result.debugIntervalsByName && result.debugIntervalsByName[name]) || [];
}

function analyzeProc(result, def) {
  const intervals = intervalsOf(result, def.buffName);
  if (!intervals.length) return null;
  const spenderCasts = def.spenderNames.flatMap((n) => castsOf(result, n)).sort((a, b) => a - b);
  let used = 0;
  const delays = [];
  intervals.forEach(([start, end]) => {
    const cast = spenderCasts.find((ms) => ms >= start && ms <= end);
    if (cast != null) {
      used += 1;
      delays.push(cast - start);
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
  const intervals = intervalsOf(result, UA_NAME);
  if (!intervals.length) return null;
  const erwCasts = castsOf(result, ERW_NAME);
  const obliterateCasts = castsOf(result, OBLITERATE_NAME);
  const windows = intervals.map(([start, end], i) => {
    const withErw = erwCasts.some((ms) => ms >= start - ERW_LOOKBACK_MS && ms <= end);
    const target = withErw ? OBLITERATE_TARGET_WITH_ERW : OBLITERATE_TARGET_NO_ERW;
    const hits = obliterateCasts.filter((ms) => ms >= start && ms <= end).length;
    return { index: i + 1, start, end, obliterateHits: hits, target, withErw };
  });
  return { uses: intervals.length, windows };
}

function analyzeHowlingBlast(result) {
  const casts = castsOf(result, HOWLING_BLAST_NAME);
  if (!casts.length) return null;
  const rimeIntervals = intervalsOf(result, 'Rime');
  const rows = casts.map((ms) => ({ ms, withRime: rimeIntervals.some(([s, e]) => ms >= s && ms <= e) }));
  return { casts: rows, goodCount: rows.filter((r) => r.withRime).length, total: rows.length };
}

function analyzeConsumables(result) {
  const buffNames = new Set(Object.keys(result.debugIntervalsByName || {}));
  const flaskUsed = FLASK_NAMES.some((n) => buffNames.has(n));
  const potionUses = [];
  POTION_NAMES.forEach((name) => {
    const intervals = intervalsOf(result, name);
    intervals.forEach(([start]) => potionUses.push({ name, ms: start }));
  });
  potionUses.sort((a, b) => a.ms - b.ms);
  const prepotOk = potionUses.length ? (potionUses[0].ms <= 0 && potionUses[0].ms >= -PREPOT_WINDOW_MS) : null;
  return { flaskUsed, potionUses, prepotOk };
}

// Devuelve el análisis completo de Frost, o null si no aplica (no es DK, o
// no hay suficientes datos como para armar ninguna categoría del puntaje).
export function computeFrostAnalysis(result) {
  const diseaseUptimes = result.uptimes.filter((u) => DISEASE_NAMES.includes(u.name));
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
