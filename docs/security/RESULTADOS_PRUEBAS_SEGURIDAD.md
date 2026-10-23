# Resultados de pruebas de seguridad

Fecha: 2026-10-23  
Entorno: repositorio local en Windows/PowerShell, Node.js 22.14.0.

## Resumen

| Comprobación | Resultado real |
|---|---|
| Suite inicial | 23/23 pruebas aprobadas |
| Suite final | 35/35 pruebas aprobadas |
| Sintaxis backend | Aprobada |
| Build frontend de producción | Aprobado, con advertencia no bloqueante por chunk mayor a 500 kB |
| npm audit raíz inicial | 1 vulnerabilidad crítica transitiva (`shell-quote@1.8.3`) |
| npm audit raíz final | 0 vulnerabilidades conocidas; `shell-quote@1.12.0` |
| npm audit backend final | 0 vulnerabilidades conocidas en 311 dependencias contabilizadas |
| npm audit frontend final | 0 vulnerabilidades conocidas en 94 dependencias contabilizadas |
| Revisión de secretos actual/histórica | Sin secretos reales detectados; solo placeholder en `.env.example` |
| `git diff --check` | Sin errores; solo advertencias de normalización LF/CRLF |

## Comandos ejecutados y resultados

### Reconocimiento y estado

```powershell
git status --short
rg --files -g '!node_modules' -g '!dist' -g '!build' -g '!coverage' -g '!.git'
git diff --stat
git diff --check
```

Resultados:

- Se inventariaron frontend, backend, configuración, documentación, scripts y pruebas.
- El estado inicial ya contenía cambios del usuario en 10 archivos del backend; no se revirtieron.
- La revisión final de whitespace no reportó errores. Git avisó que algunos archivos pasarán de LF a CRLF cuando Git vuelva a escribirlos; no afecta la ejecución.

### Pruebas automatizadas

```powershell
npm test
```

Resultado inicial: 23 aprobadas, 0 fallidas.  
Resultado final: 35 aprobadas, 0 fallidas, 0 omitidas; duración reportada de la última ejecución: 154.7058 ms.

Cobertura funcional de las pruebas finales:

- Normalización e integridad de tickets.
- Idempotencia aislada por usuario.
- Propietario/admin para lectura de tickets.
- Estados inciertos y conciliación de stock.
- Normalización y colisiones de ubicaciones.
- Redacción de secretos/correos en observabilidad.
- Escape XSS de plantillas de email.
- Segmentos de ruta de inventario contra traversal.
- URL de inventario obligatoria y con protocolo válido.
- Prohibición de fallback de servicio en endpoints de usuario.
- Autorización positiva/negativa por área.
- Administración negativa de cuentas privilegiadas y autoeliminación.
- Rechazo de inyección CRLF en correos.
- Rate limiting y respuesta 429.
- Cabeceras defensivas.
- Neutralización de fórmulas CSV.
- Rechazo de URLs absolutas/protocol-relative en el cliente API.
- Límites de comentarios y caracteres de control.

### Sintaxis y build

```powershell
npm run check
```

Resultado:

- `node scripts/check-syntax.js`: aprobado para fuentes y pruebas del backend.
- `vite build`: 632 módulos transformados y build generado correctamente.
- Advertencia: bundle JavaScript de aproximadamente 761.47 kB antes de gzip; es un asunto de rendimiento, no una falla de seguridad reproducida.

### Auditoría de dependencias

```powershell
npm audit --json
npm audit --omit=dev --json          # desde backend/
npm audit --json                     # desde frontend/
npm ls shell-quote
npm audit fix --dry-run --json
npm install --ignore-scripts
```

Resultados:

1. Backend inicial/final: 0 vulnerabilidades conocidas en dependencias de producción.
2. Frontend inicial/final: 0 vulnerabilidades conocidas.
3. Raíz inicial: `shell-quote@1.8.3` fue reportado con una advisory crítica de command injection y otra alta de complejidad cuadrática.
4. El dry-run indicó un único cambio: `shell-quote 1.8.3 -> 1.12.0`.
5. Se agregó un override, se actualizó con scripts deshabilitados y `npm ls` confirmó `shell-quote@1.12.0` bajo `concurrently@8.2.2`.
6. Los tres `npm audit` finales devolvieron cero vulnerabilidades.

### Búsqueda de secretos y permisos

Se usaron búsquedas por nombre/patrón que solo devolvían rutas, nunca valores:

```powershell
git ls-files | rg -i "nombres sensibles"
rg -l -i "patrones de claves/tokens" .
git rev-list --all
git grep -I -l -E "patrones de claves/tokens" <revision> -- .
git check-ignore <ruta>
Get-Acl <ruta>
```

Resultados:

- No hay `.env`, cuentas de servicio, PEM o claves equivalentes versionados por nombre.
- En 48 revisiones Git, la única ruta que coincidió con los patrones fue `backend/.env.example`, por el marcador de ejemplo de clave privada.
- Existen localmente `backend/.env`, `backend/ticket-service-account.json` y `frontend/.env`; los tres están ignorados.
- Sin leer contenidos, la revisión resumida de ACL no encontró concesiones amplias explícitas de lectura a Everyone/Users. Los archivos heredan ACL.
- `backend/SECURITY_RECOMMENDATIONS.md` afirma una exposición anterior; la rotación no es verificable desde código.

### Análisis estático manual

Se buscaron y revisaron usos de:

- ejecución de comandos, `eval`, HTML no seguro y acceso directo al DOM;
- `fetch`, Bearer, variables de entorno, lectura/escritura de archivos;
- consultas Firestore, construcción de rutas e IDs;
- respuestas con errores, logs, auditorías y datos personales;
- endpoints y middleware de autenticación/autorización.

Resultado resumido:

- No se halló SQL/NoSQL construido por concatenación ni ejecución de comandos con entrada web.
- React no usa `dangerouslySetInnerHTML`; las plantillas de correo escapan valores.
- Se corrigieron las superficies de ruta de inventario, CSV, URL absoluta, permisos por área, administración de roles, logs y WebSocket documentadas en la auditoría.

## Pruebas fallidas, omitidas o bloqueadas

### Incidencia del sandbox

La primera ejecución de Node/npm dentro del sandbox falló con `EPERM` al resolver `C:\Users\DIEGO`. Se repitieron los comandos autorizados fuera de ese aislamiento y entonces finalizaron correctamente. No se contabilizó el `EPERM` como fallo del proyecto.

### No ejecutadas deliberadamente

- Inicio completo del servidor contra Firebase real.
- Solicitudes autenticadas end-to-end a rutas Express.
- Operaciones reales de inventario, aprobaciones, compensaciones o conciliaciones.
- Envío real de correo con Resend.
- Handshake/carga WebSocket real.
- Scripts de diagnóstico de inventario contra destinos externos.
- Migraciones Firestore.
- Pruebas de carga, DoS o borrado.

Motivo: requerían credenciales o servicios externos y podían afectar datos/producción. No se simuló un resultado exitoso. Deben ejecutarse con Firebase Emulator y dobles locales según `PLAN_REMEDIACION.md`.

## Reproducción recomendada

Desde la raíz del repositorio:

```powershell
npm test
npm run check
npm audit --json
npm audit --omit=dev --json --prefix backend
npm audit --json --prefix frontend
npm ls shell-quote
git diff --check
```

Para diagnósticos externos, configure una URL explícita. Los scripts ahora rechazan destinos no locales salvo que el operador establezca conscientemente `ALLOW_EXTERNAL_DIAGNOSTICS=true`; no debe usarse contra producción sin autorización separada.
