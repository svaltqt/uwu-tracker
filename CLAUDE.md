# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

La documentación del proyecto (README.md, docs/API.md) está en español; mantené el texto visible para el usuario en el mismo idioma.

## Qué es

Tracker de roster y rankings para [uwu-logs.xyz](https://uwu-logs.xyz) (WotLK 3.3.5, servidor Onyxia). Dos front-ends independientes comparten la misma API externa:

1. **CLI de Python** (`src/uwu_tracker/`) — `fetch`/`bosses`/`plot`/`logs`/`export`; guarda snapshots en SQLite (`data/*.db`, ignorado por git) y grafica con matplotlib.
2. **Dashboard web** (`web/`) — HTML/CSS/JS puro y standalone (sin build ni npm), servido por `proxy_server.py`. Acá se concentra casi todo el desarrollo (`web/js/app.js` tiene ~3300 líneas).

## Comandos

```bash
pip install -e .                     # instala el CLI `uwu-tracker` (Python >=3.10; requests, matplotlib)
python3 proxy_server.py              # dashboard + proxy en http://localhost:8000 (solo stdlib)
pytest tests/                        # todos los tests
pytest tests/test_raid_replay.py::test_replay_tab_is_after_timeline   # un solo test
pyinstaller uwu-tracker.spec         # binario standalone (el CI lo hace al pushear tags `v*`)
```

No hay linter configurado. Servir `web/` con `python -m http.server` NO funciona: el dashboard necesita las rutas `/api/*` del proxy.

En Windows, `tests/test_raid_replay.py` lee `app.js` sin `encoding` y falla al importar; correr con `PYTHONUTF8=1` hasta que se arregle.

## Git

- No ejecutes comandos git que modifiquen el repo: nada de commit, checkout, switch,
  branch, merge, rebase, reset, stash, push, pull ni tag. Esos los hago yo.
- Sí puedes usar comandos de solo lectura: git status, git diff, git log, git show,
  git branch (sin argumentos).
- Cuando termines un cambio, dime qué archivos tocaste y sugiéreme un mensaje de
  commit, pero no lo hagas tú.

## Arquitectura

- **El proxy es obligatorio** (`proxy_server.py`): uwu-logs.xyz no manda headers CORS, así que el navegador solo habla con `/api/...` en localhost y el proxy reenvía a uwu-logs.xyz del lado del servidor (tabla de rutas cerca de `/api/character`, `/api/logs_list`, más los endpoints de reportes como `report_dps`). También cachea las respuestas del upstream y guarda snapshots del historial de personajes en SQLite. La documentación completa de rutas y upstream está en `docs/API.md`: leerla antes de tocar endpoints.
- **Concurrencia del proxy**: usa `ThreadingHTTPServer`. `CACHE_DB` y `HISTORY_DB` son conexiones únicas compartidas (`check_same_thread=False`), así que **todo acceso a ellas debe ir dentro de `with DB_LOCK:`**. Los guardados de historial son transaccionales (`with HISTORY_DB:`): un snapshot se guarda completo con sus bosses o no se guarda.
- **Rutas con `report_id`**: cualquier ruta nueva que meta un id en la URL del upstream debe hacer `unquote` + `quote(id, safe="-")` (como `report_dps`); nunca interpolarlo crudo.
- **Rutas "congelado" vs. script**: `IS_FROZEN` / `_user_data_dir()` en `proxy_server.py`. Empaquetado con PyInstaller, `web/` vive en `sys._MEIPASS` (solo lectura) y la DB/caché van a la carpeta de datos del usuario del SO (así una actualización nunca borra el roster). Todo archivo persistente nuevo debe usar esos helpers, no rutas relativas al script. Las variables de entorno `UWU_LOGS_BASE`, `ANALYSIS_CACHE_DB`, `UWU_TRACKER_DB` y `PORT` redirigen upstream, DBs y puerto (los tests las usan).
- **Dashboard** (`web/js/`): `app.js` tiene la UI (roster, ranking por boss, pestañas de análisis DK/Mago, Raid Replay); `analysis/*.js` son analizadores de combate por spec (frost-dk, unholy-dk, fire-mage); `data/*.js` son tablas estáticas (clases/specs, raids/bosses, config de rotaciones); `utils/format.js` son helpers. El roster y la caché de resultados viven en `localStorage` del navegador. `app.js` importa los demás archivos con `import` de ES modules (ver su encabezado).
- **Autodetección de spec**: la API exige un `spec_i` explícito en cada llamada a `/character`, así que "Auto" prueba las specs 1/2/3 (en secuencia) y se queda con la de mayor `overall_points`.
- **Puntajes**: la API devuelve puntos en escala 0–10000 (percentil ×100); `scoring.py` los convierte y asigna tramos de color. Solo `class_i=0` (Death Knight) está verificado; el resto del mapeo en `wow_classes.py` y `web/js/data/classes.js` es inferido (orden alfabético) y debe mantenerse sincronizado entre Python y JS.
- **Ranking vs. Damage**: "Ranking" es el percentil `points` de la API; "Damage" es el `dps_max` crudo. No confundirlos.
- `/logs_list` (comando `logs` del CLI) es el único endpoint todavía sin verificar contra la API real.

## Historias de usuario

- El backlog del proyecto está en docs/HISTORIAS_DE_USUARIO.md. Léelo antes de
  empezar una tarea y dime a qué historia (UT-XX) corresponde. Si no corresponde
  a ninguna, avísame antes de empezar.
- Cuando cumplas un criterio de aceptación, márcalo con [x] en el archivo.
- Puedes mover una historia a "En revisión" cuando el código y sus tests estén
  listos. Moverla a "Hecho" lo decido yo, después de probar y commitear.
- Si durante el trabajo descubres algo nuevo que hacer, propónmelo como historia
  nueva con el formato del archivo, pero no la agregues sin mi confirmación.
- Incluye el ID de la historia en el mensaje de commit que me sugieras,
  por ejemplo: fix(proxy): escape report_id (UT-05).

  ## Proceso

- Sigue docs/PROCESO.md: una historia por branch, commits con el formato
  tipo(ámbito): descripción (UT-XX), y la definición de hecho de ese archivo.
- Antes de empezar, verifica que el branch actual corresponde a la historia
  que te pido. Si no, avísame en vez de trabajar ahí.

## Tests

- `tests/test_raid_replay.py` y `tests/test_fire_mage.py` **no son tests automatizados de comportamiento**: no ejecutan JS ni usan la red. Leen `web/js/app.js`, `proxy_server.py`, `style.css`, etc. y verifican que existan ciertos strings (`"slice(0, 10)"`, `'▶ PLAY'`, `mapWithConcurrency(candidates, 3`), para validar que los datos/elementos que deben verse en el dashboard sigan conectados. Que pasen no prueba que los datos se rendericen bien: eso se verifica en el navegador con `proxy_server.py`. Renombrar esos fragmentos rompe los tests aunque el comportamiento no cambie; actualizar los tests junto con el código.
- `tests/test_proxy_server.py` sí ejecuta el proxy real (arranca `main()`) contra un upstream falso en localhost, con DBs temporales; no llama a uwu-logs.xyz. En Windows el loopback pierde alguna conexión simultánea de vez en cuando, por eso el test de concurrencia mide requests en vuelo en el upstream y no tiempos de reloj.
- `test_models.py` y `test_spellid_matching.py` son tests unitarios normales y no necesitan red.
