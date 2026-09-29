# Historias de usuario de uwu-tracker

Backlog del proyecto. Cada historia tiene un ID (`UT-XX`), un estado y criterios de aceptación.
Una historia pasa a **Hecho** cuando todos sus criterios están marcados y el cambio está commiteado.

Estados: Backlog, Por hacer, En progreso, En revisión (código listo, falta prueba real o commit), Hecho.

## Resumen

| ID | Historia | Tipo | Prioridad | Estado |
| --- | --- | --- | --- | --- |
| UT-01 | Branch y reglas de git | Setup | Alta | En revisión |
| UT-02 | Verificar el diagnóstico del proxy | Tests | Alta | Hecho |
| UT-03 | Roster que carga rápido | Bug | Alta | En revisión |
| UT-04 | Historial sin registros a medias | Bug | Alta | En revisión |
| UT-05 | report_id validado | Bug | Media | En revisión |
| UT-06 | Error claro ante peticiones mal formadas | Bug | Baja | En revisión |
| UT-07 | Tests del paquete Python | Tests | Media | Backlog |
| UT-08 | Tests automáticos en GitHub Actions | Tests | Media | Backlog |
| UT-09 | Clases correctas en el roster | Datos | Media | Backlog |
| UT-10 | Filtro Damage/Healing confiable | Datos | Media | Backlog |
| UT-11 | Comando logs verificado | Datos | Baja | Backlog |
| UT-12 | Rediseño del dashboard | Diseño | Media | Backlog |
| UT-13 | Roster compartido entre dispositivos | Feature | Baja | Backlog |
| UT-14 | Snapshots automáticos | Feature | Baja | Backlog |
| UT-15 | Ajustes pendientes del proxy | Bug | Media | Por hacer |
| UT-16 | Tests de la lógica del dashboard | Tests | Media | Backlog |
| UT-17 | Tests de comportamiento para DK, Mago de Fuego y Raid Replay | Tests | Media | Backlog |
| UT-18 | Verificar las rutas de reporte contra la API real | Datos | Media | Backlog |
| UT-19 | El refresco semanal se salta logs nuevos de la misma semana | Bug | Media | Backlog |
| UT-20 | Probar los binarios en Windows, macOS y Linux | Tests | Alta | Backlog |
| UT-21 | El CLI guarda auras como JSON y ordena bien los logs | Bug | Media | Backlog |

## Por hacer

### UT-15: Ajustes pendientes del proxy

**Tipo:** Bug  
**Prioridad:** Media

Como usuario del dashboard en Windows, quiero que el proxy aguante muchas requests simultáneas y lea los archivos con UTF-8, para que la app funcione igual en Windows que en los tests.

Criterios de aceptación:

- [ ] request_queue_size subido a 64 y probado con 20 requests en paralelo
- [ ] _maybe_save_snapshot captura OverflowError, con test
- [ ] open() con encoding="utf-8" en el código; test_raid_replay.py pasa sin PYTHONUTF8=1

> request_queue_size = 64 solo se cambió en el upstream falso de tests/test_proxy_server.py. Falta cambiarlo en proxy_server.py (no se arregla en el branch docs/historias-existentes).

## En revisión

### UT-01: Branch y reglas de git

**Tipo:** Setup  
**Prioridad:** Alta

Como desarrollador, quiero trabajar en el branch fix/proxy-tests con una regla en CLAUDE.md que diga que los comandos git los hago yo, para controlar el historial y revisar cada cambio antes de commitear.

Criterios de aceptación:

- [x] Branch fix/proxy-tests creado desde main actualizado
- [x] CLAUDE.md con la sección Git (solo lectura para Claude Code)
- [x] Sesión de Claude Code reiniciada para que lea la regla

> CLAUDE.md creado, pendiente de commit.

### UT-03: Roster que carga rápido

**Tipo:** Bug  
**Prioridad:** Alta

Como líder de raid, quiero que el roster cargue rápido aunque tenga muchos personajes, para no esperar cada vez que reviso el ranking.

Criterios de aceptación:

- [x] El proxy usa ThreadingHTTPServer
- [x] Acceso a SQLite protegido con un lock
- [x] test_concurrent_character_requests_are_not_serialized pasa

> Falta probar con el roster real.

### UT-04: Historial sin registros a medias

**Tipo:** Bug  
**Prioridad:** Alta

