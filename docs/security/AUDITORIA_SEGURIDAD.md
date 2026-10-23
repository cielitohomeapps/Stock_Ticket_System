# Auditoría integral de seguridad

Fecha: 2026-10-23  
Alcance: repositorio `TicketAutomatization` en el estado de trabajo local auditado.

## Resumen ejecutivo

Se revisaron la SPA React/Vite, la API Express, la autenticación Firebase, las dos conexiones Firestore, el flujo transaccional de tickets y stock, la integración con inventario y Resend, la generación de documentos, los diagnósticos, el monitoreo REST/WebSocket y las dependencias npm.

Se identificaron 13 hallazgos: 0 críticos, 4 altos, 6 medios y 3 bajos. Por confianza, 10 fueron confirmados, 2 probables y 1 informativo. Se implementaron correcciones para los 12 hallazgos técnicos; el hallazgo informativo sobre secretos locales requiere verificación y rotación operativa. El hallazgo de dependencias tenía severidad crítica según npm/GitHub Advisory, pero se clasificó como alto en el contexto del sistema porque estaba limitado a una dependencia de desarrollo y las invocaciones del repositorio usan comandos constantes.

La validación final obtuvo 35/35 pruebas aprobadas, sintaxis del backend correcta, build de producción correcto y 0 vulnerabilidades conocidas en los tres árboles npm auditados. Esto no demuestra ausencia total de vulnerabilidades: no se realizaron pruebas activas contra Firebase, Resend, inventario ni producción.

## Arquitectura y relaciones de confianza

```text
Navegador React/Vite
  ├─ Firebase Auth ──> Firebase Identity Platform
  └─ Bearer ID token ──> API Express
                         ├─ Firebase Admin ──> Firestore de usuarios/inventario
                         ├─ Firebase Admin ──> Firestore de tickets/configuración
                         ├─ HTTP Bearer ──> API externa de inventario
                         ├─ API key ──> Resend
                         ├─ PDF/DOCX en memoria ──> navegador autenticado
                         └─ métricas REST/WebSocket ──> administradores
```

Componentes críticos:

- `frontend/`: React 18, Vite 8 y Firebase Auth. No accede directamente a Firestore.
- `backend/src/app.js`: composición HTTP, validación de Firebase ID tokens, resolución de roles y rutas.
- `backend/src/services/ticket.service.js`: validación, persistencia, idempotencia y transiciones de tickets.
- `backend/src/services/stock.service.js`: bloqueo transaccional, movimientos externos, compensación y conciliación manual.
- `backend/src/services/inventory-api.service.js`: frontera de confianza con inventario y credencial de servicio.
- Firestore: usuarios en la base compartida; tickets, auditorías, movimientos, ubicaciones y configuración en la base de tickets.
- Resend: salida de correo; sus fallos no revierten movimientos de stock ya confirmados.
- Proceso en segundo plano: escaneo acotado de integridad de tickets.

## Alcance y metodología

La revisión usó OWASP Top 10, OWASP ASVS y CWE como guías. Se inspeccionaron rutas, middleware, controladores, servicios, formularios, exportación, documentos, scripts, manifiestos, lockfiles, configuración, pruebas y estado Git. Se buscaron patrones de inyección, traversal, XSS, ejecución de comandos, secretos, exposición de errores, falta de autorización, operaciones no atómicas y abuso de recursos.

Se ejecutaron pruebas unitarias/negativas, verificación de sintaxis, build, auditorías npm y búsquedas de secretos por nombre y patrón en el árbol actual y en 48 revisiones Git. No se leyeron ni imprimieron valores de los archivos locales con secretos. No se ejecutaron migraciones ni diagnósticos contra servicios externos.

Al iniciar había cambios del usuario sin confirmar en 10 archivos del backend. Se conservaron; por eso el diff total incluye trabajo previo además de las correcciones descritas aquí.

## Resumen de hallazgos

