# Proceso de trabajo

Cómo se trabaja en uwu-tracker desde septiembre de 2026. El backlog vive en los
issues de GitHub, organizados en el Project
[uwu-tracker](https://github.com/users/svaltqt/projects/2). Las historias de la
funcionalidad que ya existía están en [HISTORIAS_DE_USUARIO.md](HISTORIAS_DE_USUARIO.md).

## Estados

Los estados son los del Project:

| Estado | Significado |
| --- | --- |
| `Backlog` | Historia registrada, sin prioridad de arranque |
| `Ready` | Cumple la definición de listo y se puede empezar |
| `In progress` | Tiene un branch abierto. Solo una historia a la vez |
| `In review` | Código y tests listos; falta probar a mano, revisar el PR o mezclar |
| `Done` | Cumple la definición de hecho |

La prioridad usa el campo `Priority` del Project: `P0` (la más urgente), `P1` y `P2`.

## Flujo de una historia

1. **Crear el issue** si todavía no existe. Cada historia nueva es un issue con el
   formato "Como…, quiero…, para…", los criterios de aceptación como task list
   (`- [ ]`), un label de tipo y su lugar en el Project. El título lleva el ID:
   `UT-XX: <título>`.
2. **Elegir** un issue en `Ready`. Solo una historia en `In progress` a la vez.
3. **Crear el branch** desde `main` actualizado, con el número del issue:
   ```
   git checkout main
   git pull
   git checkout -b fix/17-proxy-windows
   ```
4. **Moverlo a `In progress`** en el Project.
5. **Implementar** con tests. Cada criterio cumplido se marca en el issue.
6. **Commitear** en pasos pequeños, con el ID en el mensaje.
7. **Probar a mano** con datos reales cuando el cambio toque la API o el dashboard.
8. **Abrir un pull request** a `main` con `Closes #N` en la descripción (N es el
   número del issue), pasarlo a `In review` y revisar el diff completo.
9. **Mezclar** y borrar el branch. Al mezclar, `Closes #N` cierra el issue y el
   Project lo pasa a `Done`.

Las historias que salgan durante el trabajo se crean como issue nuevo en `Backlog`;
no se resuelven en el branch actual salvo que bloqueen la historia en curso.

## Definición de listo

Un issue puede pasar a `Ready` cuando tiene:

- El formato "Como…, quiero…, para…".
- Criterios de aceptación que se puedan comprobar.
- Label de tipo y `Priority`.

## Definición de hecho

Una historia está en `Done` cuando:

- Todos sus criterios están marcados.
- Los tests pasan, incluidos los que ya existían.
- Se probó a mano si toca la API real o el dashboard.
- El README o docs/API.md se actualizaron si cambió el uso o la API.
- El pull request está mezclado en `main`.

## Nombres de branch

`tipo/N-descripcion-corta`, en minúsculas y con guiones, donde `N` es el número del
issue (no el ID `UT-XX`).

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
