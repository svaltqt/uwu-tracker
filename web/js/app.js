import { CLASS_MAP, SPEC_MAP, SPEC_ICON, specIconHtml, getSpecInfo } from './data/classes.js';
import {
  RAID_BOSS_LIST, BOSS_RAID_MAP, ALIAS_TO_CANONICAL, findBossData, RAID_ORDER,
  getRaidForBoss, getCanonicalBossNames, getAllCanonicalBossNames,
  PHASE_ORDER, PHASE_BOSSES, getRaidsForPhase,
} from './data/raids.js';
import { CLASS_ROTATION_CONFIG, DEFAULT_ROTATION_CONFIG } from './data/rotation-config.js';
import { isFrostDk, computeFrostAnalysis, MAX_POTIONS_EXPECTED } from './analysis/frost-dk.js';
import { isUnholyDk, computeUnholyAnalysis } from './analysis/unholy-dk.js';
import { computeFireMageAnalysis } from './analysis/fire-mage.js';
import {
  formatScore, scoreColor, parseReportDate, formatReportDate, formatDuration,
  formatTimelineMs, formatAbbreviated, rankingValueHtml, dpsValueHtml,
  totalDamageValueHtml, EXTERNAL_BUFFS, parseAuras, getExternalsReceived,
  externalsColumnHtml,
} from './utils/format.js';



  const CONFIG_KEY = 'groster-config';
  const DATA_KEY = 'groster-data';
  const ALL_CORES = '__ALL__';
  const DEFAULT_CORE = 'Core 1';
  const ALL_ROLES = '__ALL__';
  const AUTO_SPEC = 'auto';
  const ROLE_LABELS = { [ALL_ROLES]: 'All roles', Damage: 'Damage', Healing: 'Healing' };

  let config = { guildName: 'Mi Guild', server: '', members: [] };
  let dataCache = {}; // key: `${server}::${name}::${spec}` -> { status, data, detectedSpec, error, fetchedAt }
  let activeCoreFilter = ALL_CORES;
  let activeRoleFilter = ALL_ROLES;
  let activeClassFilter = ''; // '' = todas, si no class_i como string ('0'..'9')
  let activeSpecFilter = ''; // '' = todas, si no '1'/'2'/'3' (dentro de la clase elegida)
  let viewMode = 'roster'; // 'roster' | 'boss'
  let profilePlayerName = null; // nombre del jugador cuyo perfil se está viendo, o null
  let profileReturnView = 'roster'; // a qué vista volver con "← Volver"
  let profilePhaseFilter = 'Phase 3'; // fase actual del server, por defecto en el perfil
  let analysisReturnView = 'boss'; // a qué vista volver desde el análisis de log
  let activeAnalysisData = null; // datos del log siendo analizado
  let compareWithPlayerName = null; // nombre del segundo jugador en la comparación de Timelines, o null
  let bossScope = '__ALL__'; // '__ALL__' = raid completa, o el nombre exacto de un jefe
  let bossRaidFilter = ''; // '' = todas las raids, o el nombre exacto de una (ej. 'Ulduar')
  let bossPhaseFilter = ''; // '' = todas las fases, o 'Phase 1'..'Phase 4.5'
  const TOP_N_PER_BOSS = 10;

  const $ = (id) => document.getElementById(id);

  function memberKey(server, name, spec) {
    return `${server}::${name}::${spec}`;
  }

  // Ventana corta contra clicks duplicados accidentales — NO es un caché
  // semanal. Un caché por semana asume que el raid es siempre el mismo día
  // (justo después del reset), lo cual es falso: si el grupo raidea otro
  // día de la semana, un fetch temprano (ej. martes) taparía el log nuevo
  // del sábado hasta el próximo reset. Mejor prevenir dobles clicks nomás.
  // Inicio del ciclo semanal actual: el martes 22:00 (hora local) más
  // reciente que ya pasó. Si ya se pidió /character de un personaje DESPUÉS
  // de ese momento, se saltea (evita repetir el mismo log toda la semana).
  //
  // ADVERTENCIA / LIMITACIÓN CONOCIDA: esto asume que cuando refrescás, tu
  // grupo YA raideó esta semana. Si le das a "Refresh all" ANTES de que ese
  // grupo raidee (ej. lunes, antes del raid del sábado), va a quedar
  // marcado como "actualizado" con datos viejos, y el log nuevo del sábado
  // NO va a aparecer hasta el martes siguiente. Para grupos que raidean
  // distintos días, conviene refrescar recién DESPUÉS de que cada uno
  // termine su noche de raid, no antes.
  function startOfCurrentWeeklyCycle() {
    const now = new Date();
    const TUESDAY = 2;
    const daysSinceTuesday = (now.getDay() + 7 - TUESDAY) % 7;
    const boundary = new Date(now);
    boundary.setDate(now.getDate() - daysSinceTuesday);
    boundary.setHours(22, 0, 0, 0);
    if (boundary.getTime() > now.getTime()) boundary.setDate(boundary.getDate() - 7);
    return boundary;
  }

  function getCores() {
    const cores = new Set(config.members.map((m) => m.core || DEFAULT_CORE));
    return Array.from(cores).sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
  }


  async function loadState() {
    try {
      const cfgRaw = localStorage.getItem(CONFIG_KEY);
      if (cfgRaw) config = JSON.parse(cfgRaw);
    } catch (e) { /* no config saved yet */ }
    // Migración: roster guardado antes de que existiera el campo "core".
    config.members = (config.members || []).map((m) => ({ ...m, core: m.core || DEFAULT_CORE }));
    try {
      const dataRaw = localStorage.getItem(DATA_KEY);
      if (dataRaw) dataCache = JSON.parse(dataRaw);
    } catch (e) { /* no cache saved yet */ }

    $('guildName').value = config.guildName || 'Mi Guild';
    $('serverInput').value = config.server || '';
    render();
  }

  async function saveConfig() {
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    } catch (e) { console.error('No se pudo guardar la config', e); }
  }

  async function saveDataCache() {
    try {
      localStorage.setItem(DATA_KEY, JSON.stringify(dataCache));
    } catch (e) { console.error('No se pudo guardar la cache de datos', e); }
  }

  async function fetchSpec(server, name, spec) {
    const resp = await fetch('/api/character', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ server, name, spec_i: String(spec) }),
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      throw new Error(friendlyUpstreamError('character', resp.status, detail));
    }
    return resp.json();
  }

  async function fetchMember(server, name, spec) {
    const key = memberKey(server, name, spec);
    dataCache[key] = { ...(dataCache[key] || {}), status: 'loading' };
    render();

    try {
      if (spec === AUTO_SPEC) {
        // Detección automática: no hay endpoint que devuelva las 3 specs de
        // una — probamos 1, 2 y 3 y nos quedamos con la que tenga más
        // overall_points, asumiendo que esa es la spec "principal" con la
        // que el jugador realmente juega/loguea.
        let best = null;
        let bestSpec = null;
        let bestPoints = -Infinity;
        let lastErr = null;
        for (const s of ['1', '2', '3']) {
          try {
            const data = await fetchSpec(server, name, s);
            const points = data.overall_points || 0;
            if (points > bestPoints) {
              bestPoints = points;
              best = data;
              bestSpec = s;
            }
          } catch (err) {
            lastErr = err;
          }
        }
        if (!best) throw lastErr || new Error('No spec returned data');
        dataCache[key] = { status: 'done', data: best, detectedSpec: bestSpec, fetchedAt: new Date().toISOString() };
      } else {
        const data = await fetchSpec(server, name, spec);
        dataCache[key] = { status: 'done', data, fetchedAt: new Date().toISOString() };
      }
    } catch (err) {
      dataCache[key] = {
        status: 'error',
        error: 'Could not fetch the data. This could be a browser CORS block, the name/server doesn\'t exist, or the character has no logs.',
        fetchedAt: new Date().toISOString(),
      };
    }
    render();
    await saveDataCache();
  }

  function showRefreshProgress(total) {
    $('refreshProgressOverlay').style.display = 'flex';
    updateRefreshProgress(0, 0, 0, 0, total);
  }

  function updateRefreshProgress(loaded, validated, failed, skipped, total) {
    const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
    $('refreshProgressFill').style.width = `${pct}%`;
    $('refreshProgressText').textContent = `${loaded} / ${total} (${pct}%)`;
    $('refreshProgressSub').textContent = `${validated} validated · ${failed} failed · ${skipped} skipped (already have this week's log)`;
  }

  function hideRefreshProgress() {
    $('refreshProgressOverlay').style.display = 'none';
  }

  // ¿Los datos que YA tenemos guardados de este personaje incluyen algún
  // boss con un log fechado dentro del ciclo semanal actual? Si es así, no
  // hay nada nuevo que traer hasta el próximo reset — se saltea. Si NO,
  // sigue "disponible" y se vuelve a intentar en cada refresh (sin
  // importar cuándo fue el último intento), porque el log de esta semana
  // todavía puede no haber salido.
  function hasLogFromCurrentCycle(data, cycleStartMs) {
    if (!data || !data.bosses) return false;
    return Object.values(data.bosses).some((b) => {
      const d = b && parseReportDate(b.report_id);
      return d && d.getTime() >= cycleStartMs;
    });
  }

  async function refreshAll() {
    const server = $('serverInput').value.trim();
    if (!server) { alert('Enter the server name first.'); return; }
    $('refreshBtn').disabled = true;
    const total = config.members.length;
    if (!total) { $('refreshBtn').disabled = false; return; }
    let loaded = 0;
    let validated = 0;
    let failed = 0;
    let skipped = 0;
    const cycleStart = startOfCurrentWeeklyCycle().getTime();
    showRefreshProgress(total);
    await new Promise((resolve) => setTimeout(resolve, 0)); // dejar pintar el modal antes de arrancar
    for (const m of config.members) {
      const key = memberKey(server, m.name, m.spec);
      const cached = dataCache[key];
      const alreadyFreshThisCycle = cached && cached.status === 'done'
        && hasLogFromCurrentCycle(cached.data, cycleStart);
      if (alreadyFreshThisCycle) {
        skipped += 1;
        validated += 1;
      } else {
        await fetchMember(server, m.name, m.spec);
        if (dataCache[key] && dataCache[key].status === 'done') validated += 1;
        else failed += 1;
      }
      loaded += 1;
      updateRefreshProgress(loaded, validated, failed, skipped, total);
      await new Promise((resolve) => setTimeout(resolve, 0)); // dejar repintar aunque este miembro se haya salteado
    }
    // Si se salteó todo (o corrió muy rápido), dejamos el resumen final
    // visible un momento antes de cerrar — si no, el modal parpadea y da la
    // sensación de que "no hizo nada".
    await new Promise((resolve) => setTimeout(resolve, 600));
    hideRefreshProgress();
    $('refreshBtn').disabled = false;
  }

  function initAddClassSpec() {
    const classSelect = $('classInput');
    const specSelect = $('specInput');
    if (!classSelect || !specSelect) return;

    const classOptions = Object.entries(CLASS_MAP)
      .map(([classI, info]) => `<option value="${classI}">${info.name}</option>`)
      .join('');
    classSelect.insertAdjacentHTML('beforeend', classOptions);

    function refreshSpecOptions() {
      const classI = classSelect.value;
      const specs = classI !== '' ? (SPEC_MAP[Number(classI)] || {}) : null;
      const options = specs
        ? Object.entries(specs).map(([specKey, info]) => `<option value="${specKey}">${info.name} (${info.role})</option>`).join('')
        : '';
      specSelect.innerHTML = `<option value="">Auto (detect best)</option>${options}`;
    }

    classSelect.addEventListener('change', refreshSpecOptions);
    refreshSpecOptions();
  }

  function addMember() {
    const server = $('serverInput').value.trim();
    const name = $('nameInput').value.trim();
    const spec = $('specInput').value || AUTO_SPEC;
    const core = $('coreInput').value.trim() || DEFAULT_CORE;
    if (!server) { alert('Enter the server before adding characters.'); return; }
    if (!name) { alert('Type the character name.'); return; }

    config.server = server;
    const existing = config.members.find(m => m.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      alert(`${name} is already in the roster (Core: ${existing.core || DEFAULT_CORE}). To change its Core, edit it from its profile page instead of re-adding it.`);
      return;
    }

    config.members.push({ name, spec, core });
    $('nameInput').value = '';
    saveConfig();
    render();
    fetchMember(server, name, spec);
  }

  function removeMember(name, spec, core) {
    config.members = config.members.filter(m => !(m.name === name && m.spec === spec && m.core === core));
    saveConfig();
    render();
  }

  function toggleDetail(rowId) {
    const el = document.getElementById(rowId);
    if (el) el.classList.toggle('open');
  }

  function buildBossDetail(data) {
    const bosses = (data && data.bosses) || {};
    // Normalizar: si la API devuelve un alias (ej. "Northrend Beasts"),
    // mostrarlo con su nombre canónico ("The Beasts of Northrend").
    const entries = Object.entries(bosses)
      .filter(([, b]) => b && Object.keys(b).length > 0)
      .map(([rawName, b]) => [ALIAS_TO_CANONICAL[rawName] || rawName, b]);
    if (!entries.length) return '<div class="boss-line">No bosses recorded yet.</div>';
    entries.sort((a, b) => (b[1].points || 0) - (a[1].points || 0));
    return entries.map(([bossName, b]) => {
      const dur = b.fastest_kill_duration != null ? `${Number(b.fastest_kill_duration).toFixed(1)}s` : '?';
      const pointsColor = scoreColor(b.points);
      const link = b.report_id ? `<a href="https://uwu-logs.xyz/reports/${b.report_id}/" target="_blank" rel="noopener">view log</a>` : '';
      return `<div class="boss-line"><span>${bossName}</span><span><strong style="color:${pointsColor}">${formatScore(b.points)}</strong> · ${dur} · ${link}</span></div>`;
    }).join('');
  }

  function renderCoreFilterSelect() {
    const select = $('coreFilterSelect');
    if (!select) return;
    const cores = getCores();

    if (activeCoreFilter !== ALL_CORES && !cores.includes(activeCoreFilter)) {
      activeCoreFilter = ALL_CORES;
    }

    const countFor = (core) => config.members.filter((m) => (m.core || DEFAULT_CORE) === core).length;
    const options = [
      `<option value="${ALL_CORES}">General (${config.members.length})</option>`,
      ...cores.map((c) => `<option value="${c.replace(/"/g, '&quot;')}">${c} (${countFor(c)})</option>`),
    ];
    select.innerHTML = options.join('');
    select.value = activeCoreFilter;
  }

  function renderRoleFilterSelect() {
    const select = $('roleFilterSelect');
    if (!select) return;

    // Contamos roles solo entre los que ya tienen data cargada (el rol se
    // deriva de class_i + spec, que vienen en la respuesta de la API).
    const roleCount = { Damage: 0, Healing: 0 };
    config.members.forEach((m) => {
      const key = memberKey(config.server || $('serverInput').value.trim(), m.name, m.spec);
      const entry = dataCache[key];
      if (entry && entry.status === 'done') {
        const spec = entry.detectedSpec || m.spec;
        const role = getSpecInfo(entry.data.class_i, spec).role;
        roleCount[role] = (roleCount[role] || 0) + 1;
      }
    });

    const options = [ALL_ROLES, 'Damage', 'Healing'].map((role) => {
      const count = role === ALL_ROLES ? config.members.length : (roleCount[role] || 0);
      return `<option value="${role}">${ROLE_LABELS[role]} (${count})</option>`;
    });
    select.innerHTML = options.join('');
    select.value = activeRoleFilter;
  }

  function initRosterFilterControls() {
    const coreSelect = $('coreFilterSelect');
    if (coreSelect) {
      coreSelect.addEventListener('change', () => {
        activeCoreFilter = coreSelect.value;
        render();
      });
    }
    const roleSelect = $('roleFilterSelect');
    if (roleSelect) {
      roleSelect.addEventListener('change', () => {
        activeRoleFilter = roleSelect.value;
        render();
      });
    }
    const clearBtn = $('clearFiltersBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        activeCoreFilter = ALL_CORES;
        activeRoleFilter = ALL_ROLES;
        activeClassFilter = '';
        activeSpecFilter = '';
        syncClassSpecSelects();
        populateSpecFilterOptions();
        render();
      });
    }
    const clearBossClassBtn = $('clearBossClassFilterBtn');
    if (clearBossClassBtn) {
      clearBossClassBtn.addEventListener('click', () => {
        activeClassFilter = '';
        activeSpecFilter = '';
        syncClassSpecSelects();
        populateSpecFilterOptions();
        render();
      });
    }
  }

  // Pares de <select> Clase/Spec que existen en la UI: el del Roster y el de
  // "Ranking por boss". Ambos controlan el mismo estado global
  // (activeClassFilter/activeSpecFilter) y se mantienen sincronizados entre sí.
  const CLASS_SPEC_SELECT_IDS = [
    ['classFilterSelect', 'specFilterSelect'],
    ['bossClassFilterSelect', 'bossSpecFilterSelect'],
  ];

  function initClassFilter() {
    const classOptions = Object.entries(CLASS_MAP)
      .map(([classI, info]) => `<option value="${classI}">${info.name}</option>`)
      .join('');

    CLASS_SPEC_SELECT_IDS.forEach(([classId, specId]) => {
      const classSelect = $(classId);
      if (!classSelect) return;
      classSelect.insertAdjacentHTML('beforeend', classOptions);

      classSelect.addEventListener('change', () => {
        activeClassFilter = classSelect.value;
        activeSpecFilter = '';
        syncClassSpecSelects();
        populateSpecFilterOptions();
        render();
      });

      const specSelect = $(specId);
      if (specSelect) {
        specSelect.addEventListener('change', () => {
          activeSpecFilter = specSelect.value;
          syncClassSpecSelects();
          render();
        });
      }
    });
  }

  // Después de que uno de los dos selects de Clase cambia, refleja el mismo
  // valor en el otro (Roster <-> Ranking por boss), para que no queden
  // desincronizados visualmente.
  function syncClassSpecSelects() {
    CLASS_SPEC_SELECT_IDS.forEach(([classId]) => {
      const classSelect = $(classId);
      if (classSelect && classSelect.value !== activeClassFilter) classSelect.value = activeClassFilter;
    });
  }

  function populateSpecFilterOptions() {
    const specs = activeClassFilter ? (SPEC_MAP[Number(activeClassFilter)] || {}) : null;
    const options = specs
      ? Object.entries(specs).map(([specKey, info]) => `<option value="${specKey}">${info.name} (${info.role})</option>`).join('')
      : '';

    CLASS_SPEC_SELECT_IDS.forEach(([, specId]) => {
      const specSelect = $(specId);
      if (!specSelect) return;
      if (!activeClassFilter) {
        specSelect.innerHTML = '<option value="">All specs</option>';
        specSelect.disabled = true;
        return;
      }
      specSelect.innerHTML = `<option value="">All specs</option>${options}`;
      specSelect.disabled = false;
      specSelect.value = activeSpecFilter;
    });
  }

  function renderCoreDatalist() {
    const datalist = $('coreListOptions');
    datalist.innerHTML = getCores().map((c) => `<option value="${c.replace(/"/g, '&quot;')}"></option>`).join('');
  }

  function getFilteredRows() {
    const server = config.server || $('serverInput').value.trim();
    const visibleMembers = activeCoreFilter === ALL_CORES
      ? config.members
      : config.members.filter((m) => (m.core || DEFAULT_CORE) === activeCoreFilter);

    let rows = visibleMembers.map((m) => {
      const key = memberKey(server, m.name, m.spec);
      const entry = dataCache[key] || { status: 'idle' };
      return { ...m, entry };
    });

    if (activeRoleFilter !== ALL_ROLES) {
      // El rol se deriva de class_i + spec, que solo conocemos una vez que
      // cargó la data — filas sin data todavía quedan fuera del filtro.
      rows = rows.filter((r) => {
        if (r.entry.status !== 'done') return false;
        const spec = r.entry.detectedSpec || r.spec;
        return getSpecInfo(r.entry.data.class_i, spec).role === activeRoleFilter;
      });
    }

    if (activeClassFilter) {
      rows = rows.filter((r) => r.entry.status === 'done' && String(r.entry.data.class_i) === activeClassFilter);
    }
    if (activeSpecFilter) {
      rows = rows.filter((r) => {
        if (r.entry.status !== 'done') return false;
        const spec = r.entry.detectedSpec || r.spec;
        return String(spec) === activeSpecFilter;
      });
    }

    const withData = rows.filter(r => r.entry.status === 'done');
    const others = rows.filter(r => r.entry.status !== 'done');
    return { server, rows, withData, others };
  }

  function render() {
    renderCoreFilterSelect();
    renderRoleFilterSelect();
    renderCoreDatalist();

    const { rows, withData, others } = getFilteredRows();
    withData.sort((a, b) => {
      const pa = (a.entry.data && (a.entry.data.overall_points || a.entry.data.points)) || 0;
      const pb = (b.entry.data && (b.entry.data.overall_points || b.entry.data.points)) || 0;
      return pb - pa;
    });

    const maxPoints = withData.length
      ? Math.max(...withData.map(r => (r.entry.data.overall_points || r.entry.data.points || 0)))
      : 1;

    const ordered = [...withData, ...others];
    const body = $('rosterBody');

    if (!ordered.length) {
      body.innerHTML = `<div class="empty-state">No members added to the roster yet.<br/>Add the first one from the form above.</div>`;
    } else {
      body.innerHTML = ordered.map((r, idx) => {
        const isRanked = r.entry.status === 'done';
        const guildRank = isRanked ? withData.findIndex(x => x.name === r.name && x.spec === r.spec && x.core === r.core) + 1 : null;
        const rankClass = guildRank === 1 ? 'top1' : guildRank === 2 ? 'top2' : guildRank === 3 ? 'top3' : '';
        const classInfo = isRanked ? (CLASS_MAP[r.entry.data.class_i] || { name: '—', color: '#9a9fab' }) : { name: '', color: '#9a9fab' };
        const points = isRanked ? (r.entry.data.overall_points || r.entry.data.points || 0) : 0;
        const serverRank = isRanked ? (r.entry.data.overall_rank || r.entry.data.rank) : null;
        const barWidth = isRanked && maxPoints ? Math.max(4, Math.round((points / maxPoints) * 100)) : 0;
        const rowId = `detail-${idx}-${r.name}-${r.spec}`.replace(/[^a-zA-Z0-9-]/g, '');

        const specValue = (isRanked && r.entry.detectedSpec) ? r.entry.detectedSpec : r.spec;
        const specInfo = isRanked ? getSpecInfo(r.entry.data.class_i, specValue) : null;
        const autoTag = (isRanked && r.entry.detectedSpec) ? '<span class="auto-tag" title="Auto-detected spec: the one with the most points">auto</span>' : '';
        const isHealer = isRanked && specInfo && specInfo.role === 'Healing';

        let statusHtml = '';
        if (r.entry.status === 'loading') statusHtml = `<div class="status-loading">Loading…</div>`;
        if (r.entry.status === 'error') statusHtml = `<div class="status-error" title="${r.entry.error}">Error fetching data</div>`;
        if (r.entry.status === 'idle') statusHtml = `<div class="status-loading">No data yet</div>`;

        return `
          <div class="member-row" data-row="${rowId}">
            <div class="rank-badge ${isHealer ? '' : rankClass}" title="${isHealer ? 'Healers are excluded from the damage-based ranking' : ''}">${isHealer ? '–' : (guildRank || '–')}</div>
            <div class="member-name-cell">
              <div class="member-name" style="color:${classInfo.color || 'var(--text)'}">${isRanked ? specIconHtml(r.entry.data.class_i, Number(specValue), 20) : ''}<span>${r.name}</span></div>
              <div class="member-sub">${classInfo.name || ''}${activeCoreFilter === ALL_CORES ? ` · ${r.core || DEFAULT_CORE}` : ''}</div>
              ${statusHtml}
            </div>
            <div class="spec-tag">
              ${isRanked ? `<span class="role-badge role-${specInfo.role}">${specInfo.role}${isHealer ? ' ⚠' : ''}</span>` : ''}
              <div>${isRanked ? specInfo.name : (r.spec === AUTO_SPEC ? 'Auto' : `Spec ${r.spec}`)} ${autoTag}</div>
            </div>
            <div class="power-bar-wrap" title="${isHealer ? "uwu-logs.xyz only tracks damage, not healing — this is this healer's damage, not their HPS" : ''}">
              <div class="power-bar-track"><div class="power-bar-fill" style="width:${isRanked && !isHealer ? barWidth : 0}%; background:${isHealer ? 'var(--text-dim)' : (classInfo.color || 'var(--gold)')}"></div></div>
              <div class="power-bar-value" style="color:${isHealer ? 'var(--text-dim)' : (isRanked ? scoreColor(points) : 'var(--text-dim)')}">${isRanked ? (isHealer ? `${formatScore(points)} (dmg)` : formatScore(points)) : '–'}</div>
            </div>
            <div class="server-rank">${isHealer ? '–' : (serverRank ? '#' + serverRank : '–')}</div>
            <button class="remove-btn" title="Remove from roster" data-remove="${r.name}::${r.spec}::${r.core || DEFAULT_CORE}">✕</button>
          </div>
          <div class="detail-panel" id="${rowId}" style="display:none;">
            ${isRanked ? buildBossDetail(r.entry.data) : (r.entry.status === 'error' ? r.entry.error : 'No data yet for this character.')}
          </div>
        `;
      }).join('');

      // listeners
      body.querySelectorAll('.member-row').forEach(rowEl => {
        rowEl.addEventListener('click', (e) => {
          if (e.target.closest('.remove-btn') || e.target.closest('.member-name')) return;
          toggleDetail(rowEl.dataset.row);
        });
      });
      body.querySelectorAll('.remove-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const [name, spec, core] = btn.dataset.remove.split('::');
          removeMember(name, spec, core);
        });
      });

      // trigger bar fill animation
      requestAnimationFrame(() => {
        body.querySelectorAll('.power-bar-fill').forEach(el => {
          const w = el.style.width;
          el.style.width = '0%';
          requestAnimationFrame(() => { el.style.width = w; });
        });
      });
    }

    // summary stats (reflejan la vista filtrada actual: General o el Core activo)
    // Los healers quedan afuera de promedio/mejor-rank: uwu-logs.xyz no trackea
    // HPS, así que su "score" acá es en realidad su daño (irrelevante para su
    // rol) y arrastraría el promedio del guild hacia abajo injustamente.
    $('statMembers').textContent = rows.length;
    const dpsWithData = withData.filter((r) => {
      const spec = r.entry.detectedSpec || r.spec;
      return getSpecInfo(r.entry.data.class_i, spec).role !== 'Healing';
    });
    if (dpsWithData.length) {
      const avg = dpsWithData.reduce((s, r) => s + (r.entry.data.overall_points || r.entry.data.points || 0), 0) / dpsWithData.length;
      $('statAvg').textContent = formatScore(avg);
      const bestRank = Math.min(...dpsWithData.map(r => r.entry.data.overall_rank || r.entry.data.rank || Infinity));
      $('statBest').textContent = isFinite(bestRank) ? '#' + bestRank : '–';
    } else {
      $('statAvg').textContent = '–';
      $('statBest').textContent = '–';
    }

    // Desglose de puntos prom. por core, solo en la vista General (y si hay 2+ cores).
    // Respeta los filtros de rol/clase/spec activos, igual que el promedio de arriba.
    const breakdownEl = $('coreAvgBreakdown');
    if (breakdownEl) {
      const cores = getCores();
      if (activeCoreFilter === ALL_CORES && cores.length > 1 && dpsWithData.length) {
        const byCore = {};
        dpsWithData.forEach((r) => {
          const core = r.core || DEFAULT_CORE;
          const points = r.entry.data.overall_points || r.entry.data.points || 0;
          if (!byCore[core]) byCore[core] = { sum: 0, count: 0 };
          byCore[core].sum += points;
          byCore[core].count += 1;
        });
        breakdownEl.innerHTML = cores
          .filter((c) => byCore[c])
          .map((c) => `<div class="core-avg-line"><span>${c}</span><span>${formatScore(byCore[c].sum / byCore[c].count)}</span></div>`)
          .join('');
      } else {
        breakdownEl.innerHTML = '';
      }
    }

    const anyFetched = Object.values(dataCache).some(v => v.fetchedAt);
    if (anyFetched) {
      const latest = Object.values(dataCache).filter(v => v.fetchedAt).sort((a, b) => new Date(b.fetchedAt) - new Date(a.fetchedAt))[0];
      $('lastUpdated').textContent = `Last updated: ${new Date(latest.fetchedAt).toLocaleString()}`;
    } else {
      $('lastUpdated').textContent = '';
    }

    renderBossView();
    renderPlayerProfile();
  }

  // Lista de jefes conocidos: unión de las keys de `bosses` de todos los
  // personajes ya cargados, en el orden en que aparecen (la API los devuelve
  // siempre en el mismo orden para todos, así que alcanza con leerlos del
  // primer personaje con datos). Si se pasa `raidFilter`, solo devuelve los
  // jefes de esa raid (ver BOSS_RAID_MAP — la API mezcla jefes de varias
  // raids en la misma respuesta).
  // Jefes vistos en la data ya cargada (independiente de si están mapeados
  // a una raid conocida o no) — se usa solo para detectar jefes "Otros".
  function getSeenBossNames() {
    const seen = [];
    Object.values(dataCache).forEach((entry) => {
      if (entry.status !== 'done' || !entry.data || !entry.data.bosses) return;
      Object.keys(entry.data.bosses).forEach((bossName) => {
        if (!seen.includes(bossName)) seen.push(bossName);
      });
    });
    return seen;
  }

  // Lista de jefes para el select "Ver". Para una raid conocida (o "todas"),
  // se muestran los jefes CANÓNICOS de la tabla siempre — así se puede
  // elegir una raid entera aunque todavía no haya ningún log cargado para
  // ella. "Otros" sigue siendo dinámico: solo lista jefes que realmente
  // aparecieron en la data y no están mapeados a ninguna raid conocida.
  // Si se pasa `phaseFilter`, se intersecta con los jefes de esa fase (ej.
  // Vault of Archavon solo aporta el jefe correspondiente a esa fase, no los
  // 4 juntos).
  function getBossNames(raidFilter, phaseFilter) {
    let list;
    if (raidFilter === 'Other') {
      list = getSeenBossNames().filter((b) => getRaidForBoss(b) === 'Other');
    } else if (raidFilter) {
      list = getCanonicalBossNames(raidFilter);
    } else {
      const unmapped = getSeenBossNames().filter((b) => getRaidForBoss(b) === 'Other');
      list = [...getAllCanonicalBossNames(), ...unmapped];
    }
    if (phaseFilter) {
      const phaseSet = new Set(PHASE_BOSSES[phaseFilter] || []);
      list = list.filter((b) => phaseSet.has(b));
    }
    return list;
  }

  // Todas las raids conocidas se listan siempre, tengan o no logs cargados
  // todavía. "Otros" solo aparece si de verdad hay algún jefe sin mapear en
  // la data ya cargada. Si se pasa `phaseFilter`, se recorta a las raids que
  // tienen al menos un jefe en esa fase (para que coincida con el filtro de
  // Fase, como pidió el usuario).
  function getAvailableRaids(phaseFilter) {
    if (phaseFilter) return getRaidsForPhase(phaseFilter);
    const hasUnmapped = getSeenBossNames().some((b) => getRaidForBoss(b) === 'Other');
    return hasUnmapped ? RAID_ORDER : RAID_ORDER.filter((r) => r !== 'Other');
  }

  // Participantes del roster (ya filtrados por Core/Rol/Clase/Spec) que
  // tienen intentos registrados contra `bossName`, ordenados por DPS crudo
  // (dps_max) — es la única métrica de orden ahora; el % Parse se muestra
  // como columna aparte pero ya no cambia el orden del ranking.
  function getBossLeaderboard(bossName, withData) {
    const participants = withData
      .map((r) => {
        const bossData = findBossData(r.entry.data.bosses, bossName);
        if (!bossData) return null;
        const spec = r.entry.detectedSpec || r.spec;
        return { name: r.name, core: r.core || DEFAULT_CORE, classI: r.entry.data.class_i, spec, bossData, bossName };
      })
      .filter(Boolean);

    participants.sort((a, b) => (b.bossData.dps_max || 0) - (a.bossData.dps_max || 0));
    return participants;
  }


  // ── Análisis de rotación DK (experimental) ──────────────────────────────
  // Todo esto pega contra rutas de uwu-logs.xyz que NO son la API pública
  // documentada (/character) sino páginas internas del sitio, encontradas
  // leyendo su código fuente público (github.com/Ridepad/uwu-logs). No
  // están confirmadas contra la API real todavía — necesitan el proxy local
  // (proxy_server.py) para esquivar CORS, igual que /character.

  // Replica exacta de _convert_to_html_name() del backend del sitio.
  function bossNameToHtml(name) {
    return name.toLowerCase().replace(/ /g, '-').replace(/'/g, '');
  }

  const dkAnalysisCache = {}; // key: `${reportId}::${bossHtml}::${playerName}` -> resultado o error
  const raidReplayCache = {}; // key: `${reportId}::${bossHtml}::${attempt}` -> synchronized 1-second DPS series

  // uwu-logs.xyz devuelve esta página de HTML (no JSON) cuando el sitio
  // está caído/reiniciando, con status 4xx/5xx igual — así que llega acá
  // como si fuera un error de datos cuando en realidad es "reintentá en
  // un rato". La detectamos por un texto fijo de esa página para mostrar
  // un mensaje claro en vez de HTML crudo.
  function friendlyUpstreamError(routeName, status, detailText) {
    if (/Server is restarting or under maintenance/i.test(detailText || '')) {
      return `uwu-logs.xyz está en mantenimiento ahora mismo — probá de nuevo en unos minutos.`;
    }
    const unitNotFound = (detailText || '').match(/unit with name \[([^\]]*)\] wasn't found/i);
    if (unitNotFound) {
      return `uwu-logs.xyz no encontró a "${unitNotFound[1]}" en ese reporte — el nombre en el log distingue mayúsculas/minúsculas. Revisá que el nombre esté escrito EXACTO como en el juego en el roster (ej. "Yongiill", no "yongiill") y volvé a agregarlo si hace falta.`;
    }
    return `${routeName} HTTP ${status}${detailText ? ` — ${detailText.slice(0, 200)}` : ''}`;
  }

  // Trae la página HTML del reporte y parsea los <a class="kill-link"> —
  // ahí (y SOLO ahí) está la dificultad real (10N/10H/25N/25H) y los
  // índices s/f de cada intento. El JSON de report_segments no los trae.
  async function fetchKillLinksFromReportPage(reportId) {
    const resp = await fetch(`/api/report_page/${reportId}`);
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      throw new Error(friendlyUpstreamError('report_page', resp.status, detail));
    }
    const html = await resp.text();
    const links = [];
    // Matcheamos el tag <a ...> completo primero (sin asumir orden de
    // atributos), y adentro buscamos class="kill-link" y href="..." por
    // separado — el HTML real trae href ANTES que class.
    const anchorRe = /<a\s+([^>]*)>([^<]*)<\/a>/g;
    let m;
    while ((m = anchorRe.exec(html)) !== null) {
      const attrs = m[1];
      if (!/class="kill-link"/.test(attrs)) continue;
      const hrefMatch = attrs.match(/href="([^"]+)"/);
      if (!hrefMatch) continue;
      const href = hrefMatch[1].replace(/&amp;/g, '&');
      const text = m[2].replace(/&amp;/g, '&').trim();
      const params = new URLSearchParams(href.replace(/^\?/, ''));
      links.push({
        href,
        text, // ej. "04:33.290 | 25H | Northrend Beasts"
        boss: params.get('boss'),
        mode: params.get('mode'), // ej. "25H"
        attempt: params.has('attempt') ? Number(params.get('attempt')) : null,
        s: params.has('s') ? Number(params.get('s')) : null,
        f: params.has('f') ? Number(params.get('f')) : null,
      });
    }
    return links;
  }

  // Orden de preferencia cuando hay varios Kill del mismo boss: Heroico
  // antes que Normal, 25 antes que 10 (por si algún día hay que desempatar).
  const MODE_PRIORITY = ['25H', '10H', '25N', '10N'];

  // Busca, entre los intentos contra ese boss en el reporte, cuál fue el
  // Kill correcto — prefiriendo Heroico sobre Normal. Devuelve
  // {attempt, mode, s, f} con lo que necesita fetchCastsTimeline.
  async function findKillAttemptIndex(reportId, bossHtml, playerName) {
    let killLinks = [];
    try {
      const allLinks = await fetchKillLinksFromReportPage(reportId);
      killLinks = allLinks.filter((l) => l.boss === bossHtml);
    } catch (err) {
      console.log(`Rotation analysis — could not fetch/parse report_page for kill-links (falling back to report_segments): ${err.message}`);
    }

    if (killLinks.length) {
      const sorted = killLinks.slice().sort((a, b) => {
        const pa = MODE_PRIORITY.indexOf(a.mode);
        const pb = MODE_PRIORITY.indexOf(b.mode);
        return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
      });
      const chosen = sorted[0];
      console.log(`Rotation analysis — kill-links found for boss "${bossHtml}" (preferring Heroic):\n` + JSON.stringify({ reportId, bossHtml, killLinks, chosen }, null, 2));
      return { attempt: chosen.attempt, mode: chosen.mode, s: chosen.s, f: chosen.f };
    }

    // Fallback: método viejo (JSON de report_segments, sin dificultad).
    // Solo se usa si no pudimos traer/parsear la página HTML.
    const resp = await fetch(`/api/report_segments/${reportId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ boss: bossHtml }),
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      throw new Error(friendlyUpstreamError('report_segments', resp.status, detail));
    }
    const segments = await resp.json();
    if (!Array.isArray(segments) || !segments.length) throw new Error('No attempts recorded for this boss in the report');
    const killIndex = segments.findIndex((s) => /kill/i.test(s));
    const chosenIndex = killIndex >= 0 ? killIndex : segments.length - 1;
    console.log(`Rotation analysis — FALLBACK report_segments (no difficulty info) for boss "${bossHtml}":\n` + JSON.stringify({
      reportId, bossHtml, segments, chosenIndex, chosenSegment: segments[chosenIndex],
    }, null, 2));
    return { attempt: chosenIndex, mode: null, s: null, f: null };
  }

  async function fetchCastsTimeline(reportId, bossHtml, attemptInfo, playerName) {
    const info = typeof attemptInfo === 'object' && attemptInfo !== null ? attemptInfo : { attempt: attemptInfo };
    const body = { boss: bossHtml, attempt: info.attempt, name: playerName };
    if (info.mode != null) body.mode = info.mode;
    if (info.s != null) body.s = info.s;
    if (info.f != null) body.f = info.f;
    const resp = await fetch(`/api/report_casts/${reportId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      throw new Error(friendlyUpstreamError('report_casts', resp.status, detail));
    }
    return resp.json();
  }

  async function fetchEncounterReportPage(reportId, bossHtml, attemptInfo) {
    const info = typeof attemptInfo === 'object' && attemptInfo !== null ? attemptInfo : { attempt: attemptInfo };
    const params = new URLSearchParams();
    if (bossHtml != null) params.set('boss', bossHtml);
    if (info.mode != null) params.set('mode', info.mode);
    if (info.attempt != null) params.set('attempt', String(info.attempt));
    if (info.s != null) params.set('s', String(info.s));
    if (info.f != null) params.set('f', String(info.f));
    const resp = await fetch(`/api/report_page/${encodeURIComponent(reportId)}?${params.toString()}`);
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      throw new Error(friendlyUpstreamError('report_page', resp.status, detail));
    }
    return resp.text();
  }

  function parseReportPlayers(html, reportId) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const players = [];
    const seen = new Set();
    const classBySlug = Object.entries(CLASS_MAP).reduce((acc, [classI, info]) => {
      acc[info.name.toLowerCase().replace(/\s+/g, '-')] = { classI: Number(classI), color: info.color };
      return acc;
    }, {});
    doc.querySelectorAll('a[href*="/player/"]').forEach((a) => {
      const href = (a.getAttribute('href') || '').replace(/&amp;/g, '&');
      const match = href.match(/\/reports\/([^/]+)\/player\/([^/?#]+)\/?/i);
      if (!match || decodeURIComponent(match[1]) !== reportId) return;
      const rawName = decodeURIComponent(match[2]);
      // Overall report tables link real players by name. Pet/unit pages use
      // GUIDs (0xF...), which must not become rows in the raid replay.
      if (!rawName || /^0x[0-9a-f]+$/i.test(rawName)) return;
      const key = rawName.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      const classToken = [...a.classList].find((c) => classBySlug[c]);
      const classMeta = classToken ? classBySlug[classToken] : null;
      players.push({ name: rawName, classI: classMeta?.classI ?? null, color: classMeta?.color ?? null });
    });
    return players;
  }

  function parseReportPlayerNames(html, reportId) {
    return parseReportPlayers(html, reportId).map((p) => p.name);
  }

  function getRosterPlayersForReport(reportId, bossName) {
    const server = config.server || $('serverInput').value.trim();
    const seen = new Set();
    const out = [];
    config.members.forEach((m) => {
      const entry = dataCache[memberKey(server, m.name, m.spec)];
      if (!entry || entry.status !== 'done' || !entry.data) return;
      const bossData = findBossData(entry.data.bosses, bossName);
      if (!bossData || bossData.report_id !== reportId) return;
      const key = m.name.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      const cls = CLASS_MAP[entry.data.class_i];
      const specInfo = getSpecInfo(entry.data.class_i, m.spec);
      out.push({ name: m.name, classI: entry.data.class_i, color: cls ? cls.color : null, spec: Number(m.spec), role: specInfo.role });
    });
    return out;
  }

  async function fetchDpsSeries(reportId, bossHtml, attemptInfo, playerName, sec = 1) {
    const info = typeof attemptInfo === 'object' && attemptInfo !== null ? attemptInfo : { attempt: attemptInfo };
    // uwu-logs get_dps_wrap checks `if not attempt`; sending "0" (string)
    // keeps attempt zero valid, while numeric 0 would be rejected upstream.
    const body = {
      boss: bossHtml,
      attempt: String(info.attempt ?? 0),
      player_name: playerName,
      sec: String(sec),
    };
    if (info.mode != null) body.mode = info.mode;
    if (info.s != null) body.s = info.s;
    if (info.f != null) body.f = info.f;
    const resp = await fetch(`/api/report_dps/${encodeURIComponent(reportId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      throw new Error(friendlyUpstreamError('report_dps', resp.status, detail));
    }
    return resp.json();
  }

  async function fetchDpsSeriesWithAttemptFallback(reportId, bossHtml, preferredAttempt, playerName, sec = 1) {
    const candidates = [];
    const seen = new Set();
    const add = (info) => {
      if (!info || info.attempt == null) return;
      const key = String(info.attempt);
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push(info);
    };
    add(preferredAttempt);

    // The URL attempt normally matches ENCOUNTER_DATA's index, but older or
    // unusual reports can disagree. Discover every attempt advertised by the
    // report page and try those only when the preferred one returns no data.
    try {
      const allLinks = await fetchKillLinksFromReportPage(reportId);
      allLinks.filter((l) => l.boss === bossHtml).forEach(add);
    } catch (_) { /* preferred attempt is still enough for the normal path */ }

    const errors = [];
    for (const info of candidates) {
      try {
        const raw = await fetchDpsSeries(reportId, bossHtml, info, playerName, sec);
        if (raw && typeof raw === 'object' && Object.keys(raw).length) {
          return { raw, attempt: info };
        }
        errors.push(`attempt ${info.attempt}: empty series`);
      } catch (err) {
        errors.push(`attempt ${info.attempt}: ${err.message}`);
      }
    }
    throw new Error(`${playerName}: ${errors.join('; ') || 'no valid attempts found'}`);
  }

  function replayTimeKeyToSecond(key) {
    const m = String(key).match(/^(\d+):(\d+)$/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : Number(key) || 0;
  }

  function normalizeReplaySeries(raw) {
    const points = {};
    Object.entries(raw || {}).forEach(([k, v]) => {
      points[replayTimeKeyToSecond(k)] = Number(v) || 0;
    });
    return points;
  }

  async function mapWithConcurrency(items, limit, mapper) {
    const results = new Array(items.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const i = cursor++;
        try { results[i] = await mapper(items[i], i); }
        catch (error) { results[i] = { error, item: items[i] }; }
      }
    });
    await Promise.all(workers);
    return results;
  }

  async function fetchRaidReplay(reportId, bossName, playerName) {
    const bossHtml = bossNameToHtml(bossName);
    const attempt = await findKillAttemptIndex(reportId, bossHtml, playerName);
    if (!playerName) throw new Error('No player is selected for this replay');

    // Keep network load bounded: up to 20 encounter players. Known healers
    // are excluded using roster/spec metadata; players whose role is unknown
    // are kept rather than risking false exclusions.
    let reportPlayers = [];
    try {
      const reportHtml = await fetchEncounterReportPage(reportId, bossHtml, attempt);
      reportPlayers = parseReportPlayers(reportHtml, reportId);
    } catch (_) { /* roster fallback below */ }
    if (!reportPlayers.length) {
      reportPlayers = getRosterPlayersForReport(reportId, bossName);
    }

    const rosterPlayers = getRosterPlayersForReport(reportId, bossName);
    const rosterByName = new Map(rosterPlayers.map((p) => [p.name.toLowerCase(), p]));
    const selectedKey = String(playerName).toLowerCase();
    const isKnownHealer = (name) => rosterByName.get(String(name).toLowerCase())?.role === 'Healing';
    const reportNames = reportPlayers.map((p) => p.name).filter((name) => !isKnownHealer(name));
    const candidates = [
      ...(isKnownHealer(playerName) ? [] : [playerName]),
      ...reportNames.filter((n) => String(n).toLowerCase() !== selectedKey),
    ].filter((name, i, arr) => arr.findIndex((n) => n.toLowerCase() === name.toLowerCase()) === i).slice(0, 20);
    if (!candidates.length) throw new Error('No DPS players were identified for this encounter');
    const cacheKey = `${reportId}::${bossHtml}::${attempt.attempt}::top20dps::${candidates.map((n) => n.toLowerCase()).join(',')}`;
    if (raidReplayCache[cacheKey]) return raidReplayCache[cacheKey];

    const fetched = await mapWithConcurrency(candidates, 3, async (name) => {
      const result = await fetchDpsSeriesWithAttemptFallback(reportId, bossHtml, attempt, name, 1);
      const series = normalizeReplaySeries(result.raw);
      if (!Object.keys(series).length) throw new Error(`${name}: empty DPS series`);
      const maxSecond = Math.max(...Object.keys(series).map(Number));
      const values = Array.from({ length: maxSecond + 1 }, (_, sec) => series[sec] || 0);
      const cumulative = [];
      let total = 0;
      values.forEach((value, sec) => {
        total += value;
        cumulative[sec] = total;
      });
      const roster = rosterByName.get(name.toLowerCase());
      const reportPlayer = reportPlayers.find((p) => p.name.toLowerCase() === name.toLowerCase());
      return {
        name, series, values, cumulative, maxSecond,
        color: roster?.color || reportPlayer?.color || '#6f7683',
        classI: roster?.classI ?? reportPlayer?.classI ?? null,
        attempt: result.attempt,
      };
    });

    const players = fetched.filter((r) => r && !r.error && r.values && r.values.length);
    if (!players.length) {
      const details = fetched.filter((r) => r?.error).slice(0, 3).map((r) => r.error.message).join(' | ');
      throw new Error(`UwU Logs returned no DPS series for these players${details ? ` — ${details}` : ''}`);
    }

    const maxSecond = Math.max(...players.map((p) => p.maxSecond));
    const result = { reportId, bossName, bossHtml, attempt, players, maxSecond, requestedPlayers: candidates.length };
    raidReplayCache[cacheKey] = result;
    return result;
  }

  async function fetchPlayerDamagePage(reportId, bossHtml, attemptInfo, playerName) {
    const info = typeof attemptInfo === 'object' && attemptInfo !== null ? attemptInfo : { attempt: attemptInfo };
    const params = new URLSearchParams();
    if (bossHtml != null) params.set('boss', bossHtml);
    if (info.mode != null) params.set('mode', info.mode);
    if (info.attempt != null) params.set('attempt', String(info.attempt));
    if (info.s != null) params.set('s', String(info.s));
    if (info.f != null) params.set('f', String(info.f));
    const url = `/api/report_player_page/${encodeURIComponent(reportId)}/${encodeURIComponent(playerName)}?${params.toString()}`;
    const resp = await fetch(url);
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      throw new Error(friendlyUpstreamError('report_player_page', resp.status, detail));
    }
    return resp.text();
  }

  function parseNumberCell(text) {
    const digits = String(text || '').replace(/[^0-9-]/g, '');
    return digits ? Number(digits) : 0;
  }


  function parsePlayerDamageBreakdownHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const rows = Array.from(doc.querySelectorAll('#dmg-done-main > table > tbody > tr'));
    if (!rows.length) throw new Error('Damage table not found in player page');

    const entries = rows.map((row) => {
      const cells = Array.from(row.querySelectorAll(':scope > td'));
      const spellAnchor = cells[0] && cells[0].querySelector('a[href*="/spell/"]');
      const spellHref = spellAnchor ? (spellAnchor.getAttribute('href') || '') : '';
      const spellIdMatch = spellHref.match(/\/spell\/(\d+)\/?/);
      const spellId = spellIdMatch ? spellIdMatch[1] : null;
      const name = (cells[0] && cells[0].textContent || '').replace(/\s+/g, ' ').trim();
      const pctText = (cells[1] && cells[1].textContent || '').trim();
      return {
        name,
        spellId,
        pct: Number.parseFloat(pctText.replace(',', '.')) || 0,
        damage: parseNumberCell(cells[2] && cells[2].textContent),
        casts: parseNumberCell(cells[5] && cells[5].textContent),
        other: parseNumberCell(cells[6] && cells[6].textContent),
        directTotal: parseNumberCell(cells[7] && cells[7].textContent),
        directHits: parseNumberCell(cells[8] && cells[8].textContent),
        directCrits: parseNumberCell(cells[10] && cells[10].textContent),
        periodicTotal: parseNumberCell(cells[13] && cells[13].textContent),
        periodicHits: parseNumberCell(cells[14] && cells[14].textContent),
        periodicCrits: parseNumberCell(cells[16] && cells[16].textContent),
      };
    }).filter((r) => r.name && r.damage > 0)
      .sort((a, b) => b.damage - a.damage);

    const totalDamageCell = doc.querySelector('#dmg-done-main > table > tfoot > tr > td:nth-child(3)');
    const totalDamage = parseNumberCell(totalDamageCell && totalDamageCell.textContent)
      || entries.reduce((sum, r) => sum + r.damage, 0);
    return { totalDamage, entries };
  }

  // La página HTML de Damage sí agrega el daño hecho por las mascotas del
  // jugador. Tomamos la columna Actual -> Amount y agrupamos las filas por
  // el nombre de la pet que UwU Logs agrega entre paréntesis.
  function parsePlayerPetDamageHtml(html, ghoulName) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const rows = Array.from(doc.querySelectorAll('#dmg-done-main > table > tbody > tr'));
    if (!rows.length) throw new Error('Damage table not found in player page');

    const spellRows = rows.map((row) => {
      const cells = Array.from(row.querySelectorAll(':scope > td'));
      const spellAnchor = cells[0] && cells[0].querySelector('a[href*="/spell/"]');
      const spellHref = spellAnchor ? (spellAnchor.getAttribute('href') || '') : '';
      const spellIdMatch = spellHref.match(/\/spell\/(\d+)\/?/);
      const spellId = spellIdMatch ? spellIdMatch[1] : null;
      const name = (cells[0] && cells[0].textContent || '').replace(/\s+/g, ' ').trim();
      return {
        name,
        spellId,
        damage: parseNumberCell(cells[2] && cells[2].textContent),
        casts: parseNumberCell(cells[5] && cells[5].textContent),
        other: parseNumberCell(cells[6] && cells[6].textContent),
        directTotal: parseNumberCell(cells[7] && cells[7].textContent),
        directHits: parseNumberCell(cells[8] && cells[8].textContent),
        directCrits: parseNumberCell(cells[10] && cells[10].textContent),
      };
    }).filter((r) => r.name);

    const totalDamageCell = doc.querySelector('#dmg-done-main > table > tfoot > tr > td:nth-child(3)');
    const playerTotalDamage = parseNumberCell(totalDamageCell && totalDamageCell.textContent);
    // Language-independent: Gargoyle Strike is spell 51963 in WotLK logs.
    // Keep the English-name fallback for old/synthetic pages without spell hrefs.
    const gargoyleRows = spellRows.filter((r) => r.spellId === '51963');
    const armyRows = spellRows.filter((r) => /\(Army of the Dead Ghoul\)/i.test(r.name));
    // Prefer the name discovered from Raise Dead, but UwU Logs also exposes
    // the permanent ghoul directly in the Damage table as e.g. Melee (Ratgobbler).
    // This fallback is important when Raise Dead happened before the encounter
    // slice and therefore its summon event is absent from report_casts.
    let detectedGhoulName = ghoulName || null;
    if (!detectedGhoulName) {
      const meleePetRow = spellRows.find((r) => {
        const m = r.name.match(/^Melee\s*\(([^)]+)\)$/i);
        if (!m) return false;
        const pet = m[1].trim();
        return !/^(Ebon Gargoyle|Army of the Dead Ghoul)$/i.test(pet);
      });
      if (meleePetRow) {
        const m = meleePetRow.name.match(/^Melee\s*\(([^)]+)\)$/i);
        detectedGhoulName = m ? m[1].trim() : null;
      }
    }
    const escapedGhoul = detectedGhoulName ? detectedGhoulName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : null;
    const ghoulRegex = escapedGhoul ? new RegExp(`\\(${escapedGhoul}\\)`, 'i') : null;
    const ghoulRows = ghoulRegex ? spellRows.filter((r) => ghoulRegex.test(r.name)) : [];


    const aggregate = (matchedRows) => ({
      damage: matchedRows.reduce((sum, r) => sum + r.damage, 0),
      casts: matchedRows.reduce((sum, r) => sum + r.casts, 0),
      hits: matchedRows.reduce((sum, r) => sum + r.directTotal, 0),
      rows: matchedRows,
    });

    const gargoyleUnitIds = Array.from(doc.querySelectorAll('#pets-dropdown a'))
      .map((a) => {
        const href = a.getAttribute('href') || '';
        const m = href.match(/\/player\/([^/]+)\/?/);
        if (!m) return null;
        const unitId = decodeURIComponent(m[1]);
        const label = (a.textContent || '').trim();
        // Ebon Gargoyle NPC id = 27829 = 0x6CB5. UwU unit GUIDs include
        // that NPC id (e.g. 0xF130006CB5...), regardless of log language.
        const isGargoyleGuid = /^0xF130006CB5/i.test(unitId);
        return isGargoyleGuid ? unitId : null;
      })
      .filter(Boolean);

    return {
      playerTotalDamage,
      gargoyle: aggregate(gargoyleRows),
      ghoul: aggregate(ghoulRows),
      ghoulName: detectedGhoulName,
      armyOfTheDead: aggregate(armyRows),
      gargoyleUnitIds,
    };
  }

  // Damage page de una entidad individual (por ejemplo un GUID de Ebon
  // Gargoyle). Se usa para separar el daño de Gargoyle #1/#2/#3 cuando el
  // encounter tiene más de una invocación.
  function parseUnitDamageHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const rows = Array.from(doc.querySelectorAll('#dmg-done-main > table > tbody > tr'));
    const spellRows = rows.map((row) => {
      const cells = Array.from(row.querySelectorAll(':scope > td'));
      const spellAnchor = cells[0] && cells[0].querySelector('a[href*="/spell/"]');
      const spellHref = spellAnchor ? (spellAnchor.getAttribute('href') || '') : '';
      const spellIdMatch = spellHref.match(/\/spell\/(\d+)\/?/);
      const spellId = spellIdMatch ? spellIdMatch[1] : null;
      const name = (cells[0] && cells[0].textContent || '').replace(/\s+/g, ' ').trim();
      return {
        name,
        spellId,
        damage: parseNumberCell(cells[2] && cells[2].textContent),
        casts: parseNumberCell(cells[5] && cells[5].textContent),
        hits: parseNumberCell(cells[7] && cells[7].textContent),
      };
    }).filter((r) => r.name);
    const gargoyleStrikeRows = spellRows.filter((r) => r.spellId === '51963');
    const selected = gargoyleStrikeRows.length ? gargoyleStrikeRows : spellRows;
    return {
      damage: selected.reduce((sum, r) => sum + r.damage, 0),
      casts: selected.reduce((sum, r) => sum + r.casts, 0),
      hits: selected.reduce((sum, r) => sum + r.hits, 0),
      rows: selected,
    };
  }

  // Config de análisis por clase (raw.CLASS, ej. "death-knight", "warlock").

  function summarizeDkTimeline(raw) {
    const rotationCfg = CLASS_ROTATION_CONFIG[(raw.CLASS || '').toLowerCase()] || DEFAULT_ROTATION_CONFIG;
    const summary = { totalEvents: 0, uniqueSpells: 0, spellCounts: [], uptimes: [], gcdDelayMs: null, gargoyle: null, gargoyleMeta: rotationCfg.cooldownSnapshot, castNotes: [], timeline: [], raw };
    try {
      const rawDataBySpell = raw.DATA || raw.data || {};
      // El endpoint report_casts a veces devuelve eventos del JEFE ANTERIOR
      // en el mismo reporte (confirmado: contra Lord Jaraxxus llegaron
      // eventos con target "Icehowl", de Northrend Beasts, con timestamps
      // muy negativos). Recortamos todo a los últimos 15s antes del pull —
      // mismo criterio que ya usa el Timeline — así el Resumen (conteos,
      // uptimes, GCD delay, notas de spam) no queda contaminado con datos
      // de otro encuentro.
      const PREPULL_WINDOW_MS = 15000;
      const dataBySpell = {};
      Object.keys(rawDataBySpell).forEach((id) => {
        const events = rawDataBySpell[id];
        dataBySpell[id] = Array.isArray(events) ? events.filter((ev) => ev[0] >= -PREPULL_WINDOW_MS) : events;
      });
      const spellInfo = raw.SPELLS || raw.spells || {};
      const displayNameForId = (id) => (spellInfo[id] && (spellInfo[id].name || spellInfo[id].NAME)) || `Spell #${id}`;
      const spellIds = Object.keys(dataBySpell);
      const fightMs = (raw.RDURATION || 0) * 1000;
      const selfName = raw.NAME;
      // Nombre -> ícono (ej. "inv_sword_04"), para mostrar el ícono real
      // de cada hechizo/buff en el timeline.
      const iconByName = {};
      const iconById = {};
      spellIds.forEach((id) => {
        const info = spellInfo[id];
        const name = info && (info.name || info.NAME);
        const icon = info && (info.icon || info.ICON);
        if (name && icon && !iconByName[name]) iconByName[name] = icon;
        if (icon && !iconById[id]) iconById[id] = icon;
      });

      summary.uniqueSpells = spellIds.length;
      summary.spellCounts = spellIds
        .map((id) => {
          // El endpoint pool-ea eventos de TODOS los jugadores que castearon
          // este spell ID bajo la misma entrada (confirmado con Horn of
          // Winter: aparecen otros nombres de source mezclados). Filtramos
          // por vos ANTES de contar, si no el número incluye casteos ajenos.
          const events = Array.isArray(dataBySpell[id]) ? dataBySpell[id] : [];
          const selfEvents = events.filter((ev) => ev[2] === selfName);
          return {
            id,
            name: (spellInfo[id] && (spellInfo[id].name || spellInfo[id].NAME)) || `Spell #${id}`,
            count: selfEvents.length,
            hasSelfEvent: selfEvents.length > 0,
          };
        })
        .filter((s) => s.hasSelfEvent)
        .sort((a, b) => b.count - a.count);
      summary.totalEvents = summary.spellCounts.reduce((sum, s) => sum + s.count, 0);

      // Filtro clave: solo miramos auras que VOS te aplicaste (fuente del
      // SPELL_AURA_APPLIED === tu propio nombre). Un buff de otro jugador
      // viene con esa otra persona como fuente; eso ya nos lo saca de encima
      // sin necesidad de una lista interminable de nombres a mano.
      // Formato de cada evento: [ms, flag, source, target, target_guid, detalle]
      //
      // OJO con el target: un buff que te ponés a vos mismo (Bone Shield) y
      // un DoT que le ponés al BOSS (Corruption, Blood Plague) son ambos
      // "self-sourced", pero el primero tiene target=vos y el segundo
      // target=boss. Un buff raid-wide (Horn of Winter) tiene VARIOS
      // targets (cada miembro del raid). Por eso: si entre los targets está
      // tu propio nombre, usamos esa serie (nos interesa el buff EN VOS); si
      // no, usamos el target no-vos con más tiempo activo total (el boss
      // real, no un add de paso).
      const intervalsByName = {}; // name -> [[start,end], ...]
      const intervalsById = {}; // id (string) -> [[start,end], ...] — inmune al idioma del log
      // Excepción puntual: Bloodlust/Heroism son cooldowns de grupo que
      // valen la pena ver aunque los tire el Shaman, no vos — todo lo
      // demás que te tiran otros jugadores (Bendición de Reyes,
      // Fortaleza, Luminosidad Arcana, Don de lo Salvaje, auras de
      // Paladín, etc.) se sigue excluyendo a propósito, igual que antes.
      const RAID_COOLDOWN_WHITELIST_IDS = new Set(['2825', '32182']); // Bloodlust, Heroism
      // Some personal procs (notably weapon runeforges) are represented by
      // UwU Logs with a source that is not exactly the character name. They
      // are still unambiguously personal when target === self. Do not discard
      // them before building intervals.
      const SELF_TARGET_PERSONAL_BUFF_IDS = new Set(['49222', '53365', '53760']); // Bone Shield, Unholy Strength, Flask of Endless Rage
      spellIds.forEach((id) => {
        const events = dataBySpell[id];
        if (!Array.isArray(events)) return;
        // A proc can refresh while it is already active. Treat REFRESH as an
        // activation signal too; this is particularly important for Unholy
        // Strength (Fallen Crusader), which can re-proc before the 15s aura
        // expires.
        const auraEvents = events.filter((ev) => ['SPELL_AURA_APPLIED', 'SPELL_AURA_REFRESH', 'SPELL_AURA_REMOVED'].includes(ev[1]));
        const appliedEvents = auraEvents.filter((ev) => ev[1] === 'SPELL_AURA_APPLIED' || ev[1] === 'SPELL_AURA_REFRESH');
        const isBoneShield = String(id) === '49222';
        // Bone Shield is commonly pre-cast before the pull. In that case the
        // segment may contain only SPELL_AURA_REMOVED when the last charge is
        // consumed. Do not discard the spell just because APPLIED happened
        // outside the captured segment.
        if (!appliedEvents.length && !(isBoneShield && auraEvents.length)) return;
        const sourceCheckEvents = appliedEvents.length ? appliedEvents : auraEvents;
        const isSelfSourced = sourceCheckEvents.every((ev) => ev[2] === selfName);
        const isKnownSelfTargetPersonalBuff = SELF_TARGET_PERSONAL_BUFF_IDS.has(String(id))
          && sourceCheckEvents.some((ev) => ev[3] === selfName);
        if (!isSelfSourced && !isKnownSelfTargetPersonalBuff && !RAID_COOLDOWN_WHITELIST_IDS.has(String(id))) return; // buff/debuff de otro jugador o del boss

        const name = (spellInfo[id] && spellInfo[id].name) || `Spell #${id}`;

        const buildIntervals = (evs, inferActiveAtPull = false) => {
          const sorted = [...evs].sort((a, b) => Number(a[0]) - Number(b[0]));
          const firstAuraEvent = sorted.find((ev) => ['SPELL_AURA_APPLIED', 'SPELL_AURA_REFRESH', 'SPELL_AURA_REMOVED'].includes(ev[1]));
          // If the first Bone Shield evidence in the segment is REMOVED, the
          // application necessarily happened before the pull, so count it as
          // active from t=0 until that removal.
          let upSince = inferActiveAtPull && firstAuraEvent && firstAuraEvent[1] === 'SPELL_AURA_REMOVED' ? 0 : null;
          let totalUp = 0;
          const intervals = [];
          sorted.forEach((ev) => {
            const [ms, flag] = ev;
            if (flag === 'SPELL_AURA_APPLIED' || flag === 'SPELL_AURA_REFRESH') {
              if (upSince === null) upSince = ms;
            } else if (flag === 'SPELL_AURA_REMOVED') {
              if (upSince !== null) {
                totalUp += ms - upSince;
                intervals.push([upSince, ms]);
                upSince = null;
              }
            }
          });
          if (upSince !== null && fightMs) {
            totalUp += fightMs - upSince;
            intervals.push([upSince, fightMs]);
          }
          return { intervals, totalUp };
        };

        const selfEvents = events.filter((ev) => ev[3] === selfName);
        let chosen;
        if (selfEvents.length) {
          chosen = buildIntervals(selfEvents, isBoneShield);
        } else {
          const byTarget = {};
          events.forEach((ev) => {
            const target = ev[3];
            (byTarget[target] = byTarget[target] || []).push(ev);
          });
          let best = null;
          Object.keys(byTarget).forEach((target) => {
            const candidate = buildIntervals(byTarget[target], isBoneShield && target === selfName);
            if (!best || candidate.totalUp > best.totalUp) best = candidate;
          });
          chosen = best || { intervals: [], totalUp: 0 };
        }
        intervalsByName[name] = chosen.intervals;
        intervalsById[id] = chosen.intervals;

        if (fightMs) {
          let category = 'other';
          const byId = (list) => Array.isArray(list) && list.includes(String(id));
          if (byId(rotationCfg.rotationSpellIds)) category = 'rotation';
          else if (rotationCfg.cooldownSnapshot && byId(rotationCfg.cooldownSnapshot.uptimeSpellIds)) category = 'gargoyle';
          summary.uptimes.push({ id, name, pct: Math.min(100, (chosen.totalUp / fightMs) * 100), category });
        }
      });
      // Orden fijo en Rotation (el mismo de tu ejemplo), el resto por %.
      // rotationSpellIds es el fallback inmune al idioma del log — si el
      // nombre no matchea (log en otro idioma) pero el ID sí, usamos esa
      // posición para no perder el orden fijo.
      const rotationRank = (u) => {
        return Array.isArray(rotationCfg.rotationSpellIds) ? rotationCfg.rotationSpellIds.indexOf(String(u.id)) : -1;
      };
      summary.uptimes.sort((a, b) => {
        if (a.category === 'rotation' && b.category === 'rotation') {
          return rotationRank(a) - rotationRank(b);
        }
        return b.pct - a.pct;
      });

      // DIAGNÓSTICO TEMPORAL — para armar un matching por spell ID que no
      // dependa del idioma del log (ver conversación sobre logs en español
      // vs inglés). Corriendo esto sobre un log en INGLÉS (que ya sabemos
      // que funciona bien) da los IDs reales de cada nombre tal como los
      // devuelve ESTE servidor — más confiable que buscarlos en wikis
      // externas, que pueden tener rangos/versiones distintas. Sacar esta
      // línea una vez que rotation-config.js/frost-dk.js migren a IDs.
      console.log(`Rotation analysis — spell ID map (name -> id) for "${raw.NAME}":`, JSON.stringify(
        Object.fromEntries(spellIds.map((id) => [(spellInfo[id] && spellInfo[id].name) || `Spell #${id}`, id])),
        null, 2,
      ));

      // GCD delay: juntamos todos los SPELL_CAST_SUCCESS de todos los
      // hechizos (son casteos reales, no swings de melee ni ticks), los
      // ordenamos por tiempo, y medimos el hueco entre casteos seguidos.
      // Como no sabemos la duración exacta del GCD del personaje (depende
      // de haste), usamos el hueco MÁS CHICO observado como aproximación
      // del GCD real, y consideramos "delay" lo que hay de más en cada
      // hueco por encima de eso. Es una aproximación, no un cálculo exacto.
      const allCasts = [];
      const castsBySpellName = {};
      const castsBySpellId = {}; // fallback inmune al idioma del log
      // Buffs propios activos en el instante ms, usando los intervalos ya
      // armados arriba (self-sourced únicamente, igual que el resto del análisis).
      const procDefs = rotationCfg.procDefs || [];
      const excludedBuffIds = new Set((rotationCfg.timelineBuffExcludeSpellIds || []).map(String));
      const buffsActiveAt = (ms) => Object.keys(intervalsById)
        .filter((id) => !excludedBuffIds.has(String(id)))
        .filter((id) => intervalsById[id].some(([s, e]) => ms >= s && ms <= e))
        .map((id) => ({ name: displayNameForId(id), icon: iconById[id] || null }));
      // Un proc se muestra en la fila del casteo que lo CONSUME (no en
      // cada fila donde el buff está activo): si este cast (por id) es un
      // "spender" del proc, el buff estaba activo en ese instante, Y este
      // es el ÚLTIMO casteo dentro de esa ventana — el que realmente la
      // cierra (si hay varios casteos dentro de una misma ventana, solo
      // el último la consume de verdad; mismo criterio que frost-dk.js).
      const procsUsedAt = (ms, castId) => procDefs
        .filter((d) => d.spenderIds.includes(String(castId)))
        .filter((d) => {
          const interval = (intervalsById[d.buffId] || []).find(([s, e]) => ms >= s && ms <= e);
          if (!interval) return false;
          const [s, e] = interval;
          const spenderCastsInWindow = d.spenderIds
            .flatMap((sid) => castsBySpellId[sid] || [])
            .filter((t) => t >= s && t <= e);
          return spenderCastsInWindow.length > 0 && Math.max(...spenderCastsInWindow) === ms;
        })
        .map((d) => ({ name: d.label, icon: iconById[d.buffId] || null }));
      // {ms, name, icon, buffs, rp, runes} — timeline completo del intento, del
      // segundo 0 al final. rp (poder rúnico) y runes todavía no se calculan:
      // el combat log no trae el estado de recursos por evento con lo que
      // tenemos hoy del proxy.
      //
      // Ojo: los hechizos instantáneos traen SPELL_CAST_SUCCESS, pero los que
      // tienen tiempo de cast (ej. Shadow Bolt, Haunt) NO traen ese evento en
      // este formato — solo SPELL_CAST_START, y después el SPELL_DAMAGE
      // cuando pega. Por eso decidimos QUÉ flag cuenta como "casteo" por
      // hechizo: si aparece SPELL_CAST_SUCCESS para ese ID lo usamos (más
      // preciso, marca cuando termina); si no, usamos SPELL_CAST_START.
      const timelineEntries = [];
      // PRIMERA PASADA: solo juntar los casteos propios de cada hechizo
      // (castsBySpellName/castsBySpellId). Separado de la segunda pasada
      // a propósito: procsUsedAt necesita conocer TODOS los casteos de
      // Obliterate/Frost Strike de la pelea entera para decidir cuál de
      // ellos cierra cada ventana de proc — si lo calculáramos casteo a
      // casteo en un solo pase, todavía no tendríamos los casteos futuros
      // de un hechizo que se procesa más adelante en spellIds.forEach.
      const castEventsBySpell = {}; // id -> [{ms, target}, ...] ya resueltos, para no repetir el trabajo en la 2da pasada
      spellIds.forEach((id) => {
        const name = (spellInfo[id] && spellInfo[id].name) || `Spell #${id}`;
        const events = (dataBySpell[id] || []).slice().sort((a, b) => a[0] - b[0]);
        const hasCastSuccess = events.some((ev) => ev[1] === 'SPELL_CAST_SUCCESS' && ev[2] === selfName);
        const castFlag = hasCastSuccess ? 'SPELL_CAST_SUCCESS' : 'SPELL_CAST_START';
        const resolved = [];
        events.forEach((ev, idx) => {
          if (ev[1] === castFlag && ev[2] === selfName) {
            let target = ev[3];
            // SPELL_CAST_START no trae target real (viene "nil") para
            // hechizos con tiempo de cast — lo sacamos del próximo evento de
            // ESTE MISMO hechizo que sí tenga uno (normalmente el
            // SPELL_DAMAGE/SPELL_MISSED cuando termina de castear).
            if (!target || target === 'nil') {
              for (let j = idx + 1; j < events.length; j++) {
                const nextEv = events[j];
                if (nextEv[1] === castFlag && nextEv[2] === selfName) break; // llegamos al próximo casteo sin encontrar target
                if (nextEv[3] && nextEv[3] !== 'nil') { target = nextEv[3]; break; }
              }
            }
            allCasts.push(ev[0]);
            (castsBySpellName[name] = castsBySpellName[name] || []).push(ev[0]);
            (castsBySpellId[id] = castsBySpellId[id] || []).push(ev[0]);
            resolved.push({ ms: ev[0], target: (target && target !== 'nil') ? target : null });
          }
        });
        if (resolved.length) castEventsBySpell[id] = resolved;
      });
      // SEGUNDA PASADA: ahora que castsBySpellId ya está completo para
      // TODOS los hechizos, recién acá armamos cada fila del timeline —
      // buffsActiveAt/procsUsedAt necesitan ese panorama completo.
      Object.keys(castEventsBySpell).forEach((id) => {
        const name = (spellInfo[id] && spellInfo[id].name) || `Spell #${id}`;
        castEventsBySpell[id].forEach(({ ms, target }) => {
          timelineEntries.push({ ms, id, name, icon: iconByName[name] || null, target, buffs: buffsActiveAt(ms), procs: procsUsedAt(ms, id), rp: null, runes: null });
        });
      });
      allCasts.sort((a, b) => a - b);
      timelineEntries.sort((a, b) => a.ms - b.ms);
      summary.timeline = timelineEntries;
      if (allCasts.length > 3) {
        const gaps = [];
        for (let i = 1; i < allCasts.length; i++) gaps.push(allCasts[i] - allCasts[i - 1]);
        const usableGaps = gaps.filter((g) => g > 200); // ignoramos huecos casi 0 (dobles registros o spam de macro)
        if (usableGaps.length) {
          const minGap = Math.min(...usableGaps);
          const delays = usableGaps.map((g) => Math.max(0, g - minGap));
          summary.gcdDelayMs = delays.reduce((s, d) => s + d, 0) / delays.length;
          summary.estimatedGcdMs = minGap;
        }
      }

      // Casteos que nos interesa contar en vez de uptime-ar (ej. Horn of
      // Winter: si lo casteás muchísimas veces de más, suele ser spam de
      // macro en vez de recastearlo solo cuando se cae el buff).
      // castCountSpellIds es el fallback por ID, inmune al idioma del log —
      // mismo orden que castCountSpells si está definido para esa clase.
      (rotationCfg.castCountSpellIds || []).forEach((spellId, i) => {
        const times = castsBySpellId[String(spellId)] || [];
        if (times.length) {
          summary.castNotes.push({
            name: displayNameForId(spellId),
            count: times.length,
            macroSpam: times.length >= rotationCfg.macroSpamThreshold,
          });
        }
      });

      // Cooldown snapshot (ej. Gárgola para DK): cuántas veces se usó, qué
      // buffs de snapshot estaban activos en el momento exacto de cada uso,
      // y si hubo un casteo de seguimiento poco después (ej. cambio de
      // presencia). Solo aplica a clases con cooldownSnapshot definido.
      // *SpellId(s) son el fallback inmune al idioma — quedan sin definir
      // en la config para los hechizos que todavía no confirmamos contra
      // datos reales (ver frost-dk.js para el porqué de esta precaución).
      const snap = rotationCfg.cooldownSnapshot;
      if (snap) {
        const summonTimes = snap.summonSpellId ? (castsBySpellId[String(snap.summonSpellId)] || []) : [];
        if (summonTimes.length) {
          const isActiveAtId = (id, t) => id && (intervalsById[String(id)] || []).some(([s, e]) => t >= s && t <= e);
          const followUpCasts = snap.followUpSpellId ? (castsBySpellId[String(snap.followUpSpellId)] || []) : [];
          summary.gargoyle = {
            uses: summonTimes.length,
            snapshots: summonTimes.map((t) => ({
              time: t,
              active: (snap.snapshotCheckSpellIds || []).map((id, i) => ({ id, label: snap.snapshotCheckNames[i] })).filter((x) => isActiveAtId(x.id, t)).map((x) => x.label),
              bloodPresenceAfter: followUpCasts.some((bt) => bt > t && bt - t <= 3000),
            })),
          };
        }
      }
      summary.debugIntervalsByName = intervalsByName; // solo para diagnóstico en consola
      summary.debugIntervalsById = intervalsById; // id -> intervalos, inmune al idioma del log
    } catch (err) {
      summary.parseError = err.message;
    }
    return summary;
  }

  async function runDkAnalysis(reportId, bossCanonicalName, playerName) {
    const cacheKey = `${reportId}::${bossCanonicalName}::${playerName}`;
    if (dkAnalysisCache[cacheKey]) return dkAnalysisCache[cacheKey];
    const bossHtml = bossNameToHtml(bossCanonicalName);
    const attempt = await findKillAttemptIndex(reportId, bossHtml, playerName);
    const raw = await fetchCastsTimeline(reportId, bossHtml, attempt, playerName);
    const result = summarizeDkTimeline(raw);

    // Complemento de daño de pets: report_casts no trae eventos source=pet,
    // pero la tabla HTML de Damage sí los agrega al jugador para este mismo
    // intento (mismos boss/mode/attempt/s/f). Un fallo acá no debe romper el
    // resto del análisis de rotación.
    try {
      const playerHtml = await fetchPlayerDamagePage(reportId, bossHtml, attempt, playerName);
      result.damageBreakdown = parsePlayerDamageBreakdownHtml(playerHtml);
      const unholyPreview = isUnholyDk(result) ? computeUnholyAnalysis(result) : null;
      const ghoulName = unholyPreview ? unholyPreview.ghoulName : null;
      result.petDamage = parsePlayerPetDamageHtml(playerHtml, ghoulName);

      // El owner page agrega todas las Gargoyles. Para encuentros con varias
      // invocaciones, consultamos cada entidad Ebon Gargoyle por GUID en el
      // mismo slice y conservamos solo las que hicieron daño en este fight.
      if (unholyPreview && unholyPreview.gargoyle && result.petDamage.gargoyleUnitIds.length) {
        const instanceResults = await Promise.all(result.petDamage.gargoyleUnitIds.map(async (unitId) => {
          try {
            const unitHtml = await fetchPlayerDamagePage(reportId, bossHtml, attempt, unitId);
            const parsed = parseUnitDamageHtml(unitHtml);
            return parsed.damage > 0 ? { unitId, ...parsed } : null;
          } catch (_) {
            return null;
          }
        }));
        result.petDamage.gargoyleInstances = instanceResults.filter(Boolean).slice(0, unholyPreview.gargoyle.uses);
      }
    } catch (err) {
      console.log(`Rotation analysis — pet damage unavailable: ${err.message}`);
      result.petDamageError = err.message;
    }

    dkAnalysisCache[cacheKey] = result;
    return result;
  }

  const CLASS_ANALYSIS_ENABLED = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]; // las 10 clases

  function dkAnalysisColumnHtml(bossData, classI) {
    if (!CLASS_ANALYSIS_ENABLED.includes(classI)) return '<div class="dk-analysis-cell"></div>';
    if (!bossData.report_id) return '<div class="dk-analysis-cell">–</div>';
    return `<div class="dk-analysis-cell"><button type="button" class="dk-analysis-btn" title="Rotation analysis (experimental)">View analysis</button></div>`;
  }

  function buildLeaderboardHtml(participants, { limit } = {}) {
    const list = limit ? participants.slice(0, limit) : participants;
    if (!list.length) {
      return '<div class="boss-empty">No one in the filtered roster has recorded attempts against this boss yet.</div>';
    }
    // La lista ya viene ordenada de mayor a menor DPS, así que el primero
    // de `list` es el 100% de la barra y el resto es relativo a él.
    const maxDps = Math.max(...list.map((p) => p.bossData.dps_max || 0)) || 1;
    const head = `
      <div class="boss-leaderboard-row boss-leaderboard-head">
        <div class="align-right" title="Percentile score (0-100), same as the roster uses">Ranking</div>
        <div>Class</div>
        <div>Player</div>
        <div>Damage</div>
        <div class="align-right">Total</div>
        <div class="align-right">DPS</div>
        <div class="align-right" title="Recognized externals: Power Infusion, Innervate, Hysteria, Tricks of the Trade, Focus Magic">Externals</div>
        <div title="Rotation analysis — experimental, coverage varies by spec">Rot</div>
        <div class="align-right">Duration</div>
        <div>Log</div>
      </div>`;
    // Ordenado por DPS crudo (dps_max). El puesto 1-10 ya se ve por el
    // orden de la lista, así que no repetimos un contador de posición.
    return `<div class="boss-leaderboard">${head}${list.map((p) => {
      const classInfo = CLASS_MAP[p.classI] || { name: '—', color: '#9a9fab' };
      const specInfo = getSpecInfo(p.classI, p.spec);
      const isHealer = specInfo.role === 'Healing';
      const link = p.bossData.report_id ? `<a href="https://uwu-logs.xyz/reports/${p.bossData.report_id}/" target="_blank" rel="noopener" title="View log">↗</a>` : '';
      const dps = p.bossData.dps_max || 0;
      const barWidth = dps ? Math.max(4, Math.round((dps / maxDps) * 100)) : 0;
      return `
        <div class="boss-leaderboard-row${isHealer ? ' boss-leaderboard-row-healer' : ''}">
          ${rankingValueHtml(p.bossData)}
          <div class="boss-class-icon" title="${classInfo.name} · ${specInfo.name} · ${specInfo.role}${isHealer ? ' — uwu-logs.xyz only tracks damage, not this healer\'s HPS' : ''}">
            ${specIconHtml(p.classI, Number(p.spec), 20)}
            <span class="role-dot role-dot-${specInfo.role}"></span>${isHealer ? ' ⚠' : ''}
          </div>
          <div class="boss-player-name" style="color:${classInfo.color}">${p.name}</div>
          <div class="damage-bar-track"><div class="damage-bar-fill" style="width:${barWidth}%; background:${isHealer ? 'var(--text-dim)' : (classInfo.color || 'var(--gold)')}"></div></div>
          ${totalDamageValueHtml(p.bossData)}
          ${dpsValueHtml(p.bossData)}
          ${externalsColumnHtml(p.bossData)}
          <div class="dk-analysis-cell-wrap" data-report-id="${p.bossData.report_id || ''}" data-boss-name="${p.bossName || ''}" data-player-name="${p.name}" data-dps="${p.bossData.dps_max || ''}" data-duration="${p.bossData.fastest_kill_duration || ''}">${dkAnalysisColumnHtml(p.bossData, p.classI)}</div>
          <div class="boss-duration">${formatDuration(p.bossData.fastest_kill_duration)}</div>
          <div class="boss-log-cell"><span class="log-date-text">${formatReportDate(p.bossData.report_id)}</span>${link}</div>
        </div>`;
    }).join('')}</div>`;
  }

  function renderBossView() {
    const phaseSelect = $('bossPhaseFilterSelect');
    const raidSelect = $('bossRaidFilterSelect');
    const scopeSelect = $('bossScopeSelect');
    const body = $('bossViewBody');
    if (!phaseSelect || !raidSelect || !scopeSelect || !body) return;

    // Fase de contenido: recorta directamente qué raids/jefes tienen sentido
    // mostrar (ej. Vault of Archavon solo aporta 1 jefe por fase, no los 4).
    if (phaseSelect.options.length <= 1) {
      phaseSelect.innerHTML = `<option value="">All phases</option>${PHASE_ORDER.map((p) => `<option value="${p}">${p}</option>`).join('')}`;
    }
    phaseSelect.value = bossPhaseFilter;

    // La API mezcla jefes de varias raids en la misma respuesta — este select
    // filtra por raid antes de armar la lista de jefes/bloques de abajo.
    const availableRaids = getAvailableRaids(bossPhaseFilter);
    const wantedRaidOptions = ['', ...availableRaids];
    const currentRaidOptions = Array.from(raidSelect.options).map((o) => o.value);
    if (currentRaidOptions.length !== wantedRaidOptions.length || currentRaidOptions.some((v, i) => v !== wantedRaidOptions[i])) {
      raidSelect.innerHTML = `<option value="">All raids</option>${availableRaids.map((r) => `<option value="${r.replace(/"/g, '&quot;')}">${r}</option>`).join('')}`;
      if (!wantedRaidOptions.includes(bossRaidFilter)) bossRaidFilter = '';
    }
    raidSelect.value = bossRaidFilter;

    const bossNames = getBossNames(bossRaidFilter, bossPhaseFilter);
    const currentOptions = Array.from(scopeSelect.options).map((o) => o.value);
    const wantedOptions = ['__ALL__', ...bossNames];
    if (currentOptions.length !== wantedOptions.length || currentOptions.some((v, i) => v !== wantedOptions[i])) {
      scopeSelect.innerHTML = `<option value="__ALL__">Full raid (all bosses)</option>${bossNames.map((b) => `<option value="${b.replace(/"/g, '&quot;')}">${b}</option>`).join('')}`;
      if (wantedOptions.includes(bossScope)) scopeSelect.value = bossScope;
      else bossScope = '__ALL__';
    }
    scopeSelect.value = bossScope;

    if (viewMode !== 'boss') return; // no hace falta pintar el body si la sección está oculta

    const { withData } = getFilteredRows();

    if (!withData.length) {
      body.innerHTML = '<div class="empty-state">No roster characters have loaded data yet. Add them and wait for it to load.</div>';
      return;
    }
    if (!bossNames.length) {
      body.innerHTML = '<div class="empty-state">No one in the roster has logs against bosses from this raid/phase yet.</div>';
      return;
    }

    if (bossScope === '__ALL__') {
      // Raid completa: un bloque por jefe, cada uno con su propio Top 10.
      body.innerHTML = bossNames.map((bossName) => {
        const participants = getBossLeaderboard(bossName, withData);
        return `
          <div class="boss-block">
            <div class="boss-block-header">
              <h3>${bossName}</h3>
            </div>
            ${buildLeaderboardHtml(participants, { limit: TOP_N_PER_BOSS })}
          </div>`;
      }).join('');
    } else {
      // Jefe individual: vista enfocada, ranking completo del roster filtrado (sin tope de 10).
      const participants = getBossLeaderboard(bossScope, withData);
      body.innerHTML = `
        <div class="boss-block boss-block-single">
          <div class="boss-block-header">
            <h3>${bossScope}</h3>
          </div>
          ${buildLeaderboardHtml(participants)}
        </div>`;
    }

    // trigger damage-bar fill animation (mismo truco que el power-bar del roster)
    requestAnimationFrame(() => {
      body.querySelectorAll('.damage-bar-fill').forEach((el) => {
        const w = el.style.width;
        el.style.width = '0%';
        requestAnimationFrame(() => { el.style.width = w; });
      });
    });
  }

  function showPlayerProfile(name) {
    profilePlayerName = name;
    profileReturnView = viewMode; // recordamos desde dónde entraste, para el botón "Volver"
    $('rosterSection').style.display = 'none';
    $('bossSection').style.display = 'none';
    $('analysisSection').style.display = 'none';
    $('playerSection').style.display = '';
    renderPlayerProfile();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function hidePlayerProfile() {
    profilePlayerName = null;
    $('playerSection').style.display = 'none';
    $('analysisSection').style.display = 'none';
    $('rosterSection').style.display = profileReturnView === 'roster' ? '' : 'none';
    $('bossSection').style.display = profileReturnView === 'boss' ? '' : 'none';
  }

  function showLogAnalysis(info) {
    activeAnalysisData = info;
    compareWithPlayerName = null;
    analysisReturnView = profilePlayerName ? 'profile' : viewMode;
    $('rosterSection').style.display = 'none';
    $('bossSection').style.display = 'none';
    $('playerSection').style.display = 'none';
    $('analysisSection').style.display = '';
    renderLogAnalysis();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function hideLogAnalysis() {
    activeAnalysisData = null;
    compareWithPlayerName = null;
    $('analysisSection').classList.remove('is-comparing');
    $('analysisSection').style.display = 'none';
    if (analysisReturnView === 'profile' && profilePlayerName) {
      $('playerSection').style.display = '';
    } else if (analysisReturnView === 'boss') {
      $('bossSection').style.display = '';
    } else {
      $('rosterSection').style.display = '';
    }
  }

  // Perfil de un jugador: todos sus logs, agrupados por raid, con el
  // promedio de % parse calculado sobre los bosses que sí tiene loggeados
  // (distinto del overall_points que devuelve la API, que puede pesar
  // distinto — mostramos los dos).
  // ── Progreso en el tiempo (perfil de un jugador) ────────────────────────
  // Lee /api/history/<server>/<name>/<spec>, que lee de data/uwu_logs.db —
  // la misma base que ya usaba el CLI (uwu-tracker fetch), ahora también
  // alimentada automáticamente por el proxy cada vez que la web refresca un
  // personaje (máximo 1 snapshot cada 12h por personaje+spec, para no llenar
  // la base de puntos casi idénticos). Si todavía no hay 2+ snapshots
  // guardados, no hay nada que graficar todavía — se va a ir llenando solo
  // con el uso normal de la app día a día.

  function formatHistoryDate(iso) {
    try {
      return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch (e) {
      return iso;
    }
  }

  function buildProgressChartSvg(history) {
    const W = 640;
    const H = 150;
    const padL = 36;
    const padR = 10;
    const padT = 10;
    const padB = 22;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const points = history.map((h) => (h.overall_points || 0) / 100);
    const minV = Math.min(...points);
    const maxV = Math.max(...points);
    const range = (maxV - minV) || 1;

    const xy = points.map((v, i) => {
      const x = padL + (history.length === 1 ? plotW / 2 : (i / (history.length - 1)) * plotW);
      const y = padT + plotH - ((v - minV) / range) * plotH;
      return [x, y];
    });

    const pathD = xy.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const areaD = `${pathD} L${xy[xy.length - 1][0].toFixed(1)},${(padT + plotH).toFixed(1)} L${xy[0][0].toFixed(1)},${(padT + plotH).toFixed(1)} Z`;
    const lastColor = scoreColor(history[history.length - 1].overall_points);

    const dots = xy.map(([x, y], i) => `
      <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="${i === xy.length - 1 ? lastColor : 'var(--text-dim)'}">
        <title>${formatHistoryDate(history[i].fetched_at)}: ${points[i].toFixed(2)}</title>
      </circle>`).join('');

    return `
      <svg viewBox="0 0 ${W} ${H}" class="profile-history-svg" preserveAspectRatio="none">
        <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="var(--border)" />
        <line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="var(--border)" />
        <path d="${areaD}" fill="var(--gold)" opacity="0.08" />
        <path d="${pathD}" fill="none" stroke="var(--gold)" stroke-width="2" />
        ${dots}
        <text x="${padL}" y="${H - 6}" font-size="10" fill="var(--text-dim)">${formatHistoryDate(history[0].fetched_at)}</text>
        <text x="${W - padR}" y="${H - 6}" font-size="10" fill="var(--text-dim)" text-anchor="end">${formatHistoryDate(history[history.length - 1].fetched_at)}</text>
        <text x="${padL - 6}" y="${padT + 4}" font-size="10" fill="var(--text-dim)" text-anchor="end">${maxV.toFixed(0)}</text>
        <text x="${padL - 6}" y="${padT + plotH}" font-size="10" fill="var(--text-dim)" text-anchor="end">${minV.toFixed(0)}</text>
      </svg>`;
  }

  async function renderProfileHistoryChart(server, name, spec) {
    const container = $('profileHistoryChart');
    if (!container) return;
    try {
      const resp = await fetch(`/api/history/${encodeURIComponent(server)}/${encodeURIComponent(name)}/${encodeURIComponent(spec)}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const history = await resp.json();

      if (!Array.isArray(history) || history.length < 2) {
        container.innerHTML = `<div class="profile-history-empty">Not enough history yet to chart progress (${Array.isArray(history) ? history.length : 0} snapshot${history && history.length === 1 ? '' : 's'} saved). This builds up automatically as you use the app — at most 1 snapshot every 12h per character, so check back in a day or two.</div>`;
        return;
      }

      const delta = (history[history.length - 1].overall_points || 0) - (history[0].overall_points || 0);
      const deltaSign = delta >= 0 ? '+' : '';
      container.innerHTML = `
        <div class="profile-history-head">
          <span>Progress over time</span>
          <span class="profile-history-delta" style="color:${delta >= 0 ? 'var(--teal)' : 'var(--danger)'}">${deltaSign}${formatScore(delta)} since ${formatHistoryDate(history[0].fetched_at)}</span>
        </div>
        ${buildProgressChartSvg(history)}`;
    } catch (err) {
      container.innerHTML = `<div class="profile-history-empty">Couldn't load history: ${err.message}. Make sure you're running <code>proxy_server.py</code>.</div>`;
    }
  }

  function renderPlayerProfile() {
    const body = $('playerProfileBody');
    if (!body || !profilePlayerName) return;

    const member = config.members.find((m) => m.name === profilePlayerName);
    if (!member) {
      body.innerHTML = '<div class="empty-state">That character is no longer in the roster.</div>';
      return;
    }
    const server = config.server || $('serverInput').value.trim();
    const key = memberKey(server, member.name, member.spec);
    const entry = dataCache[key];

    if (!entry || entry.status !== 'done') {
      const msg = entry && entry.status === 'error'
        ? `There was an error fetching the data: ${entry.error}`
        : entry && entry.status === 'loading'
          ? 'Loading data…'
          : 'No data loaded yet for this character.';
      body.innerHTML = `<div class="empty-state">${msg}</div>`;
      return;
    }

    const data = entry.data;
    const classInfo = CLASS_MAP[data.class_i] || { name: '—', color: '#9a9fab' };
    const specValue = entry.detectedSpec || member.spec;
    const specInfo = getSpecInfo(data.class_i, specValue);

    // Todos los bosses con datos reales (normalizando alias al nombre canónico).
    const allLoggedEntries = Object.entries(data.bosses || {})
      .filter(([, b]) => b && Object.keys(b).length > 0)
      .map(([rawName, b]) => [ALIAS_TO_CANONICAL[rawName] || rawName, b]);

    // Filtro de fase: por defecto Phase 3 (la fase actual del server). Tanto
    // el listado de raids/jefes de abajo como las stats de arriba (promedio,
    // jefes con logs) se recalculan sobre esta selección.
    const phaseSet = profilePhaseFilter ? new Set(PHASE_BOSSES[profilePhaseFilter] || []) : null;
    const raidsToShow = phaseSet
      ? RAID_BOSS_LIST.filter((r) => r.bosses.some((b) => phaseSet.has(b.name)))
      : RAID_BOSS_LIST;
    const loggedEntries = phaseSet ? allLoggedEntries.filter(([n]) => phaseSet.has(n)) : allLoggedEntries;

    const avgParse = loggedEntries.length
      ? loggedEntries.reduce((sum, [, b]) => sum + (b.points || 0), 0) / loggedEntries.length
      : null;

    const loggedNames = new Set(loggedEntries.map(([n]) => n));
    const totalKnown = phaseSet ? phaseSet.size : getAllCanonicalBossNames().length;

    const phaseOptions = ['', ...PHASE_ORDER].map((p) => `<option value="${p}" ${p === profilePhaseFilter ? 'selected' : ''}>${p || 'All phases'}</option>`).join('');

    const header = `
      <div class="profile-header">
        <div class="boss-class-icon profile-class-icon" title="${classInfo.name} · ${specInfo.name} · ${specInfo.role}">
          ${specIconHtml(data.class_i, Number(specValue), 32)}
          <span class="role-dot role-dot-${specInfo.role}"></span>
        </div>
        <div>
          <h2 style="color:${classInfo.color}">${member.name}</h2>
          <div class="profile-sub">
            ${classInfo.name} · ${specInfo.name} (${specInfo.role}) ·
            <span class="profile-core-field">
              Core:
              <input type="text" id="profileCoreInput" class="profile-core-input" list="coreListOptions" value="${(member.core || DEFAULT_CORE).replace(/"/g, '&quot;')}" title="Change this character's Core" />
            </span>
          </div>
        </div>
        <div class="field profile-phase-field">
          <label for="profilePhaseSelect">Phase</label>
          <select id="profilePhaseSelect">${phaseOptions}</select>
        </div>
      </div>
      <div class="profile-stats">
        <div class="profile-stat">
          <span class="val" style="color:${scoreColor(data.overall_points)}">${formatScore(data.overall_points)}</span>
          <span class="label">Overall (API)</span>
        </div>
        <div class="profile-stat">
          <span class="val">${data.overall_rank ? '#' + data.overall_rank : '–'}</span>
          <span class="label">Rank server</span>
        </div>
        <div class="profile-stat">
          <span class="val" style="color:${avgParse != null ? scoreColor(avgParse) : 'var(--text-dim)'}">${avgParse != null ? formatScore(avgParse) : '–'}</span>
          <span class="label">Avg. % parse${profilePhaseFilter ? ` (${profilePhaseFilter})` : ''}</span>
        </div>
        <div class="profile-stat">
          <span class="val">${loggedEntries.length} / ${totalKnown}</span>
          <span class="label">Bosses with logs</span>
        </div>
      </div>
      <div class="profile-history" id="profileHistoryChart">Loading progress…</div>`;

    const raidBlocks = raidsToShow.map(({ raid, bosses }) => {
      const bossesToShow = phaseSet ? bosses.filter((b) => phaseSet.has(b.name)) : bosses;
      const rows = bossesToShow.map(({ name }) => {
        const b = loggedNames.has(name) ? loggedEntries.find(([n]) => n === name)[1] : null;
        if (!b) {
          return `<div class="profile-boss-row profile-boss-row-empty"><div>${name}</div><div>–</div><div>–</div><div>–</div><div></div></div>`;
        }
        const link = b.report_id ? `<a href="https://uwu-logs.xyz/reports/${b.report_id}/" target="_blank" rel="noopener" title="View log">↗</a>` : '';
        return `
          <div class="profile-boss-row">
            <div>${name}</div>
            <div style="color:${scoreColor(b.points)}">${formatScore(b.points)}</div>
            <div>${b.dps_max != null ? Math.round(b.dps_max).toLocaleString('en-US') : '–'}</div>
            <div>${formatDuration(b.fastest_kill_duration)}</div>
            <div>${link}</div>
          </div>`;
      }).join('');
      return `
        <div class="boss-block">
          <div class="boss-block-header"><h3>${raid}</h3></div>
          <div class="profile-boss-list">
            <div class="profile-boss-row profile-boss-row-head">
              <div>Boss</div><div>% Parse</div><div>DPS</div><div>Duration</div><div>Log</div>
            </div>
            ${rows}
          </div>
        </div>`;
    }).join('');

    body.innerHTML = header + raidBlocks;
    renderProfileHistoryChart(server, member.name, specValue);

    const phaseSelect = $('profilePhaseSelect');
    if (phaseSelect) {
      phaseSelect.addEventListener('change', () => {
        profilePhaseFilter = phaseSelect.value;
        renderPlayerProfile();
      });
    }

    const coreInput = $('profileCoreInput');
    if (coreInput) {
      const commitCore = () => {
        const newCore = coreInput.value.trim() || DEFAULT_CORE;
        if (newCore === (member.core || DEFAULT_CORE)) return;
        member.core = newCore;
        saveConfig();
        renderCoreDatalist();
        renderCoreFilterSelect();
        renderPlayerProfile();
      };
      coreInput.addEventListener('change', commitCore);
      coreInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') coreInput.blur();
      });
    }
  }

  // Recolecta otros miembros del roster (sin repetir personaje) de la MISMA
  // clase que ya tengan datos cacheados contra este boss, para poder armar
  // la comparación de Timelines. Si no tienen nada logueado contra este
  // boss, no aparecen (no hay con qué comparar).
  function getCompareCandidates(classI, bossName, excludeName) {
    const server = config.server || $('serverInput').value.trim();
    const seen = new Set([(excludeName || '').toLowerCase()]);
    const candidates = [];
    config.members.forEach((m) => {
      if (seen.has(m.name.toLowerCase())) return;
      const key = memberKey(server, m.name, m.spec);
      const entry = dataCache[key];
      if (!entry || entry.status !== 'done' || !entry.data) return;
      if (entry.data.class_i !== classI) return;
      const bossData = findBossData(entry.data.bosses, bossName);
      if (!bossData || !bossData.report_id) return;
      seen.add(m.name.toLowerCase());
      candidates.push({ name: m.name, bossData });
    });
    return candidates;
  }

  function formatReplayClock(sec, precise = false) {
    const value = Math.max(0, Number(sec) || 0);
    const whole = Math.floor(value);
    const base = `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
    return precise ? `${base}.${Math.floor((value - whole) * 10)}` : base;
  }

  function replayPlayerMetrics(player, maxSecond, position) {
    const t = Math.max(0, Math.min(maxSecond, Number(position) || 0));
    const lo = Math.floor(t);
    const hi = Math.min(player.maxSecond, lo + 1);
    const frac = t - lo;
    const loIndex = Math.min(lo, player.maxSecond);
    const baseDamage = Number(player.cumulative[loIndex] || 0);
    const nextBucket = hi > loIndex ? Number(player.values[hi] || 0) : 0;
    const damage = baseDamage + (nextBucket * frac);
    const elapsed = Math.max(1, t + 1);
    const avg = damage / elapsed;
    return { name: player.name, color: player.color, damage, avg };
  }

  function renderRaidReplayFrame(root, replay, position) {
    const pane = root.querySelector('[data-dkpane="replay"]');
    if (!pane || !pane._replayState) return;
    const state = pane._replayState;
    const t = Math.max(0, Math.min(replay.maxSecond, Number(position) || 0));
    state.second = t;

    const rows = replay.players
      .map((p) => replayPlayerMetrics(p, replay.maxSecond, t))
      .sort((a, b) => b.avg - a.avg || b.damage - a.damage);

    const timeEl = pane.querySelector('.raid-replay-time');
    const slider = pane.querySelector('.raid-replay-slider');
    const sliderWrap = pane.querySelector('.raid-replay-slider-wrap');
    const bloodlustStatus = pane.querySelector('.raid-replay-bloodlust-status');
    const tbody = pane.querySelector('.raid-replay-table tbody');
    const bloodlustActive = (replay.bloodlustWindows || []).some(([startMs, endMs]) => (
      t * 1000 >= startMs && t * 1000 <= endMs
    ));
    if (timeEl) timeEl.textContent = `${formatReplayClock(t, true)} / ${formatReplayClock(replay.maxSecond)}`;
    if (slider && document.activeElement !== slider) slider.value = String(t);
    sliderWrap?.classList.toggle('is-bloodlust-active', bloodlustActive);
    if (bloodlustStatus) {
      bloodlustStatus.classList.toggle('is-active', bloodlustActive);
      bloodlustStatus.textContent = bloodlustActive ? 'Bloodlust / Heroism active' : 'Bloodlust / Heroism';
    }
    if (tbody) {
      const maxDamage = Math.max(1, ...rows.map((m) => m.damage));
      tbody.innerHTML = rows.map((m, i) => {
        const barWidth = Math.max(0, Math.min(100, (m.damage / maxDamage) * 100));
        const color = m.color || '#6f7683';
        return `
        <tr class="raid-replay-meter-row" style="--meter-color:${color};--meter-width:${barWidth.toFixed(2)}%;">
          <td class="raid-replay-rank">${i + 1}</td>
          <td class="raid-replay-player"><button type="button" class="raid-replay-player-link" data-replay-player="${m.name.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}" style="color:${color}">${m.name}</button></td>
          <td>${Math.round(m.avg).toLocaleString('en-US')}</td>
          <td>${Math.round(m.damage).toLocaleString('en-US')}</td>
        </tr>`;
      }).join('');
    }
    updateReplayDamageBreakdownFrame(pane, replay, t);
  }

  function updateReplayDamageBreakdownFrame(pane, replay, position) {
    const selected = pane?._replaySelectedBreakdown;
    if (!selected) return;
    const player = replay.players.find((p) => p.name.toLowerCase() === selected.playerName.toLowerCase());
    if (!player) return;
    const metrics = replayPlayerMetrics(player, replay.maxSecond, position);
    renderReplayDamageBreakdown(selected.panel, selected.playerName, selected.breakdown, selected.color, metrics.damage);
  }

  function stopRaidReplay(pane) {
    if (!pane || !pane._replayState) return;
    const state = pane._replayState;
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = null;
    state.lastFrameTs = null;
    state.playing = false;
    const play = pane.querySelector('.raid-replay-play');
    if (play) play.textContent = '▶ PLAY';
  }

  function startRaidReplay(root, replay) {
    const pane = root.querySelector('[data-dkpane="replay"]');
    if (!pane || !pane._replayState) return;
    const state = pane._replayState;
    stopRaidReplay(pane);
    if (state.second >= replay.maxSecond) state.second = 0;
    state.playing = true;
    state.lastFrameTs = null;
    const play = pane.querySelector('.raid-replay-play');
    if (play) play.textContent = '⏸ PAUSE';

    const tick = (ts) => {
      if (!state.playing) return;
      if (state.lastFrameTs == null) state.lastFrameTs = ts;
      const deltaSec = Math.min(0.25, Math.max(0, (ts - state.lastFrameTs) / 1000));
      state.lastFrameTs = ts;
      const speed = Number(pane.querySelector('.raid-replay-speed')?.value || 1);
      const next = Math.min(replay.maxSecond, state.second + (deltaSec * speed));
      renderRaidReplayFrame(root, replay, next);
      if (next >= replay.maxSecond) {
        stopRaidReplay(pane);
        return;
      }
      state.raf = requestAnimationFrame(tick);
    };
    state.raf = requestAnimationFrame(tick);
  }


  function renderReplayDamageBreakdown(panel, playerName, breakdown, color, currentDamage = null) {
    const entries = breakdown.entries || [];
    const finalTotal = Math.max(0, Number(breakdown.totalDamage) || 0);
    const liveTotal = currentDamage == null ? finalTotal : Math.max(0, Math.min(finalTotal || currentDamage, Number(currentDamage) || 0));
    const progress = finalTotal > 0 ? Math.max(0, Math.min(1, liveTotal / finalTotal)) : 0;
    const maxFinalAbility = Math.max(1, ...entries.map((r) => Number(r.damage) || 0));
    panel.innerHTML = `
      <div class="raid-replay-breakdown-head">
        <div><strong style="color:${color || '#e9e5dc'}">${playerName}</strong> — Live damage breakdown</div>
        <div>${Math.round(liveTotal).toLocaleString('en-US')} damage</div>
      </div>
      <div class="raid-replay-breakdown-wrap">
        <table class="raid-replay-breakdown-table">
          <thead><tr><th>Ability</th><th>Damage</th></tr></thead>
          <tbody>${entries.map((r) => {
            const liveDamage = (Number(r.damage) || 0) * progress;
            const abilityBarWidth = Math.max(0, Math.min(100, ((Number(r.damage) || 0) / maxFinalAbility) * progress * 100));
            return `<tr class="raid-replay-ability-row" style="--ability-meter-color:${color || '#6f7683'};--ability-meter-width:${abilityBarWidth.toFixed(2)}%;">
              <td>${r.name}</td>
              <td>${Math.round(liveDamage).toLocaleString('en-US')}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>
      <div class="dk-analysis-note">Ability damage grows with the replay using the player's real accumulated damage as the clock. UwU Logs does not expose a per-ability DPS timeline, so intermediate ability values are proportional estimates; final values are exact.</div>`;
  }

  async function loadReplayPlayerBreakdown(pane, replay, playerName) {
    const panel = pane.querySelector('.raid-replay-breakdown');
    if (!panel) return;
    pane._replayBreakdownCache ||= {};
    const key = playerName.toLowerCase();
    const player = replay.players.find((p) => p.name.toLowerCase() === key);
    const color = player?.color || '#e9e5dc';
    panel.innerHTML = `<div class="dk-analysis-summary">Loading ${playerName} damage breakdown…</div>`;
    try {
      let breakdown = pane._replayBreakdownCache[key];
      if (!breakdown) {
        const attemptInfo = player?.attempt || replay.attempt;
        const html = await fetchPlayerDamagePage(replay.reportId, replay.bossHtml, attemptInfo, playerName);
        breakdown = parsePlayerDamageBreakdownHtml(html);
        pane._replayBreakdownCache[key] = breakdown;
      }
      pane._replaySelectedBreakdown = { panel, playerName, breakdown, color };
      const metrics = player ? replayPlayerMetrics(player, replay.maxSecond, pane._replayState?.second || 0) : null;
      renderReplayDamageBreakdown(panel, playerName, breakdown, color, metrics?.damage ?? null);
    } catch (err) {
      panel.innerHTML = `<div class="dk-analysis-error">Could not load ${playerName} damage breakdown: ${err.message}</div>`;
    }
  }

  function wireRaidReplayControls(root, replay) {
    const pane = root.querySelector('[data-dkpane="replay"]');
    if (!pane) return;
    pane._replayState = { second: 0, raf: null, lastFrameTs: null, playing: false };
    pane._replayBreakdownCache = {};
    pane._replaySelectedBreakdown = null;
    const play = pane.querySelector('.raid-replay-play');
    const reset = pane.querySelector('.raid-replay-reset');
    const slider = pane.querySelector('.raid-replay-slider');

    play?.addEventListener('click', () => {
      if (pane._replayState.playing) stopRaidReplay(pane);
      else startRaidReplay(root, replay);
    });
    reset?.addEventListener('click', () => {
      stopRaidReplay(pane);
      renderRaidReplayFrame(root, replay, 0);
    });
    slider?.addEventListener('input', () => {
      stopRaidReplay(pane);
      renderRaidReplayFrame(root, replay, Number(slider.value));
    });
    pane.addEventListener('click', (event) => {
      const btn = event.target.closest('.raid-replay-player-link');
      if (!btn || !pane.contains(btn)) return;
      loadReplayPlayerBreakdown(pane, replay, btn.dataset.replayPlayer);
    });
    renderRaidReplayFrame(root, replay, 0);
  }

  async function ensureRaidReplayLoaded(root) {
    const pane = root.querySelector('[data-dkpane="replay"]');
    const panel = root.querySelector('.dk-analysis-panel[data-report-id]') || root.closest?.('.dk-analysis-panel[data-report-id]');
    if (!pane || !panel || pane.dataset.loaded === '1' || pane.dataset.loading === '1') return;
    pane.dataset.loading = '1';
    pane.innerHTML = '<div class="dk-analysis-summary">Loading player DPS replay…</div>';
    try {
      const fetchedReplay = await fetchRaidReplay(panel.dataset.reportId, panel.dataset.bossName, panel.dataset.playerName);
      const bloodlustWindows = String(panel.dataset.bloodlustWindows || '')
        .split(',')
        .map((entry) => entry.split(':').map(Number))
        .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start);
      const replay = { ...fetchedReplay, bloodlustWindows };
      const bloodlustBands = bloodlustWindows.map(([startMs, endMs]) => {
        const fightMs = Math.max(1, replay.maxSecond * 1000);
        const left = Math.max(0, Math.min(100, (startMs / fightMs) * 100));
        const right = Math.max(left, Math.min(100, (endMs / fightMs) * 100));
        return `<span class="raid-replay-bloodlust-band" style="left:${left.toFixed(3)}%;width:${(right - left).toFixed(3)}%" title="Bloodlust / Heroism: ${formatTimelineMs(startMs)}–${formatTimelineMs(endMs)}"></span>`;
      }).join('');
      pane.dataset.loaded = '1';
      pane.innerHTML = `
        <div class="raid-replay-toolbar">
          <button type="button" class="raid-replay-play">▶ PLAY</button>
          <button type="button" class="secondary raid-replay-reset">⏮ RESET</button>
          <label>Speed
            <select class="raid-replay-speed">
              <option value="1">1x</option>
              <option value="2">2x</option>
              <option value="4">4x</option>
            </select>
          </label>
          <span class="raid-replay-time">00:00 / ${formatReplayClock(replay.maxSecond)}</span>
        </div>
        <div class="raid-replay-slider-wrap">
          <div class="raid-replay-bloodlust-layer" aria-hidden="true">${bloodlustBands}</div>
          <input class="raid-replay-slider" type="range" min="0" max="${replay.maxSecond}" value="0" step="0.1" aria-label="Raid Replay timeline">
        </div>
        ${bloodlustWindows.length ? '<div class="raid-replay-bloodlust-status">Bloodlust / Heroism</div>' : ''}
        <div class="raid-replay-table-wrap">
          <table class="raid-replay-table">
            <thead><tr><th>#</th><th>Player</th><th>Avg DPS</th><th>Damage</th></tr></thead>
            <tbody></tbody>
          </table>
        </div>
        <div class="raid-replay-breakdown"><div class="dk-analysis-note">Click a player name to show that player's ability and melee damage breakdown for this encounter.</div></div>
        <div class="dk-analysis-note">Raid Replay loads up to 20 players and excludes known Healing specs using roster/spec metadata. Players whose role cannot be identified are kept to avoid false exclusions. Ranking updates by accumulated average DPS. UwU Logs provides real 1-second DPS buckets; playback is visually interpolated for smoother motion.</div>`;
      wireRaidReplayControls(root, replay);
    } catch (err) {
      pane.innerHTML = `<div class="dk-analysis-error">Could not load DPS Replay: ${err.message}</div>`;
    } finally {
      pane.dataset.loading = '0';
    }
  }

  // Tabs Summary / Timeline / Raid Replay inside one analysis panel.
  function timelineCsvEscape(value) {
    const text = String(value == null ? '' : value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function timelineCellText(cell) {
    if (!cell) return '';
    const icons = [...cell.querySelectorAll('img')]
      .map((img) => img.title || img.alt || '')
      .filter(Boolean);
    if (icons.length) return icons.join(' | ');
    return cell.textContent.replace(/\s+/g, ' ').trim().replace('–', '');
  }

  function downloadTimelineCsv(panel) {
    const pane = panel.querySelector('[data-dkpane="timeline"]');
    if (!pane) return;

    let rows = [...pane.querySelectorAll('.dk-analysis-timeline-table tbody tr')]
      .map((tr) => [...tr.children].map(timelineCellText));

    // Las clases no-DK usan CSS Grid en vez de <table>: cada 5 celdas
    // consecutivas representan una fila con las mismas columnas.
    if (!rows.length) {
      const cells = [...pane.querySelectorAll('.lock-timeline-cell')];
      rows = [];
      for (let i = 0; i < cells.length; i += 5) {
        rows.push(cells.slice(i, i + 5).map(timelineCellText));
      }
    }

    const csvRows = [['Time', 'Ability', 'Target', 'Buffs', 'Procs'], ...rows];
    const csv = `\uFEFF${csvRows.map((row) => row.map(timelineCsvEscape).join(',')).join('\r\n')}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safePart = (value, fallback) => String(value || fallback)
      .replace(/[^a-z0-9_-]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();
    link.href = url;
    link.download = `timeline-${safePart(panel.dataset.playerName, 'player')}-${safePart(panel.dataset.bossName, 'encounter')}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function wireAnalysisTabs(root) {
    root.querySelectorAll('.dk-tab').forEach((tabBtn) => {
      tabBtn.addEventListener('click', () => {
        root.querySelectorAll('.dk-tab').forEach((b) => b.classList.toggle('active', b === tabBtn));
        root.querySelectorAll('.dk-tab-pane').forEach((pane) => {
          pane.style.display = pane.dataset.dkpane === tabBtn.dataset.dktab ? '' : 'none';
        });
        const replayPane = root.querySelector('[data-dkpane="replay"]');
        if (tabBtn.dataset.dktab === 'replay') ensureRaidReplayLoaded(root);
        else stopRaidReplay(replayPane);
      });
    });
    root.querySelectorAll('.timeline-csv-download').forEach((button) => {
      button.addEventListener('click', () => {
        const panel = button.closest('.dk-analysis-panel');
        if (panel) downloadTimelineCsv(panel);
      });
    });
  }

  // Arma el HTML de UN panel de análisis (Summary + Timeline) a partir de un
  // `result` ya resuelto por runDkAnalysis(). Se usa tanto para la vista de
  // un solo jugador como para cada columna del compare — nunca toca el DOM
  // directamente, solo devuelve el string.
  function buildAnalysisPanelHtml(result, info) {
    const { reportId, playerName, bossName, dps, duration } = info;
    const isDkClass = (result.raw.CLASS || '').toLowerCase() === 'death-knight';
    const rotationUptimes = result.uptimes.filter((u) => u.category === 'rotation');
    const gargoyleUptimes = result.uptimes.filter((u) => u.category === 'gargoyle');
    const otherUptimes = result.uptimes.filter((u) => u.category === 'other');
    const frost = isFrostDk(result) ? computeFrostAnalysis(result) : null;
    const unholy = (!frost && isUnholyDk(result)) ? computeUnholyAnalysis(result) : null;
    const fireMage = computeFireMageAnalysis(result, bossName);
    const rawBloodlustWindows = ['2825', '32182']
      .flatMap((id) => (result.debugIntervalsById && result.debugIntervalsById[id]) || [])
      .map(([start, end]) => [Number(start), Number(end)])
      .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start)
      .sort((a, b) => a[0] - b[0]);
    const bloodlustWindows = rawBloodlustWindows.reduce((merged, interval) => {
      const previous = merged[merged.length - 1];
      if (previous && interval[0] <= previous[1]) previous[1] = Math.max(previous[1], interval[1]);
      else merged.push([...interval]);
      return merged;
    }, []);
    const encodedBloodlustWindows = bloodlustWindows.map(([start, end]) => `${start}:${end}`).join(',');
    if (frost && frost.killingMachine) {
      // Diagnóstico puntual: intervalos calculados de Killing Machine
      // (APPLIED->REMOVED) contra los casteos reales de Obliterate/Frost
      // Strike, para verificar a mano si "used" está bien calculado.
      const kmIntervals = (result.debugIntervalsById && result.debugIntervalsById['51124']) || [];
      const spenderCasts = result.timeline
        .filter((t) => t.id === '51425' || t.id === '55268')
        .map((t) => ({ ms: t.ms, name: t.name }));
      console.log('Rotation analysis — Killing Machine diagnostics:\n' + JSON.stringify({
        intervals: kmIntervals.map(([s, e]) => ({ start: formatTimelineMs(s), end: formatTimelineMs(e), start_ms: s, end_ms: e, duration_sec: ((e - s) / 1000).toFixed(1) })),
        obliterate_and_frost_strike_casts: spenderCasts.map((c) => ({ time: formatTimelineMs(c.ms), ms: c.ms, name: c.name })),
        computed_used: frost.killingMachine.used,
        computed_total: frost.killingMachine.total,
      }, null, 2));
    }

    const INFO_ONLY_UPTIMES = new Set(['Bone Shield']);
    const EVAL_THRESHOLD = 90;

    const uptimeRow = (u) => {
      if (INFO_ONLY_UPTIMES.has(u.name)) {
        return `<div class="dk-row dk-row-info"><span class="dk-row-icon">ℹ</span><span class="dk-row-label">${u.name} uptime</span><span class="dk-row-value">${u.pct.toFixed(2)}%</span></div>`;
      }
      const good = u.pct >= EVAL_THRESHOLD;
      return `<div class="dk-row ${good ? 'dk-row-good' : 'dk-row-warn'}"><span class="dk-row-icon">${good ? '✔' : '⚠'}</span><span class="dk-row-label">${u.name} uptime</span><span class="dk-row-value">${u.pct.toFixed(2)}%</span></div>`;
    };
    const infoRow = (label, value) => `<div class="dk-row dk-row-info"><span class="dk-row-icon">ℹ</span><span class="dk-row-label">${label}</span><span class="dk-row-value">${value}</span></div>`;
    const boolValue = (ok) => `<span class="dk-status-icon ${ok ? 'is-ok' : 'is-bad'}" aria-label="${ok ? 'yes' : 'no'}" title="${ok ? 'yes' : 'no'}">${ok ? '✔' : '✖'}</span>`;
    const checkRow = (label, value, ok) => `<div class="dk-row ${ok ? 'dk-row-good' : 'dk-row-bad'}"><span class="dk-row-icon">${ok ? '✔' : '✖'}</span><span class="dk-row-label">${label}</span><span class="dk-row-value">${value}</span></div>`;
    const fmtInt = (value) => Math.round(Number(value) || 0).toLocaleString('en-US');
    const mageEscape = (value) => String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const mageMetric = (ok, title, details = []) => `
      <div class="mage-metric ${ok ? 'is-good' : 'is-bad'}">
        <div class="mage-metric-head"><span>${ok ? '✔' : '✖'}</span><span>${title}</span></div>
        ${details.filter(Boolean).map((detail) => `<div class="mage-metric-detail">${detail}</div>`).join('')}
      </div>`;
    const mageProcLine = (proc) => `• ${proc.category ? `${mageEscape(proc.category)}: ` : ''}${mageEscape(proc.name)}`;
    const mageCombustionWindow = (window, label, extraDetails = []) => {
      if (!window) return mageMetric(false, `${label} — not used`);
      const allProcs = [...window.active, ...window.triggered];
      const hasTrinket = allProcs.some((proc) => proc.category === 'Trinket');
      const details = [
        ...extraDetails,
        '<span class="mage-metric-subtitle">Active at activation:</span>',
        ...(window.active.length ? window.active.map(mageProcLine) : ['• None detected']),
        '<span class="mage-metric-subtitle">Triggered during the window:</span>',
        ...(window.triggered.length ? window.triggered.map(mageProcLine) : ['• None detected']),
        hasTrinket ? '' : '<span class="mage-metric-alert">✖ No trinket proc was active</span>',
      ];
      return mageMetric(true, `${label} at ${formatTimelineMs(window.start)}`, details);
    };
    const magePotionWindow = (use, label) => use
      ? mageMetric(true, `${label} at ${formatTimelineMs(use.ms)}`, [`• Potion: ${mageEscape(use.name)}`])
      : mageMetric(false, `${label} — not used`);
    const damageShare = (amount) => result.petDamage && result.petDamage.playerTotalDamage > 0
      ? `${((amount / result.petDamage.playerTotalDamage) * 100).toFixed(2)}%`
      : '–';

    const castNoteRows = result.castNotes.map((c) =>
      c.macroSpam
        ? checkRow(`${c.name} casts (possible macro spam)`, c.count, false)
        : infoRow(`${c.name} casts`, c.count)
    ).join('');

    const headerPlayerName = playerName || result.raw.NAME || '';
    const headerBossName = bossName || '';
    const headerDps = dps ? Math.round(Number(dps)).toLocaleString('en-US') : '–';
    const headerDuration = duration ? formatDuration(Number(duration)) : '–';
    const classInfo = Object.values(CLASS_MAP).find((c) => c.name.toLowerCase().replace(/ /g, '-') === (result.raw.CLASS || '').toLowerCase());
    const headerNameColor = (classInfo && classInfo.color) || '#e9e5dc';
    const frostScoreColor = (s) => (s >= 90 ? '#F4C35A' : s >= 75 ? '#a335ee' : s >= 50 ? '#0070de' : '#e3b341');
    const scoreRow = frost && frost.score != null
      ? `<div class="dk-analysis-header-row"><span>Frost Score:</span><span class="dk-score-badge" style="color:${frostScoreColor(frost.score)}">${frost.score}/100</span></div>`
      : unholy && unholy.score != null
        ? `<div class="dk-analysis-header-row"><span>Unholy Score:</span><span class="dk-score-badge" style="color:${frostScoreColor(unholy.score)}">${unholy.score}/100</span></div>`
        : '';
    const header = `
      <div class="dk-analysis-header">
        <div class="dk-analysis-header-row"><span>Player:</span><span style="color: ${headerNameColor}; font-weight: 600;">${headerPlayerName}</span></div>
        <div class="dk-analysis-header-row"><span>Encounter:</span><span class="dk-header-boss">${headerBossName}</span></div>
        <div class="dk-analysis-header-row"><span>DPS:</span><span>${headerDps}</span></div>
        <div class="dk-analysis-header-row"><span>Duration:</span><span>${headerDuration}</span></div>
        ${scoreRow}
      </div>
      ${frost ? `<div class="dk-analysis-score-breakdown">${frost.categories.map((c) => `<span class="dk-score-chip">${c.label}: ${c.score.toFixed(0)}</span>`).join('')}<span class="dk-score-chip dk-score-chip-pending" title="El proxy/API no expone estado de Runic Power ni Runas por evento todavía">RP Capping: pending</span></div>` : ''}`;

    const kmRow = frost && frost.killingMachine
      ? checkRow('Killing Machine procs used', `${frost.killingMachine.used} of ${frost.killingMachine.total}`, frost.killingMachine.used === frost.killingMachine.total)
        + (frost.killingMachine.avgDelayMs != null ? infoRow('Avg. delay to spend Killing Machine', `${frost.killingMachine.avgDelayMs.toFixed(0)} ms`) : '')
      : '';
    const obliterateDriftRow = frost
      ? infoRow('Obliterate rune drift', 'not tracked yet (needs rune state, not exposed by the API)')
      : '';
    const speedSection = frost && (result.gcdDelayMs != null || kmRow)
      ? `<div class="dk-analysis-section-title">Speed</div>
         <div class="dk-analysis-spells">
           ${result.gcdDelayMs != null ? infoRow('Avg. GCD delay (approx.)', `${result.gcdDelayMs.toFixed(0)} ms`) : ''}
           ${kmRow}
           ${obliterateDriftRow}
         </div>`
      : '';

    const uaRows = frost && frost.ua
      ? infoRow('Unbreakable Armor used', `${frost.ua.uses} time${frost.ua.uses === 1 ? '' : 's'}`)
        + frost.ua.windows.map((w) => checkRow(
            `Unbreakable Armor #${w.index}${w.withErw ? ' (with ERW)' : ''} — Obliterate hits`,
            `${w.obliterateHits} of ${w.target}`,
            w.obliterateHits >= w.target,
          )).join('')
      : '';
    const howlingBlastRow = frost && frost.howlingBlast
      ? checkRow('Howling Blast casts with Rime active', `${frost.howlingBlast.goodCount} of ${frost.howlingBlast.total}`, frost.howlingBlast.goodCount === frost.howlingBlast.total)
        + (frost.howlingBlast.comboCount > 0 ? infoRow('Rime + Killing Machine combo (free crit)', `${frost.howlingBlast.comboCount} time${frost.howlingBlast.comboCount === 1 ? '' : 's'}`) : '')
      : '';
    const rimeRow = frost && frost.rime
      ? checkRow('Rime procs used', `${frost.rime.used} of ${frost.rime.total}`, frost.rime.used === frost.rime.total)
      : '';
    // --- Unholy DK: Summary layout ---
    const pctMetricRow = (label, value) => value == null
      ? infoRow(label, 'not detected / unavailable')
      : infoRow(label, `${Number(value).toFixed(2)}%`);
    const diseasePct = (spellId) => unholy
      ? ((unholy.diseaseUptimes || []).find((u) => String(u.id) === String(spellId)) || {}).pct
      : null;

    const unholyRotationSection = unholy
      ? `<div class="dk-analysis-section-title">Rotation</div>
         <div class="dk-analysis-spells">
           ${pctMetricRow('Death and Decay uptime', unholy.deathAndDecayPct)}
           ${pctMetricRow('Desolation uptime', unholy.desolationPct)}
           ${pctMetricRow('Ghoul Frenzy uptime', unholy.ghoulFrenzyPct)}
           ${pctMetricRow('Sigil of Virulence uptime', unholy.sigilOfVirulencePct)}
           ${pctMetricRow('Unholy Might (T9 2p) uptime', unholy.unholyMightT9Pct)}
           ${unholy.meleePct != null ? pctMetricRow('Melee uptime', unholy.meleePct) : infoRow('Melee uptime', 'not tracked yet (report_casts does not expose swing uptime)')}
           ${pctMetricRow('Blood Plague uptime', diseasePct('55078'))}
           ${pctMetricRow('Frost Fever uptime', diseasePct('55095'))}
           ${pctMetricRow('Blood Presence (outside of Gargoyle) uptime', unholy.bloodPresenceOutsideGargoylePct)}
           ${checkRow('You used Blood Tap', `${unholy.bloodTapCount} of ${unholy.bloodTapPossible} possible times`, unholy.bloodTapCount >= unholy.bloodTapPossible)}
           ${pctMetricRow('Bone Shield uptime', unholy.boneShieldPct)}
         </div>`
      : '';

    const fireMageRotationSection = fireMage ? (() => {
      const ignite = fireMage.ignite;
      const hot = fireMage.hotStreak;
      const livingBomb = fireMage.livingBomb;
      const flamestrike = fireMage.flamestrike;
      const invisibility = fireMage.invisibility;
      const combustion = fireMage.combustion;
      const potions = fireMage.potions;
      const mirror = fireMage.mirrorImage;
      const hotStreakProcDetails = hot.procs.length
        ? `<details class="mage-hot-streak-details">
            <summary>Hot Streak proc details (${hot.procs.length})</summary>
            <div class="mage-hot-streak-list">
              ${hot.procs.map((proc) => checkRow(
                `Hot Streak #${proc.index} at ${formatTimelineMs(proc.start)}`,
                proc.consumed
                  ? `Pyroblast at ${formatTimelineMs(proc.pyroblastMs)} · ${(proc.reactionMs / 1000).toFixed(2)}s`
                  : (proc.endReason === 'refreshed'
                    ? `not consumed · overwritten at ${formatTimelineMs(proc.end)}`
                    : `not consumed · ended at ${formatTimelineMs(proc.end)}`),
                proc.consumed,
              )).join('')}
            </div>
          </details>`
        : '';
      return `<div class="dk-analysis-section-title">Rotation</div>
        <div class="dk-analysis-spells mage-analysis">
          ${mageMetric(ignite.damage > 0, `Ignite dealt ${fmtInt(ignite.damage)} total damage`, [
            ignite.sharePct == null ? '• Damage share unavailable' : `• ${ignite.sharePct.toFixed(1)}% of your total damage`,
          ])}
          ${mageMetric(hot.total > 0 && hot.consumed === hot.total, `You consumed ${hot.consumed} of ${hot.total} Hot Streak procs`, [
            `• Hot Streak efficiency: ${hot.efficiencyPct.toFixed(1)}%`,
            hot.averageReactionMs == null ? '• Reaction time unavailable' : `• Average reaction time: ${(hot.averageReactionMs / 1000).toFixed(2)} seconds`,
            hot.fastestReactionMs == null ? '' : `• Fastest reaction: ${(hot.fastestReactionMs / 1000).toFixed(2)} seconds`,
            hot.slowestReactionMs == null ? '' : `• Slowest reaction: ${(hot.slowestReactionMs / 1000).toFixed(2)} seconds`,
            hot.missed > 0 ? `• ${hot.missed} proc${hot.missed === 1 ? ' was' : 's were'} not consumed` : '• Every proc was consumed',
          ])}
          ${hotStreakProcDetails}
          ${mageMetric(livingBomb.complete, 'You applied Living Bomb to Gormok, Snobolds, both Jormungars, and Icehowl')}
          ${mageMetric(flamestrike.used, 'You used Flamestrike on the stacked Snobolds after Gormok died', [
            `• Flamestrike Rank 9: ${flamestrike.rank9} cast${flamestrike.rank9 === 1 ? '' : 's'}`,
            `• Flamestrike Rank 8: ${flamestrike.rank8} cast${flamestrike.rank8 === 1 ? '' : 's'}`,
          ])}
          ${mageMetric(invisibility.used, 'You used Invisibility after the Jormungars disappeared or died and before Icehowl appeared', [
            invisibility.used
              ? `• Invisibility: ${invisibility.count} cast${invisibility.count === 1 ? '' : 's'} at ${invisibility.times.map(formatTimelineMs).join(', ')}`
              : '• No Invisibility cast was detected in the transition window',
          ])}
          ${mageMetric(combustion.usedPriorityWindows === combustion.possiblePriorityWindows,
            `You used Combustion in ${combustion.usedPriorityWindows} of ${combustion.possiblePriorityWindows} priority windows`)}
          ${mageCombustionWindow(combustion.pull, 'Combustion #1 — Pull: Gormok')}
          ${mageCombustionWindow(combustion.daze, 'Combustion #2 — Icehowl: Staggered Daze', [
            '• Damage-taken increase: 100%',
            `• Window duration: ${combustion.dazeDurationSec} seconds`,
          ])}
          ${mageMetric(potions.usedPriorityWindows === potions.possiblePriorityWindows,
            `You used potions in ${potions.usedPriorityWindows} of ${potions.possiblePriorityWindows} priority windows`)}
          ${magePotionWindow(potions.prepull, 'Potion #1 — Pre-pull')}
          ${magePotionWindow(potions.afterGormok, 'Potion #2 — After Gormok died')}
          ${magePotionWindow(potions.staggeredDaze, 'Potion #3 — Icehowl: Staggered Daze')}
          ${mageMetric(mirror.used >= mirror.possible, `You used Mirror Image ${mirror.used} of ${mirror.possible} possible times`)}
        </div>`;
    })() : '';

    const rotationSection = fireMage
      ? fireMageRotationSection
      : unholy
      ? unholyRotationSection
      : (rotationUptimes.length || castNoteRows || uaRows || howlingBlastRow || rimeRow)
        ? `<div class="dk-analysis-section-title">Rotation</div>
           <div class="dk-analysis-spells">
             ${uaRows}
             ${howlingBlastRow}
             ${rimeRow}
             ${rotationUptimes.map(uptimeRow).join('')}${castNoteRows}
           </div>
           ${frost && frost.howlingBlast && frost.howlingBlast.goodCount !== frost.howlingBlast.total ? '<div class="dk-analysis-note">Howling Blast without Rime is only worth casting on 3+ targets — this check can only confirm Rime uptime, not how many targets a given cast hit.</div>' : ''}`
        : '';

    const snapMeta = result.gargoyleMeta;
    const petDamage = result.petDamage || null;
    const gargoyleDamage = petDamage && petDamage.gargoyle ? petDamage.gargoyle : null;
    const gargoyleInstances = petDamage && Array.isArray(petDamage.gargoyleInstances) ? petDamage.gargoyleInstances : [];
    const ghoulDamage = petDamage && petDamage.ghoul ? petDamage.ghoul : null;
    const armyDamage = petDamage && petDamage.armyOfTheDead ? petDamage.armyOfTheDead : null;
    const KNOWN_PROC_NAMES = {
      '67708': 'Paragon',
      '67773': 'Paragon',
    };
    const KNOWN_TRINKET_PROC_NAMES = new Set(['Paragon', 'Greatness']);
    const spellNameFor = (id, fallback) => {
      const spells = (result.raw && (result.raw.SPELLS || result.raw.spells)) || {};
      const rawName = spells[id] && (spells[id].name || spells[id].NAME);
      const uptimeName = result.uptimes && result.uptimes.find((u) => String(u.id) === String(id))?.name;
      const countName = result.spellCounts && result.spellCounts.find((s) => String(s.id) === String(id))?.name;
      const detected = rawName || uptimeName || countName;
      return detected && !/^Spell #/i.test(detected) ? detected : (KNOWN_PROC_NAMES[String(id)] || fallback);
    };
    const intervalActiveAt = (id, ms) => {
      const intervals = result.debugIntervalsById && result.debugIntervalsById[String(id)];
      return Array.isArray(intervals) && intervals.some(([start, end]) => ms >= start && ms <= end);
    };
    const activeTrinketProcs = (w) => {
      // Deduplicate by spell ID, never by visible proc name. This matters for
      // Death's Choice / Death's Verdict normal + heroic: both can expose the
      // visible aura name "Paragon" while being two distinct equipped trinkets.
      const byId = new Map();

      for (const id of ['67708', '67773']) {
        if (intervalActiveAt(id, w.start)) {
          byId.set(String(id), { id: String(id), name: spellNameFor(id, 'Paragon') });
        }
      }

      // Also accept known trinket procs exposed directly by UwU Logs/Uptimes,
      // e.g. Greatness. Repeated sightings of the SAME spell ID collapse to
      // one row, while two different IDs with the same name remain separate.
      for (const u of (result.uptimes || [])) {
        const id = String(u.id || '');
        const name = String(u.name || '').trim();
        if (!id || !KNOWN_TRINKET_PROC_NAMES.has(name)) continue;
        if (intervalActiveAt(id, w.start) && !byId.has(id)) {
          byId.set(id, { id, name });
        }
      }

      return [...byId.values()];
    };
    const trinketSnapshotRows = (w) => activeTrinketProcs(w)
      .map((proc) => checkRow(`Your snapshotted ${proc.name}`, boolValue(true), true))
      .join('');

    const gargoyleDamageForWindow = (w) => {
      const instance = gargoyleInstances[w.index - 1];
      if (instance) return infoRow('Damage', `${fmtInt(instance.damage)} (${fmtInt(instance.casts)} casts, ${fmtInt(instance.hits)} hits)`);
      if (unholy.gargoyle.uses === 1 && gargoyleDamage && gargoyleDamage.damage > 0) {
        return infoRow('Damage', `${fmtInt(gargoyleDamage.damage)} (${fmtInt(gargoyleDamage.casts)} casts, ${fmtInt(gargoyleDamage.hits)} hits)`);
      }
      return infoRow('Damage', gargoyleDamage && gargoyleDamage.damage > 0
        ? `per-summon split unavailable; encounter total ${fmtInt(gargoyleDamage.damage)}`
        : (result.petDamageError ? `unavailable (${result.petDamageError})` : '0 / not detected'));
    };

    const unholyGargoyleSection = unholy && unholy.gargoyle
      ? `<div class="dk-analysis-section-title">Gargoyle</div>
         <div class="dk-analysis-spells">
           ${checkRow('You used Gargoyle', `${unholy.gargoyle.uses} of ${unholy.gargoyle.possible} possible times`, unholy.gargoyle.uses >= unholy.gargoyle.possible)}
           ${unholy.gargoyle.windows.map((w) => `
             <div class="dk-analysis-section-title" style="font-size:11px;margin-top:10px;">Gargoyle #${w.index}${w.withErw ? ' (with ERW)' : ''} — ${w.durationSec.toFixed(1)}s</div>
             ${gargoyleDamageForWindow(w)}
             ${checkRow('Unholy Presence', boolValue(w.unholyPresence), w.unholyPresence)}
             ${checkRow('Bloodlust / Heroism', boolValue(w.bloodlustOrHeroism), w.bloodlustOrHeroism)}
             ${checkRow('Hyperspeed', boolValue(w.hyperspeed), w.hyperspeed)}
             ${checkRow('Speed', boolValue(w.speedPotion), w.speedPotion)}
             ${trinketSnapshotRows(w)}
             ${checkRow('Your snapshotted Fallen Crusader', boolValue(w.fallenCrusader), w.fallenCrusader)}
             ${checkRow('Your snapshotted Sigil of Virulence', boolValue(w.sigilOfVirulence), w.sigilOfVirulence)}
             ${checkRow('Your snapshotted Unholy Might (T9 2pc)', boolValue(w.unholyMightT9), w.unholyMightT9)}
             ${checkRow('Your snapshotted Skyflare Swiftness', boolValue(w.skyflareSwiftness), w.skyflareSwiftness)}
             ${checkRow('Your snapshotted Black Magic', boolValue(w.blackMagic), w.blackMagic)}
           `).join('')}
         </div>
         `
      : '';
    const gargoyleSection = unholyGargoyleSection || (result.gargoyle && snapMeta
      ? `<div class="dk-analysis-section-title">${snapMeta.sectionTitle}</div>
         <div class="dk-analysis-spells">
           ${infoRow('Times used', result.gargoyle.uses)}
           ${result.gargoyle.snapshots.map((s, i) => `
             ${checkRow(`Use #${i + 1} — snapshot`, s.active.length ? s.active.join(', ') : 'none', !!s.active.length)}
             ${checkRow(`Use #${i + 1} — ${snapMeta.followUpLabel}`, boolValue(s.bloodPresenceAfter), s.bloodPresenceAfter)}
           `).join('')}
           ${gargoyleUptimes.map(uptimeRow).join('')}
         </div>
         <div class="dk-analysis-note">${snapMeta.note}</div>`
      : '');

    const armyOfTheDeadSection = unholy && unholy.armyOfTheDead
      ? `<div class="dk-analysis-section-title">Army of the Dead</div>
         <div class="dk-analysis-spells">
           ${armyDamage && armyDamage.damage > 0 ? infoRow('Damage', fmtInt(armyDamage.damage)) : infoRow('Damage', result.petDamageError ? 'unavailable' : '0 / not detected')}
           ${unholy.armyOfTheDead.map((a, i) => `
             ${unholy.armyOfTheDead.length > 1 ? `<div class="dk-analysis-section-title" style="font-size:11px;margin-top:10px;">Army #${i + 1}</div>` : ''}
             ${checkRow('Your snapshotted Bloodlust / Heroism', boolValue(a.bloodlustOrHeroism), a.bloodlustOrHeroism)}
             ${checkRow('Your snapshotted Hyperspeed', boolValue(a.hyperspeed), a.hyperspeed)}
             ${checkRow('Your snapshotted Skyflare Swiftness', boolValue(a.skyflareSwiftness), a.skyflareSwiftness)}
             ${checkRow('Your snapshotted Speed', boolValue(a.speedPotion), a.speedPotion)}
             ${checkRow('Your snapshotted Black Magic', boolValue(a.blackMagic), a.blackMagic)}
           `).join('')}
         </div>`
      : '';

    const ghoulRows = ghoulDamage && Array.isArray(ghoulDamage.rows) ? ghoulDamage.rows : [];
    const ghoulDetectedName = (petDamage && petDamage.ghoulName) || (unholy && unholy.ghoulName) || null;
    const clawRows = ghoulRows.filter((r) => /^Claw\b/i.test(r.name));
    const gnawRows = ghoulRows.filter((r) => /^Gnaw\b/i.test(r.name));
    const clawCasts = clawRows.reduce((sum, r) => sum + (r.casts || 0), 0);
    const gnawCasts = gnawRows.reduce((sum, r) => sum + (r.casts || 0), 0);
    const fightMinutes = result.raw && result.raw.RDURATION ? Number(result.raw.RDURATION) / 60 : 0;
    const clawPerMinute = fightMinutes > 0 && clawRows.length ? clawCasts / fightMinutes : null;
    const ghoulSection = unholy && ghoulDamage && ghoulDamage.damage > 0
      ? `<div class="dk-analysis-section-title">Ghoul</div>
         <div class="dk-analysis-spells">
           ${ghoulDetectedName ? infoRow('Pet', ghoulDetectedName) : ''}
           ${infoRow('Damage', fmtInt(ghoulDamage.damage))}
           ${clawPerMinute != null ? infoRow('You casted Claw', `${clawPerMinute.toFixed(2)} times per minute (${clawCasts} total)`) : ''}
           ${gnawRows.length ? infoRow('Gnaw', gnawCasts > 0 ? `used ${gnawCasts} time${gnawCasts === 1 ? '' : 's'}` : 'not used') : infoRow('Gnaw', 'not used')}
         </div>`
      : '';


    const consumableRows = frost && frost.consumables
      ? checkRow('You used Hyperspeed Accelerators', `${frost.consumables.hyperspeed.used} of ${frost.consumables.hyperspeed.possible} possible times`, frost.consumables.hyperspeed.used >= frost.consumables.hyperspeed.possible)
        + checkRow('You used Global Thermal Sapper Charge', `${frost.consumables.globalThermalSapperCharge.used} of ${frost.consumables.globalThermalSapperCharge.possible} possible times`, frost.consumables.globalThermalSapperCharge.used >= frost.consumables.globalThermalSapperCharge.possible)
        + checkRow('You used Saronite Bomb', `${frost.consumables.saroniteBomb.used} of ${frost.consumables.saroniteBomb.possible} possible times`, frost.consumables.saroniteBomb.used >= frost.consumables.saroniteBomb.possible)
        + checkRow('You had a Flask of Endless Rage', boolValue(frost.consumables.flaskUsed), frost.consumables.flaskUsed)
        + checkRow('Potions used (Speed / Indestructible)', `${frost.consumables.potionUses.length} of ${MAX_POTIONS_EXPECTED}`, frost.consumables.potionUses.length >= MAX_POTIONS_EXPECTED)
        + (frost.consumables.prepotOk != null ? checkRow('First potion was a pre-pot (≤60s before pull)', boolValue(frost.consumables.prepotOk), frost.consumables.prepotOk) : '')
      : '';
    const unholyConsumableRows = unholy && unholy.consumables
      ? checkRow('You used Hyperspeed Accelerators', `${unholy.consumables.hyperspeed.used} of ${unholy.consumables.hyperspeed.possible} possible times`, unholy.consumables.hyperspeed.used >= unholy.consumables.hyperspeed.possible)
        + checkRow('You used Global Thermal Sapper Charge', `${unholy.consumables.globalThermalSapperCharge.used} of ${unholy.consumables.globalThermalSapperCharge.possible} possible times`, unholy.consumables.globalThermalSapperCharge.used >= unholy.consumables.globalThermalSapperCharge.possible)
        + checkRow('You used Saronite Bomb', `${unholy.consumables.saroniteBomb.used} of ${unholy.consumables.saroniteBomb.possible} possible times`, unholy.consumables.saroniteBomb.used >= unholy.consumables.saroniteBomb.possible)
        + checkRow('You had a Flask of Endless Rage', boolValue(unholy.consumables.flaskUsed), unholy.consumables.flaskUsed)
      : '';
    const fireMageConsumableRows = fireMage && fireMage.miscellaneous
      ? checkRow('You used Hyperspeed Accelerators', `${fireMage.miscellaneous.hyperspeed.used} of ${fireMage.miscellaneous.hyperspeed.possible} possible times`, fireMage.miscellaneous.hyperspeed.used >= fireMage.miscellaneous.hyperspeed.possible)
        + checkRow('You used Global Thermal Sapper Charge', `${fireMage.miscellaneous.globalThermalSapperCharge.used} of ${fireMage.miscellaneous.globalThermalSapperCharge.possible} possible times`, fireMage.miscellaneous.globalThermalSapperCharge.used >= fireMage.miscellaneous.globalThermalSapperCharge.possible)
        + checkRow('You used Saronite Bomb', `${fireMage.miscellaneous.saroniteBomb.used} of ${fireMage.miscellaneous.saroniteBomb.possible} possible times`, fireMage.miscellaneous.saroniteBomb.used >= fireMage.miscellaneous.saroniteBomb.possible)
        + checkRow('You had a Flask of the Frost Wyrm', boolValue(fireMage.miscellaneous.flaskUsed), fireMage.miscellaneous.flaskUsed)
        + checkRow('Potions used (Wild Magic / Speed)', `${fireMage.miscellaneous.potionUses.length} of ${fireMage.miscellaneous.potionsPossible}`, fireMage.miscellaneous.potionUses.length >= fireMage.miscellaneous.potionsPossible)
        + checkRow('First potion was a pre-pot (≤60s before pull)', boolValue(fireMage.miscellaneous.prepotOk), fireMage.miscellaneous.prepotOk)
      : '';
    const miscSection = (consumableRows || unholyConsumableRows || fireMageConsumableRows)
      ? `<div class="dk-analysis-section-title">Miscellaneous</div>
         <div class="dk-analysis-spells">${consumableRows}${unholyConsumableRows}${fireMageConsumableRows}</div>`
      : '';
    const otherUptimesSection = !fireMage && otherUptimes.length
      ? `<div class="dk-analysis-section-title">Other Uptimes</div>
         <div class="dk-analysis-spells">${otherUptimes.map(uptimeRow).join('')}</div>`
      : '';

    const nothingFound = !fireMage && !rotationUptimes.length && !otherUptimes.length && !result.gargoyle && !castNoteRows
      ? '<div class="dk-analysis-spell-row"><span>No self-sourced auras with a start/end were detected in this attempt</span></div>'
      : '';

    const summaryTabHtml = `
      ${header}
      ${unholy || fireMage ? '' : `<div class="dk-analysis-summary"><strong>${result.totalEvents}</strong> total events across <strong>${result.uniqueSpells}</strong> distinct spells during the kill attempt.</div>`}
      ${speedSection}
      ${rotationSection}
      ${gargoyleSection}
      ${armyOfTheDeadSection}
      ${ghoulSection}
      ${miscSection}
      ${otherUptimesSection}
      ${nothingFound}
      <details class="dk-analysis-raw-toggle">
        <summary>View cast count by spell</summary>
        <div class="dk-analysis-spells">
          ${result.spellCounts.slice(0, 15).map((s) => `<div class="dk-analysis-spell-row"><span>${s.name}</span><span>${s.count}</span></div>`).join('')}
        </div>
      </details>
      ${isDkClass && !frost && !unholy ? '<div class="dk-analysis-note">Rune drift and wasted runic power are not calculated yet.</div>' : ''}`;

    // Ícono de wowhead a partir del nombre del ícono crudo (ej. "inv_sword_04").
    const iconImgHtml = (icon, name, size) => icon
      ? `<img class="dk-icon" src="https://wow.zamimg.com/images/wow/icons/medium/${icon}.jpg" alt="${name}" title="${name}" width="${size}" height="${size}">`
      : '';

    // Orden cronológico, recortando el pre-pull a los últimos 15s antes del pull.
    const PREPULL_WINDOW_MS = 15000;
    const timelineRowsDesc = result.timeline
      .filter((t) => t.ms >= -PREPULL_WINDOW_MS)
      .sort((a, b) => a.ms - b.ms);

    // DK usa una <table> normal (funciona bien, no tocar). Otras clases
    // (por ahora Warlock) usan un CSS Grid separado y propio —
    // deliberadamente SIN compartir clases/CSS con la tabla de DK, para
    // que un ajuste de una no le rompa nada a la otra nunca más.
    const timelineTabHtml = isDkClass ? `
      <div class="timeline-csv-toolbar">
        <div class="dk-analysis-summary">
          <strong>${timelineRowsDesc.length}</strong> casts, from -0:15.0 (pre-pull) to ${formatDuration(result.raw.RDURATION)}.
        </div>
        <button type="button" class="secondary timeline-csv-download">Download CSV</button>
      </div>
      <div class="dk-analysis-timeline-table-wrap">
        <table class="dk-analysis-timeline-table has-dk-cols">
          <thead>
            <tr>
              <th>Time</th>
              <th>Ability</th>
              <th>Target</th>
              <th>Buffs</th>
              <th>Procs</th>
            </tr>
          </thead>
          <tbody>
            ${timelineRowsDesc.map((t, i) => {
              const prevMs = i === 0 ? null : timelineRowsDesc[i - 1].ms;
              const gapSec = prevMs === null ? null : (t.ms - prevMs) / 1000;
              const gapHtml = gapSec !== null ? ` <span class="dk-timeline-gap">(+${gapSec.toFixed(2)}s)</span>` : '';
              return `
              <tr>
                <td class="dk-timeline-time">${formatTimelineMs(t.ms)}${gapHtml}</td>
                <td class="dk-timeline-spell">${iconImgHtml(t.icon, t.name, 26)}<span>${t.name}</span></td>
                <td class="dk-timeline-dim">${t.target && t.target !== 'nil' ? t.target : '–'}</td>
                <td><div class="dk-timeline-buffs">${t.buffs.length ? t.buffs.map((b) => iconImgHtml(b.icon, b.name, 22)).join('') : '–'}</div></td>
                <td><div class="dk-timeline-procs">${t.procs && t.procs.length ? t.procs.map((p) => iconImgHtml(p.icon, `${p.name} used`, 22)).join('') : '–'}</div></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>` : `
      <div class="timeline-csv-toolbar">
        <div class="dk-analysis-summary">
          <strong>${timelineRowsDesc.length}</strong> casts, from -0:15.0 (pre-pull) to ${formatDuration(result.raw.RDURATION)}.
        </div>
        <button type="button" class="secondary timeline-csv-download">Download CSV</button>
      </div>
      <div class="lock-timeline-wrap">
        <div class="lock-timeline-grid">
          <div class="lock-timeline-head">Time</div>
          <div class="lock-timeline-head">Ability</div>
          <div class="lock-timeline-head">Target</div>
          <div class="lock-timeline-head">Buffs</div>
          <div class="lock-timeline-head">Procs</div>
          ${timelineRowsDesc.map((t, i) => {
            const prevMs = i === 0 ? null : timelineRowsDesc[i - 1].ms;
            const gapSec = prevMs === null ? null : (t.ms - prevMs) / 1000;
            const gapHtml = gapSec !== null ? ` <span class="lock-timeline-gap">(+${gapSec.toFixed(2)}s)</span>` : '';
            return `
            <div class="lock-timeline-cell lock-timeline-time">${formatTimelineMs(t.ms)}${gapHtml}</div>
            <div class="lock-timeline-cell lock-timeline-spell">${iconImgHtml(t.icon, t.name, 26)}<span>${t.name}</span></div>
            <div class="lock-timeline-cell lock-timeline-target">${t.target && t.target !== 'nil' ? t.target : '–'}</div>
            <div class="lock-timeline-cell lock-timeline-buffs">${t.buffs.length ? t.buffs.map((b) => iconImgHtml(b.icon, b.name, 22)).join('') : '–'}</div>
            <div class="lock-timeline-cell lock-timeline-procs">${t.procs && t.procs.length ? t.procs.map((p) => iconImgHtml(p.icon, `${p.name} used`, 22)).join('') : '–'}</div>`;
          }).join('')}
        </div>
      </div>`;

    return `
      <div class="dk-analysis-panel" data-report-id="${reportId || ''}" data-boss-name="${String(bossName || '').replace(/"/g, '&quot;')}" data-player-name="${String(playerName || result.raw.NAME || '').replace(/"/g, '&quot;')}" data-bloodlust-windows="${encodedBloodlustWindows}">
        <div class="dk-analysis-warning">⚠ Experimental — undocumented uwu-logs.xyz endpoints. GCD delay is approximate; everything else is calculated from the real response, filtered by source (only your own buffs/debuffs).</div>
        <div class="dk-tabs">
          <button type="button" class="dk-tab active" data-dktab="resumen">Summary</button>
          <button type="button" class="dk-tab" data-dktab="timeline">Timeline</button>
          <button type="button" class="dk-tab" data-dktab="replay">Raid Replay</button>
        </div>
        <div class="dk-tab-pane" data-dkpane="resumen">${summaryTabHtml}</div>
        <div class="dk-tab-pane" data-dkpane="timeline" style="display:none;">${timelineTabHtml}</div>
        <div class="dk-tab-pane" data-dkpane="replay" style="display:none;"><div class="dk-analysis-summary">Open this tab to load the raid DPS replay.</div></div>
      </div>`;
  }

  // Corre el análisis completo para un jugador puntual y devuelve el HTML
  // de su panel ya armado (o un panel de error), sin tocar el DOM. Se usa
  // para las 2 columnas del compare.
  async function buildPlayerAnalysisColumn(reportId, bossName, playerName, dps, duration) {
    try {
      const result = await runDkAnalysis(reportId, bossName, playerName);
      if (result.parseError) {
        return `<div class="dk-analysis-panel"><div class="dk-analysis-error">Couldn't parse the site's response (unexpected format): ${result.parseError}. Check the browser console (F12 → Console tab) — the full response is there.</div></div>`;
      }
      return buildAnalysisPanelHtml(result, { reportId, playerName, bossName, dps, duration });
    } catch (err) {
      return `<div class="dk-analysis-panel"><div class="dk-analysis-error">Could not fetch the analysis: ${err.message}. Make sure you're running <code>proxy_server.py</code> (this isn't the public API, it needs the proxy).</div></div>`;
    }
  }

  async function renderLogAnalysis() {
    const body = $('analysisBody');
    if (!body || !activeAnalysisData) return;

    const { reportId, bossName, playerName, dps, duration } = activeAnalysisData;

    // ── Modo comparación: 2 columnas lado a lado ──────────────────────────
    if (compareWithPlayerName) {
      $('analysisSection').classList.add('is-comparing');
      body.innerHTML = '<div class="dk-analysis-panel">Loading comparison…</div>';

      const server = config.server || $('serverInput').value.trim();
      const cmpMember = config.members.find((m) => m.name === compareWithPlayerName);
      const cmpEntry = cmpMember ? dataCache[memberKey(server, cmpMember.name, cmpMember.spec)] : null;
      const cmpBossData = cmpEntry && cmpEntry.data ? findBossData(cmpEntry.data.bosses, bossName) : null;

      const [leftHtml, rightHtml] = await Promise.all([
        buildPlayerAnalysisColumn(reportId, bossName, playerName, dps, duration),
        cmpBossData
          ? buildPlayerAnalysisColumn(cmpBossData.report_id, bossName, compareWithPlayerName, cmpBossData.dps_max, cmpBossData.fastest_kill_duration)
          : Promise.resolve(`<div class="dk-analysis-panel"><div class="dk-analysis-error">${compareWithPlayerName} has no data against this boss.</div></div>`),
      ]);

      body.innerHTML = `
        <div class="compare-toolbar">
          <button type="button" class="secondary" id="stopCompareBtn">✕ Stop comparing</button>
        </div>
        <div class="compare-grid">
          <div class="compare-col">${leftHtml}</div>
          <div class="compare-col">${rightHtml}</div>
        </div>`;
      body.querySelectorAll('.compare-col').forEach((col) => wireAnalysisTabs(col));
      const stopBtn = $('stopCompareBtn');
      if (stopBtn) stopBtn.addEventListener('click', () => { compareWithPlayerName = null; renderLogAnalysis(); });
      return;
    }

    // ── Modo normal: un solo jugador ──────────────────────────────────────
    $('analysisSection').classList.remove('is-comparing');
    body.innerHTML = '<div class="dk-analysis-panel">Loading analysis…</div>';

    try {
      const result = await runDkAnalysis(reportId, bossName, playerName);

      const raw = result.raw || {};
      const dataObj = raw.DATA || raw.data || {};
      const spellsObj = raw.SPELLS || raw.spells || {};
      const rotationCfg = CLASS_ROTATION_CONFIG[(raw.CLASS || '').toLowerCase()] || DEFAULT_ROTATION_CONFIG;
      // Nombres de interés para el diagnóstico: los de la config de la clase
      // detectada (rotación + cast-count + cooldown snapshot), no una lista
      // fija de DK — así el log sirve para cualquier clase soportada.
      const suspectIds = [
        ...(rotationCfg.rotationSpellIds || []),
        ...(rotationCfg.castCountSpellIds || []),
        ...(rotationCfg.cooldownSnapshot && rotationCfg.cooldownSnapshot.summonSpellId ? [rotationCfg.cooldownSnapshot.summonSpellId] : []),
        '11129', // Combustion — diagnóstico, también por SpellID.
      ].map(String);
      // Para el sample completo: "1" (Melee, universal) + IDs de interés
      // configurados + el primer ID + los 5 hechizos con más eventos.
      // Los nombres se usan solo al imprimir el diagnóstico.

      const topByEvents = Object.keys(dataObj)
        .filter((id) => Array.isArray(dataObj[id]))
        .sort((a, b) => dataObj[b].length - dataObj[a].length)
        .slice(0, 5);
      const sampleIds = ['1', ...suspectIds, ...topByEvents, Object.keys(dataObj)[0]]
        .filter((id, i, arr) => id && arr.indexOf(id) === i);
      const sample = {
        FLAGS: raw.FLAGS,
        RDURATION: raw.RDURATION,
        NAME: raw.NAME,
        CLASS: raw.CLASS,
        spells: {},
      };
      sampleIds.forEach((id) => {
        sample.spells[id] = {
          info: spellsObj[id],
          first_12_events: Array.isArray(dataObj[id]) ? dataObj[id].slice(0, 12) : dataObj[id],
          total_events: Array.isArray(dataObj[id]) ? dataObj[id].length : null,
        };
      });
      console.log('Rotation analysis — copy this ENTIRE block of text:\n' + JSON.stringify(sample, null, 2));

      // Diagnóstico puntual: ¿los eventos de las habilidades de rotación de
      // esta clase vienen realmente con source === tu nombre (raw.NAME), o
      // hay otros nombres de source mezclados ahí (indicaría que el
      // endpoint no filtra por jugador y el self-check está fallando)?
      const suspectDebug = {};
      const selfName = raw.NAME;
      Object.keys(dataObj).forEach((id) => {
        const spellName = (spellsObj[id] && spellsObj[id].name) || `Spell #${id}`;
        if (!suspectIds.includes(String(id))) return;
        const events = Array.isArray(dataObj[id]) ? dataObj[id] : [];
        const sourceCounts = {};
        events.forEach((ev) => {
          const src = ev[2];
          sourceCounts[src] = (sourceCounts[src] || 0) + 1;
        });
        // Casteos REALMENTE tuyos (source Y ordenados), con el gap contra
        // el casteo anterior — si algún gap da bien por debajo del cooldown
        // real del hechizo, ahí sí hay algo duplicándose.
        const selfCastTimesMs = events
          .filter((ev) => ev[1] === 'SPELL_CAST_SUCCESS' && ev[2] === selfName)
          .map((ev) => ev[0])
          .sort((a, b) => a - b);
        const selfCastsWithGap = selfCastTimesMs.map((ms, i) => ({
          time: formatTimelineMs(ms),
          ms,
          gap_since_previous_sec: i === 0 ? null : ((ms - selfCastTimesMs[i - 1]) / 1000).toFixed(1),
        }));
        suspectDebug[spellName] = {
          spellId: id,
          selfName: raw.NAME,
          total_events: events.length,
          events_by_source: sourceCounts, // si hay más de una key acá, hay contaminación de otros jugadores/pets
          castSuccessEvents: events.filter((ev) => ev[1] === 'SPELL_CAST_SUCCESS').length,
          self_cast_count: selfCastTimesMs.length,
          self_casts_with_gap: selfCastsWithGap, // acá se ve si algún gap viola el cooldown
          first_10_events: events.slice(0, 10),
        };
      });
      console.log('Rotation analysis — rotation spell diagnostics (Ghoul Frenzy/Horn of Winter/Death and Decay for DK, Corruption/Immolate/etc for Warlock):\n' + JSON.stringify(suspectDebug, null, 2));

      // Diagnóstico de huecos grandes en el Timeline: para cada hueco >5s
      // entre dos casteos consecutivos (SPELL_CAST_SUCCESS), listamos TODOS
      // los eventos propios (cualquier flag, no solo CAST_SUCCESS) que
      // pasaron en el medio — así vemos si hay canalizados (SPELL_CAST_START
      // sin CAST_SUCCESS hasta que termina), Life Tap, o algo que el
      // Timeline no está contando como "casteo".
      {
        const selfName2 = raw.NAME;
        const allSelfEvents = [];
        Object.keys(dataObj).forEach((id) => {
          const name = (spellsObj[id] && spellsObj[id].name) || `Spell #${id}`;
          (dataObj[id] || []).forEach((ev) => {
            if (ev[2] === selfName2) allSelfEvents.push({ ms: ev[0], flag: ev[1], name, target: ev[3], raw: ev });
          });
        });
        allSelfEvents.sort((a, b) => a.ms - b.ms);
        const castSuccesses = allSelfEvents.filter((e) => e.flag === 'SPELL_CAST_SUCCESS');
        const bigGaps = [];
        for (let i = 1; i < castSuccesses.length; i++) {
          const gapMs = castSuccesses[i].ms - castSuccesses[i - 1].ms;
          if (gapMs > 5000) {
            bigGaps.push({
              from: { time: formatTimelineMs(castSuccesses[i - 1].ms), name: castSuccesses[i - 1].name },
              to: { time: formatTimelineMs(castSuccesses[i].ms), name: castSuccesses[i].name },
              gap_sec: (gapMs / 1000).toFixed(2),
              // TODO lo que pasó (cualquier flag) estrictamente entre esos dos casteos.
              events_in_gap: allSelfEvents.filter((e) => e.ms > castSuccesses[i - 1].ms && e.ms < castSuccesses[i].ms)
                .map((e) => ({ time: formatTimelineMs(e.ms), flag: e.flag, name: e.name, target: e.target })),
            });
          }
        }
        console.log(`Rotation analysis — big timeline gaps (>5s) for ${selfName2}, with everything that happened inside each gap:\n` + JSON.stringify(bigGaps, null, 2));
      }

      // Diagnóstico puntual: Combustion — el intervalo calculado, y qué
      // casteos (de cualquier hechizo) cayeron cerca (para ver si hay algún
      // cast tuyo DENTRO de esa ventana, o si de verdad no casteaste nada
      // en esos segundos exactos).
      if (result.debugIntervalsById && result.debugIntervalsById['11129']) {
        const combustionIntervals = result.debugIntervalsById['11129'];
        const nearbyDebug = combustionIntervals.map(([s, e]) => ({
          interval: [formatTimelineMs(s), formatTimelineMs(e)],
          casts_in_window: (result.timeline || [])
            .filter((t) => t.ms >= s - 2000 && t.ms <= e + 2000)
            .map((t) => ({ time: formatTimelineMs(t.ms), name: t.name, buffs: t.buffs.map((b) => b.name) })),
        }));
        console.log('Rotation analysis — Combustion interval(s) vs nearby casts:\n' + JSON.stringify(nearbyDebug, null, 2));
      } else {
        console.log('Rotation analysis — Combustion: no se calculó ningún intervalo (no pasó el filtro self-sourced, o no hay APPLIED/REMOVED para este ID).');
      }

      if (result.parseError) {
        body.innerHTML = `<div class="dk-analysis-panel"><div class="dk-analysis-error">Couldn't parse the site's response (unexpected format): ${result.parseError}. Check the browser console (F12 → Console tab) — the full response is there.</div></div>`;
      } else {
        const classIEntry = Object.entries(CLASS_MAP).find(([, c]) => c.name.toLowerCase().replace(/ /g, '-') === (result.raw.CLASS || '').toLowerCase());
        const classI = classIEntry ? Number(classIEntry[0]) : null;
        const className = classIEntry ? classIEntry[1].name : 'class';
        const candidates = classI != null ? getCompareCandidates(classI, bossName, playerName || result.raw.NAME) : [];

        const panelHtml = buildAnalysisPanelHtml(result, { reportId, playerName, bossName, dps, duration });

        body.innerHTML = `
          <div class="compare-toolbar">
            <button type="button" class="secondary" id="openCompareBtn" ${candidates.length ? '' : 'disabled title="No other roster member of this class has data against this boss"'}>⇄ Compare with another ${className}${candidates.length ? ` (${candidates.length})` : ''}</button>
            <div class="compare-picker" id="comparePicker" style="display:none;">
              ${candidates.map((c) => `<button type="button" class="compare-pick-btn" data-name="${c.name.replace(/"/g, '&quot;')}">${c.name}</button>`).join('')}
            </div>
          </div>
          ${panelHtml}`;

        wireAnalysisTabs(body);

        const openBtn = $('openCompareBtn');
        const picker = $('comparePicker');
        if (openBtn && picker) {
          openBtn.addEventListener('click', () => {
            picker.style.display = picker.style.display === 'none' ? '' : 'none';
          });
        }
        if (picker) {
          picker.querySelectorAll('.compare-pick-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
              compareWithPlayerName = btn.dataset.name;
              renderLogAnalysis();
            });
          });
        }
      }
    } catch (err) {
      body.innerHTML = `<div class="dk-analysis-panel"><div class="dk-analysis-error">Could not fetch the analysis: ${err.message}. Make sure you're running <code>proxy_server.py</code> (this isn't the public API, it needs the proxy).</div></div>`;
    }
  }

  function initDkAnalysis() {
    const backBtn = $('backFromAnalysisBtn');
    if (backBtn) backBtn.addEventListener('click', hideLogAnalysis);

    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.dk-analysis-btn');
      if (!btn) return;
      e.stopPropagation();

      const wrap = btn.closest('.dk-analysis-cell-wrap');
      if (!wrap) return;
      const { reportId, bossName, playerName, dps, duration } = wrap.dataset;

      showLogAnalysis({ reportId, bossName, playerName, dps, duration });
    });
  }

  function initPlayerProfile() {
    const backBtn = $('backFromProfileBtn');
    if (backBtn) backBtn.addEventListener('click', hidePlayerProfile);

    // Delegación de eventos: cualquier nombre de jugador clickeable, tanto en
    // el Roster como en el ranking por boss, abre el mismo perfil.
    document.addEventListener('click', (e) => {
      const nameEl = e.target.closest('.member-name, .boss-player-name');
      if (!nameEl) return;
      e.stopPropagation();
      const name = nameEl.textContent.trim();
      if (name) showPlayerProfile(name);
    });
  }

  function initViewTabs() {
    const wrap = $('viewTabs');
    if (!wrap) return;
    wrap.querySelectorAll('.view-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        viewMode = btn.dataset.view;
        profilePlayerName = null;
        activeAnalysisData = null;
        compareWithPlayerName = null;
        $('playerSection').style.display = 'none';
        $('analysisSection').style.display = 'none';
        wrap.querySelectorAll('.view-tab').forEach((b) => b.classList.toggle('active', b === btn));
        $('rosterSection').style.display = viewMode === 'roster' ? '' : 'none';
        $('bossSection').style.display = viewMode === 'boss' ? '' : 'none';
        render();
      });
    });
  }

  function initBossViewControls() {
    const phaseSelect = $('bossPhaseFilterSelect');
    if (phaseSelect) {
      phaseSelect.addEventListener('change', () => {
        bossPhaseFilter = phaseSelect.value;
        bossRaidFilter = ''; // al cambiar de fase, reseteamos raid y scope
        bossScope = '__ALL__';
        renderBossView();
      });
    }
    const raidSelect = $('bossRaidFilterSelect');
    if (raidSelect) {
      raidSelect.addEventListener('change', () => {
        bossRaidFilter = raidSelect.value;
        bossScope = '__ALL__'; // al cambiar de raid, volvemos a "raid completa" dentro de esa raid
        renderBossView();
      });
    }
    const scopeSelect = $('bossScopeSelect');
    if (scopeSelect) {
      scopeSelect.addEventListener('change', () => {
        bossScope = scopeSelect.value;
        renderBossView();
      });
    }
  }

  function downloadCsv() {
    const server = config.server || $('serverInput').value.trim();
    const rows = config.members.map((m) => {
      const key = memberKey(server, m.name, m.spec);
      return { ...m, entry: dataCache[key] || { status: 'idle' } };
    });

    const header = ['core', 'server', 'name', 'spec', 'role', 'class', 'overall_points', 'overall_rank', 'boss', 'points', 'rank_players', 'rank_raids', 'dps_max', 'fastest_kill_duration', 'raids', 'report_id'];
    const lines = [header.join(',')];

    rows.forEach((r) => {
      if (r.entry.status !== 'done') return;
      const d = r.entry.data;
      const classInfo = CLASS_MAP[d.class_i] || { name: `Clase #${d.class_i}` };
      const specValue = r.entry.detectedSpec || r.spec;
      const specInfo = getSpecInfo(d.class_i, specValue);
      const bosses = Object.entries(d.bosses || {}).filter(([, b]) => b && Object.keys(b).length > 0);
      const core = r.core || DEFAULT_CORE;

      if (!bosses.length) {
        lines.push([core, server, r.name, specInfo.name, specInfo.role, classInfo.name, formatScore(d.overall_points), d.overall_rank ?? '', '', '', '', '', '', '', '', ''].map(csvEscape).join(','));
        return;
      }
      bosses.forEach(([bossName, b]) => {
        lines.push([
          core, server, r.name, specInfo.name, specInfo.role, classInfo.name, formatScore(d.overall_points), d.overall_rank ?? '',
          bossName, formatScore(b.points), b.rank_players ?? '', b.rank_raids ?? '', b.dps_max ?? '',
          b.fastest_kill_duration ?? '', b.raids ?? '', b.report_id ?? '',
        ].map(csvEscape).join(','));
      });
    });

    if (lines.length === 1) {
      alert('No data loaded yet to export. Add characters and wait for them to load.');
      return;
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(config.guildName || 'guild').replace(/[^a-z0-9]/gi, '_')}_roster.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function csvEscape(value) {
    const str = String(value);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  }

  function bulkAddMembers() {
    const server = $('serverInput').value.trim();
    if (!server) { alert('Enter the server before adding characters.'); return; }
    const core = $('bulkCoreInput').value.trim() || DEFAULT_CORE;

    const lines = $('bulkInput').value.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) { return; }

    let added = 0;
    let skippedDup = 0;
    let invalid = 0;
    const toFetch = [];
    // Nombres ya en el roster (case-insensitive) + los que se van agregando
    // en esta misma tanda, para no duplicar ni contra lo existente ni
    // dentro del propio pegado.
    const seenNames = new Set(config.members.map((m) => m.name.toLowerCase()));

    lines.forEach((line) => {
      const parts = line.split(/[,;\t]+|\s+/).map((p) => p.trim()).filter(Boolean);
      const name = parts[0];
      const specRaw = parts[1];
      if (!name || (specRaw && !['1', '2', '3'].includes(specRaw))) {
        invalid++;
        return;
      }
      const spec = specRaw || AUTO_SPEC;
      const nameKey = name.toLowerCase();
      if (seenNames.has(nameKey)) {
        skippedDup++;
        return;
      }
      seenNames.add(nameKey);
      config.members.push({ name, spec, core });
      toFetch.push({ name, spec });
      added++;
    });

    config.server = server;
    saveConfig();
    render();
    $('bulkInput').value = '';
    $('bulkResult').textContent = `Added to ${core}: ${added} · Duplicates skipped: ${skippedDup} · Invalid lines: ${invalid}`;

    (async () => {
      for (const m of toFetch) {
        await fetchMember(server, m.name, m.spec);
      }
    })();
  }

  $('addBtn').addEventListener('click', addMember);
  $('refreshBtn').addEventListener('click', refreshAll);
  $('downloadBtn').addEventListener('click', downloadCsv);
  $('bulkAddBtn').addEventListener('click', bulkAddMembers);
  $('guildName').addEventListener('change', () => { config.guildName = $('guildName').value; saveConfig(); });
  $('serverInput').addEventListener('change', () => { config.server = $('serverInput').value.trim(); saveConfig(); });
  $('nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') addMember(); });

  initClassFilter();
  initAddClassSpec();
  initRosterFilterControls();
  initViewTabs();
  initBossViewControls();
  initPlayerProfile();
  initDkAnalysis();
  loadState();
