# Ticket Automatization

Aplicación web para crear, revisar y aprobar tickets de entrada o salida de inventario. El frontend React usa Firebase Auth; el backend Express valida la identidad, persiste tickets en Firestore, consulta la API de inventario, aplica movimientos de stock y envía notificaciones mediante Resend.

## Arquitectura

- `frontend/`: React 18 y Vite. Formularios, historial, administración y panel de monitoreo.
- `backend/`: Express, Firebase Admin, reglas de negocio, documentos, email y observabilidad.
- Firestore: colecciones de tickets, usuarios, auditoría y configuración.
- API de inventario: consulta de productos/stock y movimientos de entrada o salida.
- Resend: notificaciones por correo.

El flujo principal es:

1. El usuario completa todos los campos e ítems.
2. `POST /api/tickets/submit` valida el contrato completo y el stock.
3. El ticket se persiste directamente como `EN_REVISION` y se relee para verificar su integridad.
4. Un administrador aprueba, rechaza o devuelve el ticket.
5. La aprobación aplica el movimiento de stock de forma protegida contra ejecución concurrente.
6. Solo después se intenta el correo. Un error de notificación queda registrado y no se presenta como éxito silencioso.

Los borradores existentes continúan usando `CREADO` y pueden actualizarse y enviarse con `PUT /api/tickets/:id/submit`.

El envío completo `POST /api/tickets/submit` requiere el header `Idempotency-Key` (8–128 caracteres). El frontend conserva la clave durante el intento, incluso si se recarga la pestaña: repetir la misma solicitud devuelve el ticket ya creado, y reutilizar la clave con datos distintos devuelve `409 IDEMPOTENCY_KEY_REUSED`. Ante ese conflicto, revisa Mis Tickets antes de confirmar un nuevo envío.

El destino de tickets nuevos debe elegirse del catálogo de ubicaciones canónicas. Los nombres y alias se comparan ignorando acentos, mayúsculas y espacios repetidos; el backend guarda el nombre canónico y rechaza destinos desconocidos o aliases ambiguos. Si falta una ubicación o alias, un administrador debe agregarlo desde la sección Ubicaciones. Los reportes normalizan de forma segura los destinos históricos que coinciden con un alias único; los valores sin coincidencia o ambiguos se conservan para revisión y no se reasignan automáticamente.

Para consolidar ubicaciones duplicadas ya creadas, un administrador puede usar **Unificar** en el catálogo. Los aliases de la ubicación de origen se agregan a la ubicación canónica y el registro de catálogo de origen se elimina en una transacción; los tickets históricos no se modifican ni eliminan y sus reportes se agrupan por el alias. Cada unificación queda registrada en `locationAudits`.

Si una llamada al inventario termina sin que pueda saberse si el proveedor aplicó el cambio, el ticket queda bloqueado con resultado `UNKNOWN`. Un administrador debe verificar el historial del sistema externo y usar `POST /api/admin/tickets/:id/reconcile-stock` con `decision: "APPLIED"` o `"NOT_APPLIED"` y una justificación. La conciliación queda auditada; al confirmar `APPLIED` no se envía correo automáticamente.

## Requisitos

- Node.js 22.12 o posterior.
- Credenciales válidas de Firebase Admin y Firebase Auth.
- Acceso a la API externa de inventario.
- Una clave de Resend si se habilitan notificaciones.

## Configuración

```powershell
Copy-Item backend/.env.example backend/.env
npm install
npm run install:all
```

Completa `backend/.env`. En especial:

- `INVENTORY_API_BASE_URL`: se respeta literalmente, incluido `localhost`.
- `INVENTORY_AUTH_API_KEY` o `INVENTORY_STATIC_BEARER_TOKEN`.
- credenciales `FIREBASE_*` y, si aplica, `TICKET_FIREBASE_*`.
- `SUPERADMIN_EMAIL` y `APPROVER_ROLES`.
- `RESEND_API_KEY` y `MAIL_FROM`.
- `CORS_ORIGINS`: lista separada por comas en producción.

