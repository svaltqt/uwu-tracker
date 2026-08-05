# uwu-tracker

Tracker de roster y rankings de guild para [uwu-logs.xyz](https://uwu-logs.xyz), pensado para
seguir el progreso del Core 1 en Onyxia (WotLK 3.3.5).

✅ **`fetch` está confirmado funcionando en vivo** (probado por el usuario, julio 2026):
`POST /character` con body `{"server", "name", "spec_i"}` devuelve JSON real con
`class_i`, `overall_points`, `overall_rank` y `bosses` (puntos, dps, rank, report_id, etc.
por boss). El único endpoint que sigue sin verificar es `/logs_list` (comando `logs`).

⚠️ **Nota sobre `class_i`**: solo `class_i=0` está confirmado (Death Knight). El resto del
mapeo en `wow_classes.py` se infiere asumiendo orden alfabético de las 10 clases de WotLK —
si algún personaje muestra una clase que no coincide, avisar para corregir la tabla.

📖 **Documentación completa de la API** (externa de uwu-logs.xyz e interna del proxy):
ver [`docs/API.md`](docs/API.md).

## Estructura

```
uwu-tracker/
├── pyproject.toml          # packaging del CLI (pip install -e .)
├── .gitignore
├── src/uwu_tracker/
│   ├── __init__.py
│   ├── api.py                # cliente HTTP (get_character confirmado, list_logs sin verificar)
│   ├── wow_classes.py         # mapeo class_i -> nombre/color de clase
│   ├── models.py              # dataclasses: RosterMember, CharacterSnapshot, BossStats, LogEntry
│   ├── db.py                  # persistencia en SQLite (histórico de snapshots)
│   ├── plotting.py            # gráficos de evolución (matplotlib)
│   └── cli.py                  # comandos de línea de comandos
├── tests/
│   └── test_models.py       # tests unitarios (no requieren red)
├── data/                     # se crea sola: acá van la DB y los PNG generados
├── docs/
│   └── API.md                # documentación de la API externa (uwu-logs.xyz) e interna (proxy)
└── web/                       # dashboard standalone (HTML/CSS/JS, sin dependencias)
    ├── index.html
    ├── css/style.css
    └── js/app.js
```

## Instalación (CLI)

```bash
cd uwu-tracker
python3 -m venv .venv && source .venv/bin/activate
pip install -e .
```

Esto instala el comando `uwu-tracker` (definido en `pyproject.toml` → `[project.scripts]`).
Alternativa sin instalar el paquete: `python -m uwu_tracker.cli ...` desde `src/`.

## Uso del CLI

```bash
# Guardar un snapshot del personaje (correr periódicamente para trackear evolución)
uwu-tracker fetch --server Onyxia --name Yongii --spec 3

# Sin --spec, se prueban las specs 1/2/3 y se guarda la que tenga más puntos (auto-detección)
uwu-tracker fetch --server Onyxia --name Yongii

# Ver la tabla de bosses (rank, points, dps, duración del mejor kill)
uwu-tracker bosses --server Onyxia --name Yongii --spec 3

# Graficar la evolución de puntaje/rank en el tiempo (necesita 2+ snapshots)
uwu-tracker plot --server Onyxia --name Yongii --spec 3

# Listar los logs subidos donde participó el personaje (endpoint sin verificar, ver nota arriba)
uwu-tracker logs --server Onyxia --name Yongii
uwu-tracker logs --server Onyxia --name Yongii --year 2026 --month 7

# Exportar los datos guardados a CSV (para abrir en Excel/Sheets)
uwu-tracker export --server Onyxia --name Yongii --spec 3          # un personaje
uwu-tracker export --all                                             # todo el roster guardado en la DB
uwu-tracker export --all --out mi_roster.csv                          # ruta de salida custom
```

El dashboard web también tiene un botón **"Descargar CSV"** que exporta lo que tenga cargado
en pantalla en ese momento (sin necesidad de tocar la terminal).

## Tests

```bash
cd uwu-tracker
python3 tests/test_models.py
# o, si tenés pytest instalado:
pytest tests/
```

## Dashboard web (`web/`)

Interfaz para gestionar el roster completo del Core 1: agregar/quitar personajes, ver el
ranking interno de la guild ordenado por puntaje, y desglose por boss.

**Detección automática de spec**: la API de uwu-logs.xyz no tiene un endpoint que devuelva
las 3 specs de un personaje de una — cada consulta a `/character` exige un `spec_i`
puntual. Por eso, al agregar un personaje con la spec en blanco (opción **"Auto (detectar
mejor)"**, la que viene por defecto), el dashboard prueba las specs 1, 2 y 3 y se queda con
la que tenga más `overall_points` para el ranking, asumiendo que esa es la spec con la que
el jugador realmente juega/loguea. Esas filas muestran una etiqueta **"auto"** junto al
nombre de la spec. Si preferís fijar la spec a mano, seguís pudiendo elegir Spec 1/2/3 en el
selector (o poner el número en el bulk-add).

**Filtro Damage / Healing**: debajo del filtro de Core hay pills para filtrar el roster por
rol (`Todos los roles` / `Damage` / `Healing`). El rol se deriva de la clase + spec del
personaje (ver `SPEC_MAP` en `web/js/app.js` y `wow_classes.py` — todas las specs de
sanación pura, ej. Restoration/Holy/Discipline, se marcan `Healing`; el resto —incluidas las
specs de tank— quedan como `Damage`, igual que las cuenta un meter de dps). Este mapeo de
árboles de talentos (spec 1/2/3 → nombre) asume el orden estándar del cliente de WotLK y
todavía no está verificado contra la API salvo `class_i=0` (Death Knight); si algún
personaje muestra un rol que no cuadra, avisar para corregir la tabla.

Es **standalone**: no depende del paquete Python ni de ninguna build tool. Guarda el roster
y la cache de resultados en `localStorage` del navegador (persiste entre sesiones, pero es
local a ese navegador/máquina — no se comparte entre dispositivos).

### Vista "Ranking por boss"

Arriba del roster hay dos pestañas: **Roster** (la vista de siempre) y **Ranking por boss**.
Esta segunda pestaña arma un top del roster (ya filtrado por Core/Rol/Clase/Spec) contra
cada jefe de la raid:

- **Raid completa**: un bloque por jefe, cada uno con su top 10.
- **Jefe individual**: elegís un boss puntual en el selector "Ver" y te muestra el ranking
  completo del roster filtrado contra ese jefe (sin tope de 10).

La lista de jefes se arma sola a partir de los personajes que ya tengan datos cargados (la
API siempre devuelve el mismo set de bosses de la raid actual, con `{}` para los que el
personaje no intentó).

**Importante — dos métricas distintas, no confundir**:

- **Ranking** = el `points` que devuelve la API (percentil 0-100, "% de parse"). Es la misma
  métrica que ya se usaba en toda la app (barra de puntaje del roster, colores por tier,
  etc.).
- **Damage** = `dps_max`, el daño/curación crudo del mejor intento contra ese boss, **sin
  convertir a percentil**. Un personaje puede tener menos % de parse pero más DPS crudo que
  otro (por ejemplo si compite en una spec con menos gente logueada, o si el otro jugador
  murió temprano en un intento con menos duración).

El toggle Ranking/Damage en la vista de boss cambia con qué métrica se ordena y se muestra
el top — no afecta el resto de la app (el roster general sigue ordenado por `overall_points`
como siempre).

Para abrirlo:

```bash
cd uwu-tracker
python3 proxy_server.py
# luego abrir http://localhost:8000 en el navegador
```

Este script sirve el dashboard **y** actúa de proxy hacia `uwu-logs.xyz` en el mismo proceso
— soluciona el problema de CORS de raíz (ver siguiente sección). No hace falta instalar nada
extra, usa solo la librería estándar de Python.

### Sobre CORS

El dashboard necesita traer datos de `uwu-logs.xyz`, pero el navegador bloquea peticiones
directas de JavaScript a un dominio externo si ese sitio no manda el header
`Access-Control-Allow-Origin` (y `uwu-logs.xyz` no lo manda). Por eso `proxy_server.py`
existe: el navegador le habla al proxy (mismo origen, `localhost`, sin problema), y el proxy
—que corre como script de Python, no como código de navegador— es quien de verdad le pega a
`uwu-logs.xyz`, igual que hace el CLI con `requests`.

Si en algún momento preferís abrirlo con `python3 -m http.server` en vez del proxy, **no va a
funcionar**: el dashboard va a mostrar "Error al traer datos" en todas las filas, porque ese
servidor no tiene el endpoint `/api/character` que el proxy sí expone.

## Próximos pasos posibles

- Compartir el roster entre dispositivos (hoy vive solo en `localStorage` del navegador).
- Job programado (`cron` / GitHub Actions) que corra `uwu-tracker fetch` para todo el roster
  y alimente tanto la DB del CLI como el dashboard.
