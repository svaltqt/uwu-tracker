// Datos de raids/jefes/fases de WotLK, y helpers de normalización de
// nombres (el server puede devolver un boss bajo distintos alias). Sin
// dependencias de estado.

  // La API devuelve bosses de VARIAS raids mezclados en el mismo objeto
  // `bosses` de un personaje (confirmado: "Northrend Beasts" -de Trial of the
  // Crusader- y "Koralon the Flame Watcher" -de Vault of Archavon- aparecen
  // juntos en la misma respuesta). Como el campo raid_id que devuelve la
  // API no está documentado/confirmado en su formato real, agrupamos por
  // nombre de boss contra esta tabla estática de los raids de WotLK. Un boss
  // que no esté acá cae en "Other" instead of disappearing.
  // Lista de raids/jefes de WotLK. `name` es el nombre CANÓNICO —el que
  // confirmó el usuario que devuelve realmente el server, en inglés— y es lo
  // que se muestra en los selects incluso sin ningún log cargado todavía.
  // `aliases` son variantes (nombres en español, u otras) que también hacen
  // match si el server llegara a devolver eso en cambio.
  export const RAID_BOSS_LIST = [
    { raid: 'Naxxramas', bosses: [
      { name: 'Patchwerk', aliases: ['Remendejo'] },
      { name: 'Grobbulus' },
      { name: 'Gluth' },
      { name: 'Thaddius' },
      { name: "Anub'Rekhan" },
      { name: 'Grand Widow Faerlina', aliases: ['Gran Viuda Faerlina'] },
      { name: 'Maexxna' },
      { name: 'Instructor Razuvious' },
      { name: 'Gothik the Harvester', aliases: ['Gothik el Cosechador'] },
      { name: 'The Four Horsemen', aliases: ['Los Cuatro Jinetes'] },
      { name: 'Noth the Plaguebringer', aliases: ['Noth el Pesteador'] },
      { name: 'Heigan the Unclean', aliases: ['Heigan el Impuro'] },
      { name: 'Loatheb' },
      { name: 'Sapphiron' },
      { name: "Kel'Thuzad" },
    ] },
    { raid: 'The Eye of Eternity', aliases: ['El Ojo de la Eternidad'], bosses: [{ name: 'Malygos' }] },
    { raid: 'The Obsidian Sanctuary', aliases: ['Sagrario Obsidiana'], bosses: [{ name: 'Sartharion' }] },
    { raid: 'Ulduar', bosses: [
      { name: 'Flame Leviathan', aliases: ['Leviatán de Llamas'] },
      { name: 'Ignis the Furnace Master', aliases: ['Ignis, el Maestro de la Caldera'] },
      { name: 'Razorscale', aliases: ['Tachoscuro'] },
      { name: 'XT-002 Deconstructor', aliases: ['Desarmador XA-002', 'Desarmador XT-002'] },
      { name: 'The Iron Assembly', aliases: ['Asamblea de Hierro', 'Steelbreaker', 'Rompecielos', 'Runemaster Molgeim', 'Molgeim', 'Stormcaller Brundir', 'Brundir'] },
      { name: 'Kologarn' },
      { name: 'Auriaya' },
      { name: 'Freya' },
      { name: 'Hodir' },
      { name: 'Mimiron' },
      { name: 'Thorim' },
      { name: 'General Vezax' },
      { name: 'Yogg-Saron' },
      { name: 'Algalon the Observer', aliases: ['Algalon el Observador'] },
    ] },
    { raid: 'Trial of the Crusader', aliases: ['Prueba del Cruzado'], bosses: [
      { name: 'Northrend Beasts', aliases: ['The Beasts of Northrend', 'Las Bestias de Nortrend', 'Gormok', 'Acidmaw and Dreadscale', 'Ácido y Pavor', 'Icehowl', 'Aullaneve'] },
      { name: 'Lord Jaraxxus' },
      { name: 'Faction Champions', aliases: ['Campeones de la Facción'] },
      { name: "Twin Val'kyr", aliases: ["Val'kyr Gemelas", 'Fjola Lightbane', 'Fjola', 'Eydis Darkbane', 'Eydis'] },
      { name: "Anub'arak" },
    ] },
    { raid: "Onyxia's Lair", aliases: ['Guarida de Onyxia'], bosses: [{ name: 'Onyxia' }] },
    { raid: 'Icecrown Citadel', aliases: ['Ciudadela de la Corona de Hielo'], bosses: [
      { name: 'Lord Marrowgar', aliases: ['Lord Tuétano'] },
      { name: 'Lady Deathwhisper', aliases: ['Lady Susurramuerte'] },
      { name: 'Icecrown Gunship Battle', aliases: ['Batalla de los Cañoneros'] },
      { name: 'Deathbringer Saurfang', aliases: ['Libramorte Saurfang'] },
      { name: 'Rotface', aliases: ['Panzachancro'] },
      { name: 'Festergut', aliases: ['Carapútrea'] },
      { name: 'Professor Putricide', aliases: ['Profesor Putricida'] },
      { name: 'Blood Prince Council', aliases: ['Consejo de los Príncipes de la Sangre'] },
      { name: "Blood-Queen Lana'thel", aliases: ['Reina de la Sangre Lana\'thel'] },
      { name: 'Valithria Dreamwalker', aliases: ['Valithria Caminasueños'] },
      { name: 'Sindragosa' },
      { name: 'The Lich King', aliases: ['El Rey Exánime'] },
    ] },
    { raid: 'The Ruby Sanctuary', aliases: ['Sagrario Rubí'], bosses: [{ name: 'Halion' }] },
    { raid: 'Vault of Archavon', aliases: ['La Cámara de Archavon'], bosses: [
      { name: 'Archavon the Stone Watcher', aliases: ['Archavon el Vigía de Piedra'] },
      { name: 'Emalon the Storm Watcher', aliases: ['Emalon el Vigía de la Tormenta'] },
      { name: 'Koralon the Flame Watcher', aliases: ['Koralon el Vigía de la Llama'] },
      { name: 'Toravon the Ice Watcher', aliases: ['Toravon el Vigía del Hielo'] },
    ] },
  ];

  export const BOSS_RAID_MAP = {};
  // Mapa inverso: cualquier nombre (alias o sub-boss) → nombre canónico.
  // Sirve para normalizar los keys que devuelve la API (ej. "Northrend Beasts")
  // al nombre canónico que usa la UI ("The Beasts of Northrend").
  export const ALIAS_TO_CANONICAL = {};
  RAID_BOSS_LIST.forEach(({ raid, bosses }) => {
    bosses.forEach(({ name, aliases }) => {
      BOSS_RAID_MAP[name] = raid;
      ALIAS_TO_CANONICAL[name] = name; // el canónico se mapea a sí mismo
      (aliases || []).forEach((alias) => {
        BOSS_RAID_MAP[alias] = raid;
        ALIAS_TO_CANONICAL[alias] = name;
      });
    });
  });

  // Busca la data de un boss en el objeto `bosses` de la respuesta de la API,
  // probando primero el nombre canónico y luego todos sus aliases conocidos.
  // La API puede devolver el boss bajo cualquier variante (ej. "Northrend Beasts"
  // en vez de "The Beasts of Northrend"), así que hay que probar todas.
  export function findBossData(bosses, canonicalName) {
    if (!bosses) return null;
    // Intento directo con el nombre canónico
    if (bosses[canonicalName] && Object.keys(bosses[canonicalName]).length) return bosses[canonicalName];
    // Buscar bajo cualquier alias conocido de este boss
    const entry = RAID_BOSS_LIST.flatMap((r) => r.bosses).find((b) => b.name === canonicalName);
    if (entry && entry.aliases) {
      for (const alias of entry.aliases) {
        if (bosses[alias] && Object.keys(bosses[alias]).length) return bosses[alias];
      }
    }
    return null;
  }

  // Orden de progresión para el selector de Raid (no alfabético) — el mismo
  // orden en que las pasó el usuario.
  export const RAID_ORDER = [...RAID_BOSS_LIST.map((r) => r.raid), 'Other'];

  export function getRaidForBoss(bossName) {
    return BOSS_RAID_MAP[bossName] || 'Other';
  }

  // Nombres canónicos de los jefes de una raid conocida, tal como hay que
  // mostrarlos aunque todavía no exista ningún log cargado para ella.
  export function getCanonicalBossNames(raid) {
    const entry = RAID_BOSS_LIST.find((r) => r.raid === raid);
    return entry ? entry.bosses.map((b) => b.name) : [];
  }

  export function getAllCanonicalBossNames() {
    return RAID_BOSS_LIST.flatMap((r) => r.bosses.map((b) => b.name));
  }

  // Fases de contenido de WotLK (4.5 en total). Vault of Archavon es
  // "evergreen" y va sumando un jefe nuevo por fase en vez de abrir de una,
  // así que ahí filtramos boss por boss en vez de por raid entera.
  export const PHASE_ORDER = ['Phase 1', 'Phase 2', 'Phase 3', 'Phase 4', 'Phase 4.5'];

  export const PHASE_BOSSES = {
    'Phase 1': [
      ...getCanonicalBossNames('Naxxramas'),
      'Onyxia', 'Malygos', 'Sartharion',
      'Archavon the Stone Watcher',
    ],
    'Phase 2': [
      ...getCanonicalBossNames('Ulduar'),
      'Emalon the Storm Watcher',
    ],
    'Phase 3': [
      ...getCanonicalBossNames('Trial of the Crusader'),
      'Koralon the Flame Watcher',
    ],
    'Phase 4': [
      ...getCanonicalBossNames('Icecrown Citadel'),
      'Toravon the Ice Watcher',
    ],
    'Phase 4.5': [
      'Halion',
    ],
  };

  // Raids que tienen al menos un jefe en esa fase (para hacer coincidir el
  // filtro de Fase con el de Raid, como pidió el usuario).
  export function getRaidsForPhase(phase) {
    const bosses = PHASE_BOSSES[phase] || [];
    const raids = new Set(bosses.map(getRaidForBoss).filter((r) => r !== 'Other'));
    return RAID_ORDER.filter((r) => raids.has(r));
  }