| ID | Severidad | Confianza | Estado | Hallazgo |
|---|---|---|---|---|
| SEC-001 | Alta | Confirmada | Corregido | Manipulación de ruta hacia inventario mediante `productId` |
| SEC-002 | Alta | Confirmada | Corregido | Autorización por área ausente y fallback privilegiado en endpoints de usuario |
| SEC-003 | Alta | Confirmada | Corregido | Administración de cuentas privilegiadas incompleta y revocación demorada |
| SEC-004 | Alta | Confirmada | Corregido | Dependencia vulnerable `shell-quote` en herramientas de desarrollo |
| SEC-005 | Media | Confirmada | Mitigado | Sin rate limiting en operaciones costosas o privilegiadas |
| SEC-006 | Media | Confirmada | Corregido | Fallback y diagnósticos con destino externo por defecto |
| SEC-007 | Media | Confirmada | Corregido | Inyección de fórmulas en exportaciones CSV |
| SEC-008 | Baja | Probable | Corregido preventivamente | Cliente API permitía destinos absolutos con token Bearer |
| SEC-009 | Media | Confirmada | Corregido | Validación insuficiente de correos, comentarios y ubicaciones |
| SEC-010 | Media | Confirmada | Corregido | WebSocket sin límite explícito de carga ni expiración de sesión |
| SEC-011 | Media | Probable | Corregido | Superficie excesiva de datos y errores en respuestas, auditorías y logs |
| SEC-012 | Baja | Confirmada | Corregido | Cabeceras defensivas y política de caché ausentes |
| SEC-013 | Baja | Informativa | Pendiente operativo | Secretos locales ignorados; rotación histórica no verificable |

## Hallazgos detallados

### SEC-001 — Manipulación de ruta hacia inventario

- Severidad/confianza: alta, confirmada.
- Referencias: CWE-22, CWE-918; OWASP A10:2021.
- Componente: `backend/src/services/inventory-api.service.js` (construcción anterior de `/productos/${productId}`).
- Evidencia mínima: un identificador como `../admin?mode=write` se interpolaba sin codificar; la normalización URL podía sacar la petición del segmento `/productos/:id` y reutilizar un Bearer de usuario o de servicio.
- Riesgo: consulta o invocación de otro endpoint del mismo origen del inventario, con posible uso de una credencial más privilegiada.
- Condiciones: usuario autenticado capaz de controlar `productId` y una ruta compatible en el servicio externo.
- Reproducción segura: ejecutar la prueba `codifica identificadores de inventario como un único segmento de ruta`; no realiza red.
- Corrección: validación de longitud/controles y `encodeURIComponent` por segmento en consultas y movimientos.
- Prueba de corrección: `backend/test/security-regressions.test.js` verifica que el payload permanezca dentro de `/api/productos/<segmento>`.

### SEC-002 — Autorización por área y fallback privilegiado

- Severidad/confianza: alta, confirmada.
- Referencias: CWE-862, CWE-863; OWASP A01:2021; ASVS V4.
- Componentes: `backend/src/app.js`, `controllers/inventoryController.js`, `services/ticket.service.js` e `inventory-api.service.js`.
- Evidencia mínima: `areasPermitidas` se cargaba pero no se comprobaba. Además, un 401/403 del inventario en un endpoint solicitado por un usuario disparaba automáticamente la cuenta de servicio.
- Riesgo: acceso horizontal a productos/áreas no autorizados y sustitución silenciosa de una identidad restringida por una identidad de servicio.
- Condiciones: cuenta registrada, permiso limitado por área y rechazo del token de usuario en inventario.
- Reproducción segura: las pruebas `aplica autorización por área en el backend` y `los endpoints de usuario no pueden escalar...` ejercitan la decisión sin servicios reales.
- Corrección: middleware de área en consultas y escrituras, filtrado de catálogo, comprobación del área real del producto al enviar, y fallback de servicio denegado por defecto. Los movimientos internos autorizados lo habilitan explícitamente.
- Prueba de corrección: casos positivos de normalización de área y negativos de otra área/fallback en `security-regressions.test.js`.

### SEC-003 — Gestión de privilegios y revocación demorada