Como jugador del roster, quiero que mi historial de progreso no tenga snapshots incompletos, para confiar en el gráfico de progreso en el tiempo.

Criterios de aceptación:

- [x] Snapshot y bosses se guardan en una sola transacción
- [x] Campos lista/dict (auras) se guardan como JSON
- [x] Revisado si db.py del CLI tiene el mismo problema
- [x] test_failed_boss_insert_leaves_no_orphan_snapshot pasa
- [x] test_list_and_dict_boss_fields_are_stored_as_json pasa

> db.py (CLI) no tiene el problema: Database.save_snapshot hace un solo commit al final y `with Database(...)` cierra la conexión sin commit si algo falla, así que SQLite hace rollback y no queda un snapshot huérfano. Aun así, el CLI no serializa listas/dicts a JSON (UT-07 debe cubrirlo).

### UT-05: report_id validado

**Tipo:** Bug  
**Prioridad:** Media

Como desarrollador, quiero que el proxy rechace report_id con / o .., para que no pueda pedir rutas arbitrarias a uwu-logs.

Criterios de aceptación:

- [x] Devuelve 400 ante un report_id inválido
- [ ] Un reporte real sigue abriendo View analysis
- [x] test_report_id_cannot_change_upstream_route pasa

> Falta abrir View analysis con un reporte real.

### UT-06: Error claro ante peticiones mal formadas

**Tipo:** Bug  
**Prioridad:** Baja

Como usuario del dashboard, quiero recibir un error 400 si una petición llega mal formada, para no quedarme con una conexión cortada sin explicación.

Criterios de aceptación:

- [x] Content-Length inválido responde 400
- [x] test_invalid_content_length_returns_400 pasa

> Falta probar con el roster real junto con UT-03.

## Backlog

### UT-07: Tests del paquete Python

**Tipo:** Tests  
**Prioridad:** Media

Como desarrollador, quiero tests para models, db, api, scoring y cli, para detectar regresiones antes de publicar una versión.

Criterios de aceptación:

- [ ] Ningún test llama a uwu-logs.xyz real
- [ ] get_character probado con una respuesta falsa
- [ ] export CSV probado con una DB temporal
- [ ] get_character_auto probado: empate de puntos, una spec que falla y todas fallan
- [ ] save_snapshot y get_boss_kills probados con una DB temporal, incluido que devuelve el último dato por boss
- [ ] score_tier y format_score probados en los límites de cada tramo
- [ ] plot_evolution sin snapshots lanza ValueError y con snapshots genera el PNG

### UT-08: Tests automáticos en GitHub Actions

**Tipo:** Tests  
**Prioridad:** Media

Como desarrollador, quiero que los tests corran en cada push y pull request, para que ningún release salga con tests rotos.

Criterios de aceptación:

- [ ] Workflow de tests en push y PR
- [ ] build.yml solo compila si los tests pasan

### UT-09: Clases correctas en el roster

**Tipo:** Datos  
**Prioridad:** Media

Como jugador del roster, quiero ver mi clase y su color correctos, para que el roster no muestre información falsa.

Criterios de aceptación:

- [ ] class_i 1 a 9 verificados con personajes reales conocidos
- [ ] wow_classes.py corregido si hace falta
- [ ] Test que fije el mapeo verificado

### UT-10: Filtro Damage/Healing confiable

**Tipo:** Datos  
**Prioridad:** Media

Como líder de raid, quiero que cada jugador aparezca en el rol correcto, para armar la composición sin revisar a mano.

Criterios de aceptación:

- [ ] SPEC_MAP de app.js verificado con personajes reales
- [ ] Mismo mapeo en app.js y wow_classes.py

### UT-11: Comando logs verificado

**Tipo:** Datos  
**Prioridad:** Baja

Como jugador del roster, quiero listar los logs donde participé con uwu-tracker logs, para encontrar rápido mis reportes.

Criterios de aceptación:

- [ ] /logs_list probado contra la API real
- [ ] docs/API.md actualizado con el resultado
- [ ] Mensaje claro si el endpoint no responde

### UT-12: Rediseño del dashboard

**Tipo:** Diseño  
**Prioridad:** Media

Como miembro de la guild, quiero un dashboard con identidad visual propia, para que sea agradable de usar y fácil de leer.

Criterios de aceptación:

