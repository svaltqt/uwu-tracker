// Config de rotación por clase para el análisis de logs (botón "View
// analysis" / Compare) — un objeto por clase en vez de un if/else en la
// lógica de análisis. Agregar una clase nueva es agregar una entrada acá.

  // Cada clase define: qué DoTs/debuffs propios van en "Rotation" (en vez de
  // "Misc"), qué se excluye de la columna Buffs del timeline (para no
  // duplicar lo que ya se ve en Rotation), qué casteos interesa contar en
  // vez de uptime-ar, y opcionalmente un "cooldown snapshot" (como Gárgola
  // para DK) si la clase tiene un cooldown icónico con buffs de
  // fuerza/haste relevantes en el momento exacto de usarlo.
  export const CLASS_ROTATION_CONFIG = {
    'death-knight': {
      rotationNames: ['Desolation', 'Ghoul Frenzy', 'Bone Shield', 'Unholy Blight', 'Blood Plague', 'Frost Fever', 'Death and Decay'],
      timelineBuffExclude: ['Blood Tap', 'Death and Decay', 'Ebon Plague', 'Blood Plague', 'Frost Fever'],
      castCountSpells: ['Horn of Winter'],
      macroSpamThreshold: 50,
      cooldownSnapshot: {
        sectionTitle: 'Gargoyle & Haste Snapshots',
        summonSpellName: 'Summon Gargoyle',
        uptimeNames: ['Summon Gargoyle', 'Paragon', 'Greatness'],
        snapshotCheckNames: ['Unholy Presence', 'Hyperspeed Accelerators', 'Speed Potion', 'Berserking'],
        followUpSpellName: 'Blood Presence',
        followUpLabel: 'switched to Blood Presence',
        note: 'Gargoyle-specific damage: not calculated yet. The exact definition of what counts as a "snapshot" is still being fine-tuned.',
      },
    },
    // Afflicton/Demonology/Destruction comparten estos DoTs/curses en mayor o
    // menor medida — los que no uses simplemente no van a aparecer en tus
    // datos (spellIds solo trae lo que realmente casteaste). No hay un
    // cooldown único equivalente a la Gárgola entre las 3 specs, así que esa
    // sección queda afuera para Warlock.
    warlock: {
      rotationNames: ['Corruption', 'Unstable Affliction', 'Curse of Agony', 'Curse of Doom', 'Bane of Doom', 'Immolate', 'Shadowflame', 'Haunt'],
      timelineBuffExclude: ['Corruption', 'Unstable Affliction', 'Curse of Agony', 'Curse of Doom', 'Bane of Doom', 'Immolate', 'Shadowflame', 'Haunt'],
      castCountSpells: [],
      macroSpamThreshold: 50,
      cooldownSnapshot: null,
    },
    // Mago no tiene DoTs "clásicos" como DK/Warlock — la mayoría de su daño
    // es directo (Fireball, Frostbolt, Arcane Blast). Lo poco que sí deja un
    // debuff con inicio/fin propio en el target va acá; el resto de la
    // rotación (nukes directos) se ve igual en el Timeline, solo que no
    // tiene una barra de "uptime" porque no aplica. Tampoco hay un cooldown
    // único equivalente a la Gárgola entre Fuego/Escarcha/Arcano (Combustion,
    // Icy Veins, Arcane Power son cosas distintas), así que esa sección
    // queda afuera para Mago también.
    mage: {
      rotationNames: ['Living Bomb', "Winter's Chill", 'Slow', 'Ignite'],
      timelineBuffExclude: ['Living Bomb', "Winter's Chill", 'Slow', 'Ignite'],
      castCountSpells: [],
      macroSpamThreshold: 50,
      cooldownSnapshot: null,
    },
    // Debuffs con inicio/fin propio que un Warrior deja sobre el objetivo,
    // compartidos en mayor o menor medida entre Armas/Furia/Protección:
    // Rend (sangrado), Deep Wounds (proc de sangrado por crítico, pasivo de
    // Armas), Thunder Clap (reduce velocidad de ataque), Demoralizing Shout
    // (reduce daño físico) y Sunder Armor (stackea reducción de armadura,
    // clave para tanks). Como con Mago/Warlock, no hay un cooldown único
    // equivalente a la Gárgola entre las 3 specs (Bladestorm es solo de
    // Armas), así que esa sección queda afuera.
    warrior: {
      rotationNames: ['Rend', 'Deep Wounds', 'Thunder Clap', 'Demoralizing Shout', 'Sunder Armor'],
      timelineBuffExclude: ['Rend', 'Deep Wounds', 'Thunder Clap', 'Demoralizing Shout', 'Sunder Armor'],
      castCountSpells: [],
      macroSpamThreshold: 50,
      cooldownSnapshot: null,
    },
    // Debuffs con inicio/fin propio que un Rogue deja sobre el objetivo, y
    // Slice and Dice (buff propio, clave del ritmo de combo points), compartidos
    // en mayor o menor medida entre Asesinato/Combate/Sutileza: Rupture y
    // Garrote (sangrados), Deadly Poison (veneno que stackea), Expose Armor
    // (reduce armadura) y Hunger for Blood (buff de Combate que requiere un
    // sangrado activo en el target para poder refrescarse). Como con
    // Mago/Warlock/Warrior, no hay un cooldown único equivalente a la
    // Gárgola entre las 3 specs (Cold Blood es de Asesinato, Adrenaline Rush
    // de Combate, Shadowstep de Sutileza), así que esa sección queda afuera.
    rogue: {
      rotationNames: ['Slice and Dice', 'Rupture', 'Garrote', 'Deadly Poison', 'Expose Armor', 'Hunger for Blood'],
      timelineBuffExclude: ['Slice and Dice', 'Rupture', 'Garrote', 'Deadly Poison', 'Expose Armor', 'Hunger for Blood'],
      castCountSpells: [],
      macroSpamThreshold: 50,
      cooldownSnapshot: null,
    },
    // Debuffs con inicio/fin propio que un Hunter deja sobre el objetivo,
    // más Rapid Fire y Bestial Wrath (cooldowns propios que son parte
    // central del rotation, aunque no sean DoTs), compartidos en mayor o
    // menor medida entre Beast Mastery/Marksmanship/Survival: Serpent Sting
    // (DoT base), Black Arrow (DoT de Survival), Hunter's Mark (debuff de
    // largo duración) y Piercing Shots (sangrado por crítico, talento de
    // Marksmanship). No hay un cooldown único equivalente a la Gárgola
    // entre las 3 specs (Bestial Wrath es solo de Beast Mastery), así que
    // esa sección queda afuera.
    hunter: {
      rotationNames: ['Serpent Sting', 'Black Arrow', "Hunter's Mark", 'Piercing Shots', 'Rapid Fire', 'Bestial Wrath'],
      timelineBuffExclude: ['Serpent Sting', 'Black Arrow', "Hunter's Mark", 'Piercing Shots', 'Rapid Fire', 'Bestial Wrath'],
      castCountSpells: [],
      macroSpamThreshold: 50,
      cooldownSnapshot: null,
    },
    // Debuffs con inicio/fin propio que un Paladin deja sobre el objetivo, más
    // Consecration (DoT en área bajo el jugador, igual criterio que Death and
    // Decay para DK) y Avenging Wrath (cooldown propio compartido entre las
    // 3 specs), compartidos en mayor o menor medida entre Retribución/Sagrado/
    // Protección: Judgement of Wisdom, Judgement of Light y Judgement of
    // Command son los 3 posibles resultados de Judgement — solo va a
    // aparecer el que realmente uses, el resto simplemente no tiene datos.
    // No hay un cooldown único equivalente a la Gárgola entre las 3 specs,
    // así que esa sección queda afuera.
    paladin: {
      rotationNames: ['Judgement of Wisdom', 'Judgement of Light', 'Judgement of Command', 'Consecration', 'Avenging Wrath'],
      timelineBuffExclude: ['Judgement of Wisdom', 'Judgement of Light', 'Judgement of Command', 'Consecration', 'Avenging Wrath'],
      castCountSpells: [],
      macroSpamThreshold: 50,
      cooldownSnapshot: null,
    },
    // Debuffs con inicio/fin propio que un Druid deja sobre el objetivo, más
    // Savage Roar (buff propio, ritmo de combo points en Feral/Cat). Cubre
    // Balance (Moonfire, Insect Swarm) y Feral (Rip, Rake, Mangle, Lacerate,
    // Faerie Fire, Savage Roar) — solo van a aparecer datos en los que
    // realmente uses según tu spec/gameplay. Restoration es healer y queda
    // fuera del score de daño (ver limitación de HPS), pero el análisis de
    // rotación no depende de eso. No hay un cooldown único equivalente a la
    // Gárgola compartido entre Balance/Feral/Restoration, así que esa
    // sección queda afuera.
    druid: {
      rotationNames: ['Moonfire', 'Insect Swarm', 'Rip', 'Rake', 'Mangle', 'Lacerate', 'Faerie Fire', 'Savage Roar'],
      timelineBuffExclude: ['Moonfire', 'Insect Swarm', 'Rip', 'Rake', 'Mangle', 'Lacerate', 'Faerie Fire', 'Savage Roar'],
      castCountSpells: [],
      macroSpamThreshold: 50,
      cooldownSnapshot: null,
    },
    // Debuffs con inicio/fin propio que un Priest deja sobre el objetivo.
    // Discipline y Holy son healers puros (fuera del score de daño por la
    // limitación de HPS), así que esto en la práctica solo va a tener datos
    // en Shadow: Shadow Word: Pain, Vampiric Touch y Devouring Plague son
    // los 3 DoTs principales de esa spec. No hay cooldown único a snapshotear.
    priest: {
      rotationNames: ['Shadow Word: Pain', 'Vampiric Touch', 'Devouring Plague'],
      timelineBuffExclude: ['Shadow Word: Pain', 'Vampiric Touch', 'Devouring Plague'],
      castCountSpells: [],
      macroSpamThreshold: 50,
      cooldownSnapshot: null,
    },
    // Debuffs con inicio/fin propio que un Shaman deja sobre el objetivo:
    // Flame Shock (DoT de Elemental) y Stormstrike / Frostbrand Attack
    // (debuffs de Enhancement). Restoration es healer y queda fuera del
    // score de daño. No hay cooldown único compartido entre las 3 specs.
    shaman: {
      rotationNames: ['Flame Shock', 'Stormstrike', 'Frostbrand Attack'],
      timelineBuffExclude: ['Flame Shock', 'Stormstrike', 'Frostbrand Attack'],
      castCountSpells: [],
      macroSpamThreshold: 50,
      cooldownSnapshot: null,
    },
  };
  export const DEFAULT_ROTATION_CONFIG = { rotationNames: [], timelineBuffExclude: [], castCountSpells: [], macroSpamThreshold: 50, cooldownSnapshot: null };