- Severidad/confianza: alta, confirmada.
- Referencias: CWE-269, CWE-284; OWASP A01:2021.
- Componentes: `controllers/userController.js`, `services/user-policy.service.js` y autenticación en `app.js`.
- Evidencia mínima: un administrador no superadmin no podía asignar `admin`, pero sí podía editar o degradar una cuenta que ya fuera admin/superadmin. La caché local conservaba roles hasta cinco minutos después de un cambio o borrado.
- Riesgo: sabotaje de cuentas privilegiadas y continuación temporal de acciones administrativas después de revocar permisos.
- Condiciones: cuenta con rol `admin` o una cuenta recientemente degradada.
- Reproducción segura: política pura con actor `admin`, objetivo `superadmin` y rol nuevo `usuario`.
- Corrección: política central para crear/editar/eliminar, bloqueo de autoeliminación y lectura del rol desde Firestore en cada solicitud HTTP. Firebase también verifica revocación del ID token.
- Prueba de corrección: pruebas negativas de modificación/eliminación y positiva para gestionar usuarios ordinarios.

### SEC-004 — Dependencia vulnerable `shell-quote`

- Severidad/confianza: alta, confirmada. La fuente la calificó crítica; el alcance observado es de desarrollo.
- Referencias: CWE-77, CWE-78 y CWE-407.
- Componente: `concurrently@8.2.2 -> shell-quote@1.8.3` en el paquete raíz.
- Evidencia mínima: `npm audit` reportó GHSA-w7jw-789q-3m8p y GHSA-395f-4hp3-45gv.
- Riesgo: inyección de comandos o consumo cuadrático si una herramienta procesa valores no confiables.
- Condiciones: ejecución de la herramienta de desarrollo con entrada atacante; los scripts actuales usan comandos constantes.
- Reproducción segura: `npm audit --json` antes de la actualización y `npm ls shell-quote`.
- Corrección: override a `shell-quote ^1.12.0` y lockfile regenerado con scripts de instalación deshabilitados.
- Prueba de corrección: `npm ls shell-quote` devuelve 1.12.0; el audit raíz final devuelve cero vulnerabilidades.

### SEC-005 — Ausencia de rate limiting

- Severidad/confianza: media, confirmada.
- Referencias: CWE-770; OWASP A04:2021; ASVS V11.
- Componente: rutas de tickets, inventario y mutaciones administrativas.
- Evidencia mínima: no existía limitador y cada solicitud podía consumir Firebase o servicios externos.
- Riesgo: abuso autenticado, costos, saturación y repetición de operaciones sensibles.
- Condiciones: cualquier cuenta válida; para mutaciones administrativas, rol privilegiado.
- Reproducción segura: limitador de prueba con máximo 2; la tercera solicitud recibe 429 y `Retry-After`.
- Corrección: límites por UID y ámbito, configurables, con mapa acotado. Valores por defecto: 20/min para escrituras de ticket, 60/min para mutaciones privilegiadas y 120/min para lecturas de inventario.
- Prueba de corrección: prueba `limita operaciones sensibles por identidad autenticada`.
- Residual: el contador es local a cada proceso; varias réplicas requieren un almacén distribuido o gateway.

### SEC-006 — Destino externo inseguro por defecto

- Severidad/confianza: media, confirmada.
- Referencias: CWE-16, CWE-441.
- Componentes: configuración de inventario y scripts `test-endpoints.js`/`test-inventory-api.js`.
- Evidencia mínima: si faltaba `INVENTORY_API_BASE_URL`, la aplicación o los scripts usaban una URL pública predeterminada.
- Riesgo: envío accidental de tokens o pruebas a un sistema externo/producción por una configuración incompleta.
- Condiciones: variable ausente y ejecución de la aplicación o diagnóstico.
- Reproducción segura: `normalizeInventoryBaseUrl("")` ahora falla con `INVENTORY_CONFIGURATION_ERROR`.
- Corrección: fallo cerrado, protocolos HTTP(S) sin credenciales embebidas y opt-in `ALLOW_EXTERNAL_DIAGNOSTICS=true` para destinos no locales.
- Prueba de corrección: casos de URL vacía, `file:` y credenciales embebidas.

### SEC-007 — Inyección de fórmulas CSV