No subas `.env`, cuentas de servicio, tokens ni claves al repositorio.

## Ejecución y validación

```powershell
npm run dev       # frontend y backend
npm test          # pruebas unitarias del backend
npm run check     # sintaxis del backend y build de producción del frontend
npm run build     # instalación y build para despliegue
npm start         # servidor de producción
```

En desarrollo, Vite sirve la UI en `http://127.0.0.1:5173` y redirige `/api` al backend en `http://localhost:3001`.

## Endpoints principales

Todos los endpoints de negocio requieren `Authorization: Bearer <Firebase ID token>`.

- `POST /api/tickets/submit`: crea y envía un ticket completo.
- `PUT /api/tickets/:id/submit`: actualiza y envía un borrador propio.
- `GET /api/tickets/my?page=1&pageSize=10`: historial paginado del usuario.
- `GET /api/tickets?page=1&pageSize=10`: listado paginado para administradores.
- `GET /api/tickets/:id`: propietario o administrador.
- `POST /api/tickets/:id/review`: decisión administrativa.
- `POST /api/admin/tickets/:id/reconcile-stock`: registra una conciliación administrativa de un movimiento incierto.
- `GET /api/locations`: catálogo autenticado de ubicaciones y aliases.
- `POST /api/locations/:id/merge`: unifica una ubicación de origen con la canónica indicada por `:id`; solo administradores.
- `GET /api/health/live`: salud del proceso, sin detalles sensibles.
- `GET /api/health/ready`: disponibilidad básica de proceso y base de datos.
- `GET /api/admin/monitoring/summary`: métricas y dependencias; solo administradores.
- `GET /api/admin/monitoring/logs`: logs filtrables y paginados; solo administradores.
- `GET /api/admin/monitoring/alerts`: alertas recientes; solo administradores.
- `GET /api/admin/monitoring/integrity`: escaneo acotado de tickets; solo administradores.

La documentación Swagger se habilita fuera de producción o con `ENABLE_API_DOCS=true`.

## Monitoreo

El backend emite una línea JSON por evento a `stdout`, con nivel, servicio, ambiente, módulo, tipo de evento, `requestId`, `correlationId`, `ticketId`, ruta, estado y duración cuando corresponda. Tokens, secretos, cookies, autorizaciones, contenido libre y emails se eliminan o enmascaran antes de registrar.

El panel “Monitoreo” consume REST autenticado cada 15 segundos. Muestra estado general, base de datos, tasa de errores, latencia P95, endpoints problemáticos, alertas, logs con filtros y hallazgos de integridad. El almacenamiento visible en el panel es intencionalmente acotado y en memoria; para retención y correlación entre réplicas, envía el `stdout` JSON del proveedor a Cloud Logging, Loki, Datadog, OpenTelemetry o una plataforma equivalente.

Consulta [AUDIT_AND_MONITORING.md](AUDIT_AND_MONITORING.md) para el diagnóstico, las decisiones implementadas, los umbrales y las limitaciones operativas.
Consulta [MOVEMENT_FLOW_AUDIT.md](MOVEMENT_FLOW_AUDIT.md) para el análisis de integridad, los estados de movimiento, los límites transaccionales, la recuperación de resultados inciertos y los pasos operativos.

## Seguridad

- [Auditoría integral de seguridad](docs/security/AUDITORIA_SEGURIDAD.md)
- [Plan de remediación](docs/security/PLAN_REMEDIACION.md)
- [Resultados de pruebas de seguridad](docs/security/RESULTADOS_PRUEBAS_SEGURIDAD.md)

## Índices de Firestore

Los índices requeridos están declarados en `firestore.indexes.json`. Deben desplegarse en el proyecto que contiene la base de tickets:

```powershell
firebase deploy --only firestore:indexes --project <ticket-project-id>
```

El despliegue no se ejecuta automáticamente desde este repositorio porque requiere elegir explícitamente el proyecto de producción.
