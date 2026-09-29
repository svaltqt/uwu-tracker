# Historias de usuario de uwu-tracker

El backlog vive en el Project [uwu-tracker](https://github.com/users/svaltqt/projects/2), con un issue por
historia (`UT-XX`). Las historias nuevas se crean como issue, no en este archivo.

Este archivo conserva solo las historias retroactivas de la funcionalidad que ya existía.

## Funcionalidad existente

Historias retroactivas (`UT-HXX`) de lo que el proyecto ya hacía antes de empezar a trabajar con historias de
usuario. No forman parte del tablero: no tienen estado y solo listan criterios ya implementados, comprobados
leyendo el código. Lo que falta verificar o probar de estas funciones vive como issues en el Project.

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
- [x] El snapshot se guarda completo o no se guarda, con test (ver UT-04, issue #6)

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
