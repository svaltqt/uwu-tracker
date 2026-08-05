# Cómo funciona la API

Este proyecto habla con **dos** APIs distintas, y es importante no confundirlas:

1. **La API externa de uwu-logs.xyz** — no documentada oficialmente. Todo lo que sabemos de
   ella lo sacamos probándola en vivo o leyendo el código público del sitio
   ([github.com/Ridepad/uwu-logs](https://github.com/Ridepad/uwu-logs)). Puede cambiar sin
   aviso.
2. **La API interna de `proxy_server.py`** (rutas `/api/...`) — la que realmente usa
   `web/js/app.js`. Nunca le pega directo a uwu-logs.xyz desde el navegador (ver
   [sección CORS](#por-qué-existe-un-proxy)).

```
Navegador (web/js/app.js)
        │  fetch('/api/...')
        ▼
proxy_server.py  (localhost:8000)
        │  urlopen('https://uwu-logs.xyz/...')
        ▼
uwu-logs.xyz
```

---

## Por qué existe un proxy

El navegador bloquea que JavaScript le pegue directo a `uwu-logs.xyz` porque ese sitio no
manda el header `Access-Control-Allow-Origin` (política CORS). `proxy_server.py` corre en tu
máquina como script de Python (no como código de navegador), así que a él CORS no lo
afecta — recibe la petición del navegador en `localhost` (mismo origen, sin problema) y él sí
le pega a uwu-logs.xyz del lado del servidor, igual que hace `requests` en el CLI.

Si algún día abrís `web/index.html` con otro servidor (ej. `python3 -m http.server`) en vez
de `proxy_server.py`, todo el roster va a mostrar "Error al traer datos": ese servidor no
tiene ninguna de las rutas `/api/*` que el frontend necesita.

---

## 1. La API externa (uwu-logs.xyz)

### Nivel de confianza de cada endpoint

| Endpoint | Confirmado en vivo | Nota |
|---|---|---|
| `POST /character` | ✅ Sí (jul. 2026) | Base de todo el roster/ranking |
| `POST /logs_list` | ❌ No | Nunca se probó una respuesta real |
| `GET /reports/<id>/report_slices/` | ⚠️ Parcial | Se ve la lista de intentos, no se confirmó el formato exacto de cada item |
| `POST /reports/<id>/casts/` | ⚠️ Parcial | Se usa para rotación/Compare; el campo de daño de cada evento nunca se confirmó |
| `GET /reports/<id>/` | ⚠️ Parcial | Se parsean los `<a class="kill-link">` del HTML; el resto de la página no se usa |

### `POST /character`

**Body:**
```json
{ "server": "Onyxia", "name": "Yongii", "spec_i": "3" }
```

**Respuesta (confirmada):**
```json
{
  "class_i": 0,
  "overall_points": 8123.4,
  "overall_rank": 15,
  "bosses": {
    "Sindragosa": {
      "raid_id": "icc25h",
      "rank_raids": 3,
      "rank_players": 40,
      "dps_max": 12345.6,
      "raids": 2,
      "points": 8500.1,
      "points_dps": 1,
      "points_rank_players": 1,
      "points_rank_raids": 1,
      "spec_total_players": 100,
      "spec_total_raids": 20,
      "spec_r1_dps": 15000,
      "report_id": "abc123",
      "fastest_kill_duration": 300.5,
      "auras": null
    },
    "OtroBoss": {}
  }
}
```

Un boss sin intentos registrados viene como objeto vacío `{}`, no como `null` ni ausente.

**Cosas importantes que aprendimos a los golpes:**

- **`points`/`overall_points` es SIEMPRE daño**, sin importar la spec/rol del personaje.
  Confirmado probando con un healer real: el número que devuelve es bajo/cero, no su HPS. El
  sitio no expone healing en este endpoint. Por eso la app marca a los healers con "⚠ (dmg)"
  y los excluye de los promedios del guild — ver `CLASS_ROTATION_CONFIG` y la sección de
  healers en `web/js/app.js`.
- **`class_i` solo está 100% confirmado en `0` (Death Knight)**. El resto de la tabla en
  `wow_classes.py` / `CLASS_MAP` se completó asumiendo el orden alfabético estándar de las 10
  clases de WotLK. Si algún personaje muestra una clase que no coincide con la real, es la
  primera sospechosa.
- **No existe un endpoint que devuelva las 3 specs de una** — cada consulta pide un `spec_i`
  puntual. Por eso el dashboard, cuando no le das una spec fija, prueba 1/2/3 y se queda con
  la que tenga más puntos ("auto-detección").
- **No hay forma de pedir "toda la raid" de un reporte** — no hay un endpoint de roster
  completo por `report_id`. Esto es justamente por lo que se descartó la feature de "Replay"
  de raid completa: solo se puede armar con los personajes que ya están en TU roster
  trackeado, no con todos los que participaron en el log real.

### `POST /reports/<id>/casts/` (interno: `report_casts`)

Devuelve la timeline completa de eventos de **un jugador puntual** en **un intento puntual**.
Se usa para el análisis de rotación (botón "View analysis") y para Compare.

Estructura aproximada de la respuesta:
```json
{
  "NAME": "Yongii",
  "CLASS": "death-knight",
  "RDURATION": 300.5,
  "SPELLS": { "<spellId>": { "name": "...", "icon": "..." } },
  "DATA": { "<spellId>": [ [ms, flag, source, target, target_guid, detail], ... ] }
}
```

Cada evento es una tupla, no un objeto: `[ms, flag, source, target, target_guid, detail]`.
`flag` es cosas como `SPELL_CAST_SUCCESS`, `SPELL_AURA_APPLIED`, `SPELL_AURA_REMOVED`,
`SPELL_DAMAGE`. **El campo `detail` (posición 5) nunca se confirmó contra un log real** — para
eventos de daño, se probaron varias formas razonables de leerlo (número directo, array,
objeto con `amount`) pero no hay certeza de cuál es la correcta. Cualquier feature que dependa
de saber CUÁNTO daño hizo un cast puntual (no solo cuándo) hereda esta incertidumbre.

### `GET /reports/<id>/report_slices/` (interno: `report_segments`)

Lista los intentos (wipes/kills) de un boss dentro de un reporte. No trae nombres de
jugadores ni dificultad (10N/25H/etc) — eso solo está en el HTML de `report_page`.

### `GET /reports/<id>/` (interno: `report_page`)

Página HTML completa del reporte. Se parsean los links `<a class="kill-link">` para sacar
`mode` (dificultad), `attempt`, y los índices `s`/`f` (inicio/fin) de cada intento real —
`report_segments` no trae esa info. El resto del HTML (si lista o no a TODOS los
participantes del reporte) nunca se investigó a fondo.

---

## 2. La API interna (`proxy_server.py`)

Todo lo que expone el proxy bajo `/api/`. El frontend nunca usa otra cosa.

| Ruta | Método | Upstream real | Cachea | Para qué |
|---|---|---|---|---|
| `/api/character` | POST | `POST /character` | No (cambia con el tiempo) | Roster, ranking, perfil |
| `/api/logs_list` | POST | `POST /logs_list` | No | Sin usar en la UI todavía |
| `/api/report_segments/<report_id>` | POST | `GET /reports/<id>/report_slices/` | Sí (SQLite) | Fallback del análisis de rotación |
| `/api/report_casts/<report_id>` | POST | `POST /reports/<id>/casts/` | Sí (SQLite) | Análisis de rotación, Compare |
| `/api/report_page/<report_id>` | GET | `GET /reports/<id>/` | Sí (SQLite) | Sacar kill-links con dificultad |
| `/api/history/<server>/<name>/<spec>` | GET | *(no hay upstream — lee `data/uwu_logs.db`)* | — | Gráfico "Progreso en el tiempo" |

**Por qué algunas rutas cachean y otras no:** una vez que una pelea terminó, ese combat log
no cambia más — cachear `report_segments`/`report_casts`/`report_page` evita pegarle de
nuevo a uwu-logs.xyz cada vez que alguien abre el mismo análisis. `character`/`logs_list` sí
se re-piden siempre porque los rankings/dps se actualizan con nuevos logs. El caché vive en
`data/analysis_cache.db`.

### `/api/history/<server>/<name>/<spec>`

Es el único endpoint que **no** es un proxy — lee directo de `data/uwu_logs.db` (mismo
archivo/schema que usa el CLI, ver `src/uwu_tracker/db.py`). Cada vez que el frontend pide
`/api/character`, el proxy además guarda un snapshot ahí (como máximo 1 cada 12h por
personaje+spec, para no llenar la base de puntos casi idénticos). El gráfico de "Progreso en
el tiempo" del perfil lee esta ruta.

```
GET /api/history/Onyxia/Yongii/3
→ [{ "fetched_at": "2026-08-01T10:00:00+00:00", "overall_points": 8000.0, "overall_rank": 20 }, ...]
```

---

## Resumen de lo NO confirmado (si algo se rompe, mirar acá primero)

- Mapeo `class_i` → clase real, para todo lo que no sea `0` (Death Knight).
- Mapeo de nombres de spell por clase en `CLASS_ROTATION_CONFIG` (Rogue, Hunter, Paladin,
  Druid, Priest, Shaman) — nunca se probaron contra un log real de esas clases.
- El campo `detail` de los eventos `SPELL_DAMAGE` en `report_casts` (por eso no hay feature
  de daño/HPS calculado a partir de esto, más allá de uptimes de buffs/debuffs).
- Si `report_page` lista o no el roster completo de un reporte (por eso no hay Replay de
  raid completa).
- `POST /logs_list` — nunca se vio una respuesta real.