- [ ] Plugin frontend-design instalado en Claude Code
- [ ] Dirección visual definida antes de pedir el cambio
- [ ] Toda la funcionalidad actual se mantiene
- [ ] Se ve bien en el celular

### UT-13: Roster compartido entre dispositivos

**Tipo:** Feature  
**Prioridad:** Baja

Como líder de raid, quiero que el roster esté disponible en cualquier dispositivo, para que otros oficiales vean la misma lista.

Criterios de aceptación:

- [ ] Roster guardado fuera de localStorage
- [ ] Importar el roster actual sin perder datos

### UT-14: Snapshots automáticos

**Tipo:** Feature  
**Prioridad:** Baja

Como líder de raid, quiero que el historial se actualice solo, para tener progreso sin acordarme de refrescar.

Criterios de aceptación:

- [ ] Job programado que corra fetch para todo el roster
- [ ] Respeta el intervalo mínimo de 12 horas

### UT-16: Tests de la lógica del dashboard

**Tipo:** Tests  
**Prioridad:** Media

Como desarrollador, quiero probar la lógica del dashboard sin abrir el navegador, para cambiar `app.js` sin romper el roster.

Criterios de aceptación:

- [ ] Decidido y documentado cómo ejecutar JS en tests (por ejemplo `node --test`), sin depender de la red
- [ ] La lógica pura de `app.js` queda accesible para tests, extrayéndola a un módulo si hace falta
- [ ] Roster: agregar, rechazar duplicados sin distinguir mayúsculas y bulk-add con conteo de inválidos
- [ ] Filtros por Core, rol, clase y spec en `getFilteredRows`
- [ ] `startOfCurrentWeeklyCycle` con fechas simuladas, incluido el cambio de semana el martes a las 22:00
- [ ] `getBossLeaderboard` con top 10, jefe individual y métrica Ranking o Damage
- [ ] Detección de spec en la web: se queda con la de más puntos, tolera specs que fallan y falla si todas fallan

### UT-17: Tests de comportamiento para DK, Mago de Fuego y Raid Replay

**Tipo:** Tests  
**Prioridad:** Media

Como desarrollador, quiero tests que ejecuten los análisis con datos de ejemplo, para que un renombre de código no rompa tests ni deje pasar un análisis roto.

Criterios de aceptación:

- [ ] Fixtures de reportes de ejemplo guardadas en el repo (ver UT-18)
- [ ] `computeFrostAnalysis`, `computeUnholyAnalysis` y `computeFireMageAnalysis` probados con esos fixtures, verificando los valores calculados
- [ ] Raid Replay: normalización de series, buckets de 1 s y ventanas de Bloodlust y Heroism
- [ ] Raid Replay: límite de 3 requests en paralelo comprobado por comportamiento
- [ ] Los tests de `test_fire_mage.py`, `test_raid_replay.py` y `test_spellid_matching.py` que solo buscan strings se reemplazan o se eliminan cuando estén cubiertos

> Depende de: UT-16 (forma de ejecutar JS) y UT-18 (reportes reales como fixtures).

### UT-18: Verificar las rutas de reporte contra la API real

**Tipo:** Datos  
**Prioridad:** Media

Como jugador del roster, quiero que View analysis y Raid Replay funcionen con reportes reales, para confiar en lo que muestran.

Criterios de aceptación:

- [ ] `report_segments`, `report_casts`, `report_page`, `report_player_page` y `report_dps` probadas con un reporte real
- [ ] View analysis abre sin error con un reporte real (cubre el criterio abierto de UT-05)
- [ ] Raid Replay reproduce un kill real de 20 jugadores
- [ ] `docs/API.md` actualizado con los resultados y sin la marca "no probada"
- [ ] Al menos un reporte real guardado como fixture para UT-17

### UT-19: El refresco semanal se salta logs nuevos de la misma semana

**Tipo:** Bug  
**Prioridad:** Media

Como líder de raid que raidea dos días distintos por semana, quiero que "Refresh all" traiga el log más nuevo aunque ya haya uno de esta semana, para no quedarme con datos viejos hasta el reset siguiente.

Criterios de aceptación:

- [ ] Se reproduce el caso con un log del martes y otro del sábado de la misma semana
- [ ] Definido cuándo un personaje está al día, y documentado
- [ ] Hay una forma de forzar el refresco de todo el roster
- [ ] Test con fechas simuladas
- [ ] El comentario de `app.js` sobre la limitación se actualiza

