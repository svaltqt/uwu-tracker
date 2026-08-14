// Funciones puras de formateo — sin estado, sin red, sin DOM. Reciben
// datos y devuelven strings/HTML listos para insertar.

  // La API devuelve el puntaje en escala 0-10000 (percentil × 100, ej. 9459 = 94.59).
  export function formatScore(rawPoints) {
    if (rawPoints == null) return '–';
    return (rawPoints / 100).toFixed(2);
  }

  export function scoreColor(rawPoints) {
    if (rawPoints == null) return 'var(--text-dim)';
    const pct = rawPoints / 100;
    if (pct >= 100) return '#F4C35A';   // amarillo claro / dorado (confirmado)
    if (pct >= 95) return '#F39A2D';    // naranja intenso (confirmado)
    if (pct >= 90) return '#F05A28';    // naranja rojizo (confirmado)
    if (pct >= 75) return '#a335ee';    // morado
    if (pct >= 50) return '#0070de';    // azul
    if (pct >= 25) return '#1eff00';    // verde
    return '#808080';                    // gris
  }

  // El report_id de uwu-logs.xyz sigue siempre el formato
  // "YY-MM-DD--HH-MM--Autor--Servidor" (ej: "26-07-10--20-03--Deathtopia--Onyxia"),
  // así que la fecha de publicación del log sale de ahí — no es un campo aparte
  // en la respuesta de /character. Mismo parseo que LogEntry.from_report_id en
  // el lado Python (models.py), reimplementado acá porque el dashboard es standalone.
  export function parseReportDate(reportId) {
    if (!reportId) return null;
    const parts = reportId.split('--');
    if (parts.length < 2) return null;
    const dateBits = parts[0].split('-').map(Number);
    const timeBits = parts[1].split('-').map(Number);
    if (dateBits.length !== 3 || timeBits.length !== 2) return null;
    const [yy, mm, dd] = dateBits;
    const [hh, mi] = timeBits;
    if ([yy, mm, dd, hh, mi].some((n) => Number.isNaN(n))) return null;
    const date = new Date(2000 + yy, mm - 1, dd, hh, mi);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  export function formatReportDate(reportId) {
    const d = parseReportDate(reportId);
    if (!d) return '–';
    return d.toLocaleDateString('es', { day: '2-digit', month: '2-digit', year: '2-digit' });
  }

  export function formatDuration(seconds) {
    if (seconds == null || Number.isNaN(seconds)) return '–';
    const total = Math.round(seconds);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  // "1:23.4" — para el timeline de casteos, con un decimal de precisión.
  export function formatTimelineMs(ms) {
    const sign = ms < 0 ? '-' : '';
    // Redondeamos primero a décimas de segundo enteras, así el carry a
    // minuto se calcula sobre el valor YA redondeado (si no, un caso como
    // 119960ms da "1:60.0" en vez de "2:00.0" — 60.0 no es un segundo válido).
    const totalDeciSec = Math.round(Math.abs(ms) / 100);
    const m = Math.floor(totalDeciSec / 600);
    const s = (totalDeciSec - m * 600) / 10;
    return `${sign}${m}:${s.toFixed(1).padStart(4, '0')}`;
  }

  // "1.2m", "850k", etc. — formato abreviado tipo Warcraft Logs para números grandes.
  export function formatAbbreviated(n) {
    if (n == null || Number.isNaN(n)) return '–';
    const abs = Math.abs(n);
    if (abs >= 1e9) return `${(n / 1e9).toFixed(1).replace(/\.0$/, '')}b`;
    if (abs >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}m`;
    if (abs >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}k`;
    return Math.round(n).toLocaleString('en-US');
  }

  export function rankingValueHtml(bossData) {
    const pts = bossData.points;
    return `<div class="metric-value ranking-col" style="color:${scoreColor(pts)}">${formatScore(pts)}</div>`;
  }

  export function dpsValueHtml(bossData) {
    const dps = bossData.dps_max;
    const dpsText = dps != null ? Math.round(dps).toLocaleString('en-US') : '–';
    return `<div class="metric-value damage">${dpsText}</div>`;
  }

  export function totalDamageValueHtml(bossData) {
    const dps = bossData.dps_max;
    const duration = bossData.fastest_kill_duration;
    // La API no devuelve el daño total hecho, solo el DPS y la duración del
    // kill — lo estimamos multiplicando ambos (asume que dps_max y
    // fastest_kill_duration son del mismo intento, que es como los agrupa
    // la API en cada boss).
    const totalDamage = (dps != null && duration != null) ? dps * duration : null;
    if (totalDamage == null) return '<div class="metric-value-secondary">–</div>';
    return `<div class="metric-value-secondary" title="Estimated total damage (DPS × kill duration), the API doesn't give it directly">${formatAbbreviated(totalDamage)}</div>`;
  }

  // Externos conocidos que le pueden dar a un DPS (spell ID → nombre).
  // Sacados de decodificar el campo `auras` de un log real contra Wowhead —
  // no hay documentación oficial de este campo, así que esto es best-effort:
  // si la API no incluye el spell ID exacto acá, no lo vamos a detectar.
  export const EXTERNAL_BUFFS = {
    10060: 'Power Infusion',
    29166: 'Innervate',
    49016: 'Hysteria',
    57933: 'Tricks of the Trade',
    57934: 'Tricks of the Trade',
    54648: 'Focus Magic',
  };

  // El campo `auras` viene como "#<spellId>/<veces>/<%uptime>/<flag>" repetido.
  export function parseAuras(aurasStr) {
    if (!aurasStr) return [];
    return aurasStr.split('#').filter(Boolean).map((chunk) => {
      const [id, count, value, flag] = chunk.split('/');
      return { id: Number(id), count: Number(count), value: Number(value), flag: Number(flag) };
    });
  }

  // Externos reconocidos que recibió el jugador en este intento puntual
  // (uno por tipo, aunque haya venido más de una vez).
  export function getExternalsReceived(bossData) {
    const found = [];
    parseAuras(bossData.auras).forEach((a) => {
      const name = EXTERNAL_BUFFS[a.id];
      if (name && !found.some((f) => f.name === name)) found.push({ name, count: a.count });
    });
    return found;
  }

  export function externalsColumnHtml(bossData) {
    const externals = getExternalsReceived(bossData);
    if (!externals.length) return '<div class="externals-count">–</div>';
    const tooltip = externals.map((e) => (e.count > 1 ? `${e.name} (x${e.count})` : e.name)).join(', ');
    return `<div class="externals-count" title="${tooltip}">${externals.length}</div>`;
  }