- Severidad/confianza: media, confirmada.
- Referencia: CWE-1236.
- Componente: `frontend/src/services/ticketAnalytics.service.ts`.
- Evidencia mínima: campos de tickets se envolvían entre comillas, pero valores que iniciaban con `=`, `+`, `-` o `@` seguían siendo fórmulas para hojas de cálculo.
- Riesgo: al abrir el CSV, un administrador podía ejecutar fórmulas o enlaces controlados por datos importados.
- Condiciones: dato controlable persistido y apertura en un programa compatible con fórmulas.
- Reproducción segura: exportar el valor `=HYPERLINK("https://evil.example")` mediante la utilidad de prueba.
- Corrección: neutralización con apóstrofo y escape CSV uniforme de todas las celdas.
- Prueba de corrección: prueba ESM de `escapeCsvCell`.

### SEC-008 — Destinos absolutos en el cliente API

- Severidad/confianza: baja, probable.
- Referencia: CWE-200.
- Componente: `frontend/src/services/apiClient.js`.
- Evidencia mínima: `apiFetch` aceptaba cualquier cadena iniciada por `http` y añadía el Bearer antes de `fetch`.
- Riesgo: una ruta controlada en una llamada futura podría exfiltrar el token a otro origen.
- Condiciones: que un flujo entregue una URL controlada a `apiFetch`; no se halló un callsite explotable actual.
- Reproducción segura: `buildApiUrl('/api', 'https://evil.example/steal')` debe lanzar una excepción.
- Corrección: solo rutas relativas con `/`, sin `//`, barras inversas ni controles.
- Prueba de corrección: casos negativos de URL absoluta y protocol-relative.

### SEC-009 — Validación insuficiente de campos secundarios

- Severidad/confianza: media, confirmada.
- Referencias: CWE-20, CWE-93.
- Componentes: destinatarios de ticket/configuración, comentarios administrativos, nombres/aliases de ubicaciones y cantidades heredadas de stock.
- Evidencia mínima: `assignedUsers` aceptaba textos arbitrarios; los comentarios y ubicaciones no tenían límites específicos; el movimiento heredado aceptaba números no enteros.
- Riesgo: abuso de correo, inyección de cabeceras dependiente del proveedor, documentos/logs sobredimensionados e inconsistencias.
- Condiciones: solicitud API manipulada; no depende del formulario.
- Reproducción segura: correo con CRLF, comentario de 1001 caracteres y producto con carácter de control.
- Corrección: normalización/deduplicación de correos, máximos de listas/textos, límites de ubicaciones y `Number.isSafeInteger` en stock.
- Prueba de corrección: casos negativos en `ticket-integrity.test.js` y `security-regressions.test.js`.

### SEC-010 — WebSocket sin límites suficientes

- Severidad/confianza: media, confirmada.
- Referencias: CWE-400, CWE-613.
- Componente: `backend/src/services/websocket.service.js`.
- Evidencia mínima: no se configuraba `maxPayload` y una conexión seguía activa sin un cierre ligado a la expiración del token.
- Riesgo: presión de memoria y sesiones administrativas más largas que la credencial presentada.
- Condiciones: WebSocket habilitado y token administrativo válido.
- Reproducción segura: revisión de opciones de servidor y prueba de sintaxis; no se enviaron cargas grandes.
- Corrección: payload máximo de 64 KiB, compresión deshabilitada, cierre al expirar el token o a la hora y logs estructurados/enmascarados.
- Prueba de corrección: verificación de código y build. No se hizo handshake real por falta de entorno conectado.

### SEC-011 — Exposición excesiva en datos y errores

- Severidad/confianza: media, probable.
- Referencias: CWE-200, CWE-532; OWASP A09:2021.
- Componentes: listado de usuarios, errores de notificación/stock, auditorías y observabilidad.
- Evidencia mínima: el listado propagaba todos los campos de documentos de una colección compartida; se guardaban mensajes crudos de proveedores; WebSocket registraba el correo completo; cadenas de error podían contener Bearer/JWT.
- Riesgo: exposición de campos futuros o internos y persistencia de PII/secretos en logs/auditoría.
- Condiciones: presencia de campos adicionales o un proveedor que incluya datos sensibles en el error.
- Reproducción segura: sanitizar una cadena con `Bearer secret-value` y revisar que el valor desaparezca.
- Corrección: allowlist de campos de usuario, errores persistidos genéricos con código, conteos en vez de destinatarios, enmascarado de correo y redacción de Bearer/JWT/clave privada.
- Prueba de corrección: `observability.test.js` y revisión del serializador.

### SEC-012 — Cabeceras y caché defensivas ausentes

