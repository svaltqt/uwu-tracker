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

## Por hacer

### UT-15: Ajustes pendientes del proxy

**Tipo:** Bug  
**Prioridad:** Media

Como usuario del dashboard en Windows, quiero que el proxy aguante muchas requests simultáneas y lea los archivos con UTF-8, para que la app funcione igual en Windows que en los tests.

Criterios de aceptación:

- [ ] request_queue_size subido a 64 y probado con 20 requests en paralelo
- [ ] _maybe_save_snapshot captura OverflowError, con test
- [ ] open() con encoding="utf-8" en el código; test_raid_replay.py pasa sin PYTHONUTF8=1

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
- [x] test_requests_en_paralelo pasa

> Falta probar con el roster real.

### UT-04: Historial sin registros a medias

**Tipo:** Bug  
**Prioridad:** Alta

Como jugador del roster, quiero que mi historial de progreso no tenga snapshots incompletos, para confiar en el gráfico de progreso en el tiempo.

Criterios de aceptación:

- [x] Snapshot y bosses se guardan en una sola transacción
- [x] Campos lista/dict (auras) se guardan como JSON
- [ ] Revisado si db.py del CLI tiene el mismo problema
- [x] test_snapshot_con_auras_lista_no_deja_fila_huerfana pasa

> Falta revisar si db.py (CLI) tiene el mismo problema.

### UT-05: report_id validado

**Tipo:** Bug  
**Prioridad:** Media

Como desarrollador, quiero que el proxy rechace report_id con / o .., para que no pueda pedir rutas arbitrarias a uwu-logs.

Criterios de aceptación:

- [x] Devuelve 400 ante un report_id inválido
- [ ] Un reporte real sigue abriendo View analysis
- [x] test_report_id_no_puede_escaparse_del_path pasa

> Falta abrir View analysis con un reporte real.

### UT-06: Error claro ante peticiones mal formadas

**Tipo:** Bug  
**Prioridad:** Baja

Como usuario del dashboard, quiero recibir un error 400 si una petición llega mal formada, para no quedarme con una conexión cortada sin explicación.

Criterios de aceptación:

- [x] Content-Length inválido responde 400
- [x] test_content_length_invalido_da_400 pasa

> Falta probar con el roster real junto con UT-03.

## Backlog

### UT-07: Tests del paquete Python

**Tipo:** Tests  
**Prioridad:** Media

Como desarrollador, quiero tests para models, db, api y cli, para detectar regresiones antes de publicar una versión.

Criterios de aceptación:

- [ ] Ningún test llama a uwu-logs.xyz real
- [ ] get_character probado con una respuesta falsa
- [ ] export CSV probado con una DB temporal

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
