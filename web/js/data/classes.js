// Datos de clases/specs de WotLK, y helpers puros derivados de ellos. Sin
// dependencias de estado — solo constantes y funciones que reciben y
// devuelven datos.

  // Mapeo class_i -> clase. Solo class_i=0 (Death Knight) está confirmado en vivo;
  // el resto se infiere asumiendo orden alfabético de las 10 clases de WotLK.
  export const CLASS_MAP = {
    0: { name: 'Death Knight', color: '#C41F3B' },
    1: { name: 'Druid', color: '#FF7D0A' },
    2: { name: 'Hunter', color: '#ABD473' },
    3: { name: 'Mage', color: '#69CCF0' },
    4: { name: 'Paladin', color: '#F58CBA' },
    5: { name: 'Priest', color: '#FFFFFF' },
    6: { name: 'Rogue', color: '#FFF569' },
    7: { name: 'Shaman', color: '#0070DE' },
    8: { name: 'Warlock', color: '#9482C9' },
    9: { name: 'Warrior', color: '#C79C6E' },
  };

  // Mapeo class_i + spec -> {name, role}. Igual que CLASS_MAP, solo class_i=0
  // está confirmado en vivo; el resto asume el orden estándar de árboles de
  // talentos de WotLK (1/2/3 tal como los muestra el cliente de WoW). Todas
  // las specs de sanación pura se marcan "Healing"; el resto (incluidos
  // tanks) queda como "Damage", porque así es como las cuenta un meter de dps.
  export const SPEC_MAP = {
    0: { 1: { name: 'Blood', role: 'Damage' }, 2: { name: 'Frost', role: 'Damage' }, 3: { name: 'Unholy', role: 'Damage' } },
    1: { 1: { name: 'Balance', role: 'Damage' }, 2: { name: 'Feral', role: 'Damage' }, 3: { name: 'Restoration', role: 'Healing' } },
    2: { 1: { name: 'Beast Mastery', role: 'Damage' }, 2: { name: 'Marksmanship', role: 'Damage' }, 3: { name: 'Survival', role: 'Damage' } },
    3: { 1: { name: 'Arcane', role: 'Damage' }, 2: { name: 'Fire', role: 'Damage' }, 3: { name: 'Frost', role: 'Damage' } },
    4: { 1: { name: 'Holy', role: 'Healing' }, 2: { name: 'Protection', role: 'Damage' }, 3: { name: 'Retribution', role: 'Damage' } },
    5: { 1: { name: 'Discipline', role: 'Healing' }, 2: { name: 'Holy', role: 'Healing' }, 3: { name: 'Shadow', role: 'Damage' } },
    6: { 1: { name: 'Assassination', role: 'Damage' }, 2: { name: 'Combat', role: 'Damage' }, 3: { name: 'Subtlety', role: 'Damage' } },
    7: { 1: { name: 'Elemental', role: 'Damage' }, 2: { name: 'Enhancement', role: 'Damage' }, 3: { name: 'Restoration', role: 'Healing' } },
    8: { 1: { name: 'Affliction', role: 'Damage' }, 2: { name: 'Demonology', role: 'Damage' }, 3: { name: 'Destruction', role: 'Damage' } },
    9: { 1: { name: 'Arms', role: 'Damage' }, 2: { name: 'Fury', role: 'Damage' }, 3: { name: 'Protection', role: 'Damage' } },
  };

  // Ícono de Wowhead del árbol de talentos por class_i + spec (mismo criterio
  // que los íconos de hechizos del analizador: se linkean desde el CDN
  // público de Wowhead, no se reproducen/hostean acá).
  export const SPEC_ICON = {
    0: { 1: 'spell_deathknight_bloodpresence', 2: 'spell_deathknight_frostpresence', 3: 'spell_deathknight_unholypresence' },
    1: { 1: 'spell_nature_starfall', 2: 'ability_druid_catform', 3: 'spell_nature_healingtouch' },
    2: { 1: 'ability_hunter_bestialdiscipline', 2: 'ability_marksmanship', 3: 'ability_hunter_camouflage' },
    3: { 1: 'spell_holy_magicalsentry', 2: 'spell_fire_firebolt02', 3: 'spell_frost_frostbolt02' },
    4: { 1: 'spell_holy_holybolt', 2: 'spell_holy_devotionaura', 3: 'spell_holy_auraoflight' },
    5: { 1: 'spell_holy_wordfortitude', 2: 'spell_holy_guardianspirit', 3: 'spell_shadow_shadowwordpain' },
    6: { 1: 'ability_rogue_eviscerate', 2: 'ability_backstab', 3: 'ability_stealth' },
    7: { 1: 'spell_nature_lightning', 2: 'spell_nature_lightningshield', 3: 'spell_nature_magicimmunity' },
    8: { 1: 'spell_shadow_deathcoil', 2: 'spell_shadow_metamorphosis', 3: 'spell_shadow_rainoffire' },
    9: { 1: 'ability_warrior_savageblow', 2: 'ability_warrior_innerrage', 3: 'ability_warrior_defensivestance' },
  };
  export function specIconHtml(classI, specNum, size) {
    const icon = SPEC_ICON[classI] && SPEC_ICON[classI][specNum];
    if (!icon) return '';
    const label = (SPEC_MAP[classI] && SPEC_MAP[classI][specNum] && SPEC_MAP[classI][specNum].name) || '';
    return `<img class="spec-icon" src="https://wow.zamimg.com/images/wow/icons/medium/${icon}.jpg" alt="${label}" title="${label}" width="${size}" height="${size}">`;
  }

  export function getSpecInfo(classI, spec) {
    const bySpec = SPEC_MAP[classI];
    const info = bySpec && bySpec[Number(spec)];
    return info || { name: spec ? `Spec ${spec}` : '?', role: 'Damage' };
  }
