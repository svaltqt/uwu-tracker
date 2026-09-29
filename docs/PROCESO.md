# Proceso de trabajo

Cómo se trabaja en uwu-tracker desde septiembre de 2026. El backlog está en
[HISTORIAS_DE_USUARIO.md](HISTORIAS_DE_USUARIO.md).

## Flujo de una historia

1. **Elegir** una historia de "Por hacer". Solo una historia en progreso a la vez.
2. **Crear el branch** desde `main` actualizado:
   ```
   git checkout main
   git pull
   git checkout -b fix/UT-15-proxy-windows
   ```
3. **Moverla a "En progreso"** en HISTORIAS_DE_USUARIO.md.
4. **Implementar** con tests. Cada criterio cumplido se marca con `[x]`.
5. **Commitear** en pasos pequeños, con el ID en el mensaje.
6. **Probar a mano** con datos reales cuando el cambio toque la API o el dashboard.
7. **Abrir un pull request** a `main` y revisar el diff completo.
8. **Mezclar**, borrar el branch y mover la historia a "Hecho".

Las historias que salgan durante el trabajo se agregan al backlog; no se
resuelven en el branch actual salvo que bloqueen la historia en curso.

## Definición de listo

Una historia puede pasar a "Por hacer" cuando tiene:

- El formato "Como…, quiero…, para…".
- Criterios de aceptación que se puedan comprobar.
- Tipo y prioridad.

## Definición de hecho

Una historia está en "Hecho" cuando:

- Todos sus criterios están marcados.
- Los tests pasan, incluidos los que ya existían.
- Se probó a mano si toca la API real o el dashboard.
- El README o docs/API.md se actualizaron si cambió el uso o la API.
- El pull request está mezclado en `main`.

## Nombres de branch

`tipo/UT-XX-descripcion-corta`, en minúsculas y con guiones.

| Tipo | Uso |
| --- | --- |
| `feat/` | Funcionalidad nueva |
| `fix/` | Corrección de un error |
| `test/` | Tests o CI sin cambiar comportamiento |
| `docs/` | Solo documentación |
| `refactor/` | Reorganizar código sin cambiar comportamiento |
| `chore/` | Configuración, dependencias, build |

## Mensajes de commit

Formato [Conventional Commits](https://www.conventionalcommits.org/es/), con el
ID de la historia al final:

```
tipo(ámbito): descripción en imperativo (UT-XX)
```

Ejemplos:

```
fix(proxy): escape report_id in report routes (UT-05)
test(db): cover snapshot export to CSV (UT-07)
feat(web): add boss ranking tab (UT-16)
```

Ámbitos habituales: `proxy`, `cli`, `api`, `db`, `web`, `build`, `docs`.

## Versiones

Se usa [SemVer](https://semver.org/lang/es/). Un tag `vX.Y.Z` dispara el build de
los ejecutables (ver `.github/workflows/build.yml`).

- **Patch** (`v0.2.1`): solo correcciones.
- **Minor** (`v0.3.0`): funcionalidad nueva compatible con los datos guardados.
- **Major** (`v1.0.0`): cambios que rompen el roster o la base de datos guardada.

El tag se crea en `main` después de mezclar, nunca en un branch.

## Git y Claude Code

Los comandos git que modifican el repo (commit, branch, merge, push, tag) los
ejecuta solo el dueño del repo. Ver CLAUDE.md.