> Depende de: UT-16 (tests de la lógica del dashboard).
>
> El comentario de `app.js` no coincide con el código. Habla de "ya se pidió /character después del reset", pero `hasLogFromCurrentCycle` salta a quien tiene algún log fechado dentro del ciclo. La limitación real es esa.

### UT-20: Probar los binarios en Windows, macOS y Linux

**Tipo:** Tests  
**Prioridad:** Alta

Como miembro de la guild, quiero que el ejecutable funcione en mi sistema, para no depender de que alguien lo pruebe por mí.

Criterios de aceptación:

- [ ] Binarios de un run manual del workflow probados en los 3 sistemas
- [ ] Cada uno levanta el servidor, abre el navegador y sirve el dashboard
- [ ] Reemplazar el binario por una versión nueva conserva el roster y el historial
- [ ] La migración de `data/uwu_logs.db` probada una vez
- [ ] Las advertencias de SmartScreen y Gatekeeper coinciden con el README
- [ ] Test unitario de `_user_data_dir` por sistema operativo

### UT-21: El CLI guarda auras como JSON y ordena bien los logs

**Tipo:** Bug  
**Prioridad:** Media

Como jugador del roster, quiero que el CLI y el dashboard escriban igual en la base compartida y que `logs` muestre primero lo más reciente, para no perder datos ni ver reportes sin fecha arriba.

Criterios de aceptación:

- [ ] `Database.save_snapshot` guarda listas y dicts (auras) como JSON, igual que el proxy, porque ambos escriben en la misma base
- [ ] Test de `save_snapshot` con un boss cuyo campo `auras` es una lista
- [ ] `cmd_logs` deja los reportes sin fecha al final (hoy quedan primeros por `reverse=True`)
- [ ] Test del orden de `cmd_logs` con reportes con y sin fecha

## Hecho

### UT-02: Verificar el diagnóstico del proxy

**Tipo:** Tests  
**Prioridad:** Alta

Como desarrollador, quiero que Claude Code verifique los 4 bugs reportados contra el código real, para no aplicar correcciones basadas en suposiciones.

Criterios de aceptación:

- [x] Diagnóstico por bug: real o no, y gravedad
- [x] Línea base: tests/test_models.py corrido
- [x] tests/test_proxy_server.py corrido antes de tocar código
- [x] Lista de otros errores en api.py, db.py, cli.py y app.js

## Funcionalidad existente

Historias retroactivas (`UT-HXX`) de lo que el proyecto ya hacía antes de empezar a trabajar con historias de
usuario. No forman parte del tablero: no tienen estado y solo listan criterios ya implementados, comprobados
leyendo el código. Lo que falta verificar o probar de estas funciones vive como historias del backlog.

| ID | Historia | Tipo | Prioridad |
| --- | --- | --- | --- |
| UT-H01 | Guardar el estado de un personaje desde la terminal | Feature | Alta |
| UT-H02 | Detección automática de spec | Feature | Alta |
| UT-H03 | Ver bosses y gráfico de evolución en la terminal | Feature | Media |
| UT-H04 | Exportar datos a CSV | Feature | Media |
| UT-H05 | Listar los logs de un personaje | Feature | Baja |
| UT-H06 | Armar y mantener el roster | Feature | Alta |
| UT-H07 | Refrescar el roster con progreso | Feature | Alta |
| UT-H08 | Ranking del roster con filtros | Feature | Alta |
| UT-H09 | Perfil del jugador y progreso en el tiempo | Feature | Media |
| UT-H10 | Historial automático al refrescar | Feature | Media |
| UT-H11 | Ranking por boss | Feature | Media |
| UT-H12 | Análisis de un log (Summary y Timeline) | Feature | Media |
| UT-H13 | Análisis de Death Knight y comparación | Feature | Media |
| UT-H14 | Análisis de Mago de Fuego | Feature | Baja |
| UT-H15 | Raid Replay | Feature | Media |
| UT-H16 | Ejecutable standalone | Setup | Alta |

### UT-H01: Guardar el estado de un personaje desde la terminal

**Tipo:** Feature  
**Prioridad:** Alta

Como jugador del roster, quiero guardar un snapshot de mi personaje con `uwu-tracker fetch`, para ir armando mi historial de puntaje y rank.

Criterios de aceptación:

- [x] Hace POST a `/character` con server, name y spec_i
- [x] Guarda el snapshot y sus bosses en SQLite
- [x] Muestra clase, spec, puntaje con su tramo de color y rank
- [x] Ante error de la API imprime el mensaje y sale con código 1

### UT-H02: Detección automática de spec

**Tipo:** Feature  
**Prioridad:** Alta

Como líder de raid, quiero agregar un personaje sin saber su spec, para que la app elija la que realmente juega.

Criterios de aceptación:

- [x] Prueba las specs 1, 2 y 3 y se queda con la de más `overall_points`
- [x] Ignora las specs que fallan y sigue con las demás
- [x] Si todas fallan, reporta el último error
- [x] El dashboard guarda la spec detectada y la marca con la etiqueta "auto"

### UT-H03: Ver bosses y gráfico de evolución en la terminal

**Tipo:** Feature  
**Prioridad:** Media

Como jugador del roster, quiero ver mi tabla de bosses y un gráfico de mi evolución, para saber cómo voy sin abrir el navegador.

Criterios de aceptación:

- [x] `bosses` muestra rank, puntos, tramo, DPS máximo y duración por boss, con el último dato de cada uno
- [x] `bosses` avisa si no hay datos guardados
- [x] `plot` genera un PNG de puntaje y rank en el tiempo
- [x] `plot` avisa si no hay snapshots

### UT-H04: Exportar datos a CSV

**Tipo:** Feature  
**Prioridad:** Media

Como líder de raid, quiero exportar el roster a CSV, para revisarlo en Excel o Sheets.

Criterios de aceptación:

- [x] `export` exporta un personaje, o todo el roster con `--all`, a una ruta configurable con `--out`
- [x] Cada fila trae personaje, clase, puntaje, tramo, boss, rank, DPS y report_id
- [x] Exige `--server --name --spec` o `--all`
- [x] El dashboard tiene un botón "Download CSV" para lo que se ve en pantalla

### UT-H05: Listar los logs de un personaje

**Tipo:** Feature  
**Prioridad:** Baja

Como jugador del roster, quiero listar los reportes donde participé, para encontrarlos rápido.

Criterios de aceptación:

- [x] `logs` acepta filtros `--year` y `--month`
- [x] Muestra fecha, autor y URL de cada reporte
- [x] Parsea el `report_id` y no falla ante formatos inesperados (con test)

### UT-H06: Armar y mantener el roster

**Tipo:** Feature  
**Prioridad:** Alta

Como líder de raid, quiero agregar y quitar personajes y agruparlos por Core, para mantener mi lista sin tocar la terminal.

Criterios de aceptación:

- [x] Agregar un personaje con servidor, nombre, spec (o Auto) y Core
- [x] Agregar varios de una vez pegando líneas `Nombre [spec]`, con conteo de duplicados e inválidos
- [x] No permite duplicar un nombre, sin distinguir mayúsculas
- [x] Quitar un personaje
- [x] El roster y la caché se guardan en `localStorage` y persisten entre sesiones

### UT-H07: Refrescar el roster con progreso

**Tipo:** Feature  
**Prioridad:** Alta

Como líder de raid, quiero actualizar todo el roster con un botón, para tener el ranking al día después de raidear.

Criterios de aceptación:

- [x] "Refresh all" muestra un modal con avance y conteo de validados, fallidos y salteados
- [x] Saltea a quien ya tiene un log del ciclo semanal actual (reset el martes a las 22:00)
- [x] Un fallo en un personaje no frena a los demás
- [x] Deshabilita el botón mientras corre

### UT-H08: Ranking del roster con filtros

**Tipo:** Feature  
**Prioridad:** Alta

Como líder de raid, quiero ver el roster ordenado por puntaje y filtrarlo por Core, rol, clase y spec, para comparar solo lo que me interesa.

Criterios de aceptación:

- [x] Ordena por `overall_points` con color por tramo
- [x] Filtros por Core, rol (Damage/Healing), clase y spec, con botón para limpiarlos
- [x] Cada fila expande el detalle por boss
- [x] Muestra totales de miembros, promedio y mejor puntaje
- [x] Los healers se marcan y se excluyen del promedio, porque uwu-logs solo registra daño

### UT-H09: Perfil del jugador y progreso en el tiempo

**Tipo:** Feature  
**Prioridad:** Media