- Severidad/confianza: baja, confirmada.
- Referencias: CWE-693, CWE-525.
- Componente: middleware Express global.
- Evidencia mínima: Express exponía `X-Powered-By`; no había protección de framing, MIME sniffing, referrer ni `no-store` para API.
- Riesgo: clickjacking, caching de respuestas autenticadas y menor defensa ante interpretación de contenido.
- Condiciones: navegador o intermediario que cachee/interprete respuestas.
- Reproducción segura: invocar el middleware con una respuesta falsa y comprobar cabeceras.
- Corrección: cabeceras defensivas, CSP parcial de framing/object/base, HSTS en producción, ocultación de tecnología y `Cache-Control: no-store` para `/api`.
- Prueba de corrección: prueba `agrega cabeceras defensivas...`.

### SEC-013 — Secretos locales y rotación

- Severidad/confianza: baja, informativa.
- Referencias: CWE-798; OWASP A02:2021.
- Componentes: `backend/.env`, `backend/ticket-service-account.json` y `frontend/.env` locales.
- Evidencia mínima: los tres archivos existen y Git los ignora; no se leyó su contenido. No se hallaron rutas sensibles versionadas ni patrones de secretos reales en 48 revisiones; solo coincidió el placeholder de `.env.example`. Los ACL inspeccionados no mostraron concesión amplia explícita a Everyone/Users, aunque heredan permisos.
- Riesgo: copia accidental, respaldo inseguro o credenciales históricamente expuestas. `backend/SECURITY_RECOMMENDATIONS.md` ya declara una exposición anterior, pero esta auditoría no puede verificar si se rotaron.
- Condiciones: acceso local, respaldo o credencial no rotada.
- Reproducción segura: `git check-ignore` y revisión de ACL/nombres, sin imprimir contenido.
- Corrección recomendada: mantener fuera de Git, usar gestor de secretos y verificar/registrar rotación de Firebase, inventario, Resend y cuenta de prueba.
- Prueba de corrección: pendiente operativa; no puede demostrarse desde el repositorio.

## Correcciones realizadas

- Autorización backend por área y comprobación del área real de cada producto.
- Fallback de credencial de servicio explícito solo para operaciones internas autorizadas.
- Segmentos de rutas de inventario codificados y URL base obligatoria.
- Política de gestión de roles y eliminación de caché de autorización.
- Rate limiting por identidad para tickets, inventario y administración.
- Validación central de correos/textos y límites de WebSocket.
- Neutralización CSV y restricción de rutas del cliente API.
- Redacción de logs/errores, allowlist de usuarios y auditorías sin listas de correos.
- Cabeceras HTTP y respuestas API no cacheables.
- `shell-quote` actualizado a 1.12.0.
- Nuevas pruebas de regresión incluidas en `npm test`.

## Riesgos residuales y limitaciones

- El rate limiting es por proceso; debe centralizarse para despliegues con varias réplicas.
- Una conexión WebSocket ya abierta no relee el rol hasta expirar/cerrar, con un máximo actual de una hora. El WebSocket está deshabilitado por defecto.
- No existe una decisión documentada sobre autoaprobación de tickets por un administrador que sea también solicitante.
- `assignedUsers` se valida como correo, pero no se exige aún que pertenezca al directorio ni a un dominio permitido.
- Los registros de idempotencia/auditoría no declaran TTL o política de retención en este repositorio.
- Reportes administrativos cargan colecciones completas; deben paginarse o preagregarse para volúmenes altos.
- La CSP es deliberadamente parcial; una política completa requiere inventariar orígenes Firebase/Resend y la forma real de despliegue.
- No se inspeccionaron IAM, reglas Firestore desplegadas, TLS del hosting, WAF, backups ni configuración real de Firebase/Resend/inventario.
- No se realizaron pruebas end-to-end con credenciales ni ataques activos contra sistemas externos.

## Conclusión

Las vulnerabilidades reproducibles dentro del repositorio quedaron corregidas o mitigadas y cuentan con evidencia automatizada cuando era posible. El sistema no debe considerarse “libre de vulnerabilidades”: quedan controles de infraestructura, decisiones de negocio y verificaciones operativas descritas en `PLAN_REMEDIACION.md`.