Como jugador del roster, quiero abrir mi perfil y ver mi evolución, para saber si estoy mejorando.

Criterios de aceptación:

- [x] La vista de perfil muestra clase, spec y datos por boss
- [x] Dibuja un gráfico SVG con el historial de puntaje y rank desde `/api/history/...`
- [x] Botón para volver al roster

### UT-H10: Historial automático al refrescar

**Tipo:** Feature  
**Prioridad:** Media

Como jugador del roster, quiero que cada refresco alimente mi historial sin acciones extra, para tener el gráfico sin usar el CLI.

Criterios de aceptación:

- [x] El proxy guarda un snapshot en cada respuesta 200 de `/character`
- [x] No guarda más de uno cada 12 horas por personaje y spec
- [x] Usa el mismo schema y, por defecto, el mismo archivo que el CLI
- [x] El snapshot se guarda completo o no se guarda, con test (ver UT-04)

### UT-H11: Ranking por boss

**Tipo:** Feature  
**Prioridad:** Media

Como líder de raid, quiero ver quién rinde mejor contra cada jefe, para decidir la composición de cada pelea.

Criterios de aceptación:

- [x] Vista por raid completa (top 10 por jefe) o por jefe individual (ranking completo)
- [x] Filtros por fase, raid, clase y spec, además de los del roster
- [x] Toggle Ranking (percentil `points`) / Damage (`dps_max` crudo)
- [x] La lista de jefes sale de los datos ya cargados

### UT-H12: Análisis de un log (Summary y Timeline)

**Tipo:** Feature  
**Prioridad:** Media

Como jugador del roster, quiero abrir "View analysis" desde un boss, para ver qué hice en mi mejor intento.

Criterios de aceptación:

- [x] Identifica el intento del kill a partir del report_id y la página HTML del reporte
- [x] Pestañas Summary y Timeline
- [x] Descarga el Timeline como CSV
- [x] Las respuestas de reporte (segments, casts, report_page) se cachean en SQLite

### UT-H13: Análisis de Death Knight y comparación

**Tipo:** Feature  
**Prioridad:** Media

Como Death Knight, quiero ver mi rotación, pociones y mascotas, y compararme con otro jugador, para mejorar mi rendimiento.

Criterios de aceptación:

- [x] Analizadores para Frost DK y Unholy DK
- [x] Unholy suma el daño de mascotas (gárgola, ghoul, ejército de muertos)
- [x] Emparejamiento por spell ID, con test
- [x] Compara el Timeline con otro jugador del roster

### UT-H14: Análisis de Mago de Fuego

**Tipo:** Feature  
**Prioridad:** Baja

Como Mago de Fuego, quiero ver mi uso de Combustión, Hot Streak, pociones y consumibles, para ajustar mi rotación.

Criterios de aceptación:

- [x] Resumen adaptado al jefe (Northrend Beasts usa spell IDs)
- [x] Reporta ventanas de Combustión, tiempo de reacción a Hot Streak y pociones
- [x] Reutiliza el desglose de daño para Ignite

### UT-H15: Raid Replay

**Tipo:** Feature  
**Prioridad:** Media

Como líder de raid, quiero reproducir el DPS de los 20 jugadores segundo a segundo, para revisar cómo se desarrolló un kill.

Criterios de aceptación:

- [x] Tabla del top 10 con PLAY, PAUSE y RESET
- [x] Serie DPS de un segundo por jugador, con 3 requests en paralelo como máximo
- [x] Resalta las ventanas de Bloodlust y Heroism
- [x] Desglose de daño por jugador
- [x] No cachea respuestas de DPS vacías
- [x] La pestaña va después de Timeline

### UT-H16: Ejecutable standalone

**Tipo:** Setup  
**Prioridad:** Alta

Como miembro de la guild sin Python, quiero abrir un ejecutable con doble click, para usar el dashboard sin instalar nada.

Criterios de aceptación:

- [x] `uwu-tracker.spec` empaqueta `proxy_server.py` y `web/` con PyInstaller
- [x] Levanta el servidor y abre el navegador solo
- [x] La DB y la caché van a la carpeta de datos del SO, así actualizar no borra el roster
- [x] Migra una vez `data/uwu_logs.db` si existía, sin pisar datos
- [x] El workflow compila para Windows, macOS y Linux al pushear un tag `v*`, o a mano
- [x] Avisa si el puerto está ocupado
