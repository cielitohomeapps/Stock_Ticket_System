# Documentación técnica del sistema Ticket Automatization

## Resumen ejecutivo

La aplicación está formada por dos capas: un backend Express/Node.js que expone una API REST sobre Firestore y una API externa de inventario, y un frontend React/Vite que consume esa API con Firebase Auth para crear tickets, aprobarlos y descargar documentos PDF/Word.

El flujo principal es:
1. Usuario inicia sesión con Firebase Auth.
2. Crea un ticket de entrada/salida con productos, área, motivo y firma.
3. El backend valida stock y cambia el estado a EN_REVISION.
4. El administrador aprueba/rechaza desde el panel.
5. Si aprueba, se actualiza inventario en la API externa, se registra auditoría y se envía correo.

No hay Redux/Zustand/Pinia ni tests automatizados en el repositorio; el estado es local en React y el almacenamiento persistente se hace con Firebase Auth + sessionStorage.

---

## 1. Inventario completo del sistema

### Árbol de directorios y descripción

- [README.md](README.md) — descripción general, arquitectura, ejecución y despliegue.
- [FIREBASE_AUTH_SETUP.md](FIREBASE_AUTH_SETUP.md) — guía de solución de problemas para Firebase Auth.
- [firebase.json](firebase.json) — configuración de Firebase emuladores y functions.
- [mejoras_reporte.md](mejoras_reporte.md) — auditoría técnica y deuda técnica detectada.
- [package.json](package.json) — scripts raíz para levantar backend + frontend.
- [backend/](backend/) — API Node.js/Express.
  - [backend/package.json](backend/package.json) — dependencias del backend.
  - [backend/.env.example](backend/.env.example) — variables de entorno esperadas.
  - [backend/src/](backend/src/) — código fuente principal.
    - [backend/src/server.js](backend/src/server.js) — arranque del servidor.
    - [backend/src/app.js](backend/src/app.js) — configuración Express, rutas API, middlewares de auth y Swagger.
    - [backend/src/config/](backend/src/config/) — configuraciones de infraestructura.
      - [backend/src/config/firebase.js](backend/src/config/firebase.js) — inicialización Firebase Admin + Firestore.
    - [backend/src/controllers/](backend/src/controllers/) — controladores HTTP.
      - [backend/src/controllers/ticketController.js](backend/src/controllers/ticketController.js) — CRUD y aprobación/rechazo de tickets.
      - [backend/src/controllers/inventoryController.js](backend/src/controllers/inventoryController.js) — consulta productos/áreas a la API de inventario.
      - [backend/src/controllers/userController.js](backend/src/controllers/userController.js) — gestión de usuarios y configuración de email.
    - [backend/src/services/](backend/src/services/) — lógica de negocio y integraciones.
      - [backend/src/services/ticket.service.js](backend/src/services/ticket.service.js) — creación, validación, revisión y listado de tickets.
      - [backend/src/services/stock.service.js](backend/src/services/stock.service.js) — lock, validación y aplicación de stock a la API externa.
      - [backend/src/services/inventory-api.service.js](backend/src/services/inventory-api.service.js) — cliente HTTP para la API externa de inventario.
      - [backend/src/services/notification.service.js](backend/src/services/notification.service.js) — envío de correos por Resend.
      - [backend/src/services/email.templates.js](backend/src/services/email.templates.js) — plantillas HTML de correos.
      - [backend/src/services/audit.service.js](backend/src/services/audit.service.js) — escritura de auditoría en Firestore.
      - [backend/src/services/document.service.js](backend/src/services/document.service.js) — generación de PDF/Word.
      - [backend/src/services/user.service.js](backend/src/services/user.service.js) — CRUD de usuarios y configuración de email.
  - [backend/scripts/](backend/scripts/) — scripts auxiliares de diagnóstico.
- [frontend/](frontend/) — app React/Vite.
  - [frontend/package.json](frontend/package.json) — dependencias del frontend.
  - [frontend/vite.config.js](frontend/vite.config.js) — configuración Vite y proxy de /api.
  - [frontend/index.html](frontend/index.html) — punto de entrada HTML.
  - [frontend/src/](frontend/src/) — código fuente del frontend.
    - [frontend/src/main.jsx](frontend/src/main.jsx) — bootstrap React.
    - [frontend/src/App.jsx](frontend/src/App.jsx) — shell de navegación, sesión Firebase y vista principal.
    - [frontend/src/config/firebase.js](frontend/src/config/firebase.js) — inicialización de Firebase client.
    - [frontend/src/components/](frontend/src/components/) — componentes UI.
      - [frontend/src/components/GoogleAuthPanel.jsx](frontend/src/components/GoogleAuthPanel.jsx) — login con Google y login de desarrollo.
      - [frontend/src/components/TicketForm.jsx](frontend/src/components/TicketForm.jsx) — formulario principal de creación de tickets.
      - [frontend/src/components/AdminPanel.jsx](frontend/src/components/AdminPanel.jsx) — panel de aprobación, usuarios y configuración de email.
      - [frontend/src/components/HistoryPanel.jsx](frontend/src/components/HistoryPanel.jsx) — historial de tickets del usuario.
      - [frontend/src/components/Toast.jsx](frontend/src/components/Toast.jsx) — sistema de notificaciones toasts con Context.
      - [frontend/src/components/StepResult.jsx](frontend/src/components/StepResult.jsx) — pantalla final de confirmación del ticket.
      - Archivos legacy: AuthPanel.jsx, CreateTicketPanel.jsx, OutputPanel.jsx, StepArea.jsx, StepItems.jsx, StepReason.jsx, TicketActionsPanel.jsx, TicketSalida.jsx — no están conectados en el flujo actual.

### Tipos de archivos detectados

- Config: [backend/src/config/firebase.js](backend/src/config/firebase.js), [frontend/src/config/firebase.js](frontend/src/config/firebase.js), [frontend/vite.config.js](frontend/vite.config.js), [firebase.json](firebase.json).
- API/Controladores: [backend/src/app.js](backend/src/app.js), [backend/src/controllers/*.js](backend/src/controllers/).
- Servicios: [backend/src/services/*.js](backend/src/services/).
- Componentes UI: [frontend/src/components/*.jsx](frontend/src/components/).
- Documentación: [README.md](README.md), [FIREBASE_AUTH_SETUP.md](FIREBASE_AUTH_SETUP.md), [mejoras_reporte.md](mejoras_reporte.md).
- Tests: no hay archivos test/spec en el repositorio.

### Tecnologías detectadas por capa

- Backend: Node.js, Express, Firebase Admin SDK, Firestore, Resend, PDFKit, docx, dotenv, CORS, Swagger.
- Frontend: React 18, Vite 5, Firebase Web SDK, CSS modules/embedded styles.
- Infra: Firebase emulators, Firestore, Google Auth, optional service-account.json.

---

## 2. Fichas por módulo

### Módulo: Backend API principal
- Propósito: Exponer la API REST que soporta tickets, inventario, usuarios y documentación.
- Archivos clave: [backend/src/app.js](backend/src/app.js), [backend/src/server.js](backend/src/server.js).
- Entradas: headers Authorization, body JSON, query params y rutas.
- Salidas: JSON, archivos PDF/Word, HTML estático del frontend.
- Estado interno: no usa store global; depende de req.user, req.authToken y Firestore.
- Efectos: middleware de auth, Swagger, static hosting del frontend.
- Dependencias: express, cors, swagger-jsdoc, swagger-ui-express, firebase-admin.
- Exporta a: frontend, panel admin y historial.

### Módulo: Tickets
- Propósito: Crear, revisar, aprobar y descargar tickets.
- Archivos clave: [backend/src/controllers/ticketController.js](backend/src/controllers/ticketController.js), [backend/src/services/ticket.service.js](backend/src/services/ticket.service.js).
- Entradas: cuerpo con type, items, assignedUsers, metadata; rutas /api/tickets/*.
- Salidas: status JSON, auditoría, mails, documentos.
- Estado interno: Firestore collection tickets + ticketAudits.
- Efectos: llama a stock.service, notification.service, document.service, audit.service.
- Dependencias: firebase-admin/firestore, inventory-api.service.
- Exporta a: UI de TicketForm, AdminPanel, HistoryPanel.

### Módulo: Inventario externo
- Propósito: Consultar productos, áreas y aplicar descuentos/reingresos sobre un sistema externo.
- Archivos clave: [backend/src/services/inventory-api.service.js](backend/src/services/inventory-api.service.js), [backend/src/controllers/inventoryController.js](backend/src/controllers/inventoryController.js).
- Entradas: productId, area, clientToken, headers Authorization.
- Salidas: payload JSON del servicio externo.
- Estado interno: token cache y fallback por token estático o custom Firebase.
- Efectos: fetch HTTP con timeout y reintento por token inválido.
- Dependencias: firebase-admin auth, fetch global.
- Exporta a: validación de stock en ticket.service y stock.service.

### Módulo: Stock / aprobación
- Propósito: Aplicar cambios reales de stock cuando un administrador aprueba un ticket.
- Archivos clave: [backend/src/services/stock.service.js](backend/src/services/stock.service.js).
- Entradas: ticket completo + approver user + client token.
- Salidas: stockMovements document y estado STOCK_ACTUALIZADO/NOTIFICADO.
- Estado interno: lock por ticket con TTL; stockMovements collection.
- Efectos: llamadas HTTP al servicio externo, transacciones Firestore.
- Dependencias: inventory-api.service, firebase-admin/firestore.
- Exporta a: controller de aprobación.

### Módulo: Notificaciones y plantillas
- Propósito: enviar correos al aprobar o rechazar tickets.
- Archivos clave: [backend/src/services/notification.service.js](backend/src/services/notification.service.js), [backend/src/services/email.templates.js](backend/src/services/email.templates.js).
- Entradas: lista de destinatarios, subject, html.
- Salidas: correo via Resend.
- Estado interno: no guarda estado local; depende de config en Firestore.
- Efectos: llamada HTTP a Resend.
- Dependencias: resend, fs, path.
- Exporta a: ticketController.

### Módulo: Auditoría y usuarios
- Propósito: registrar auditoría y administrar usuarios y configuración de correos.
- Archivos clave: [backend/src/services/audit.service.js](backend/src/services/audit.service.js), [backend/src/services/user.service.js](backend/src/services/user.service.js).
- Entradas: acciones del sistema, emails, roles, áreas permitidas.
- Salidas: documentos en Firestore.
- Estado interno: collection usuarios/config/ticketAudits.
- Efectos: Firestore writes, no llamadas externas.
- Dependencias: firebase-admin/firestore.
- Exporta a: app.js y userController.

### Módulo: Documentos
- Propósito: generar PDF/Word de tickets para descarga.
- Archivos clave: [backend/src/services/document.service.js](backend/src/services/document.service.js).
- Entradas: ticket completo.
- Salidas: buffers PDF/Word.
- Estado interno: estilos y helpers para formatos.
- Efectos: uso de PDFKit y docx.
- Dependencias: pdfkit, docx.
- Exporta a: ticketController.download.

### Módulo: Frontend shell
- Propósito: sesión Firebase, navegación hash y render de vistas de ticket/admin/history.
- Archivos clave: [frontend/src/App.jsx](frontend/src/App.jsx).
- Entradas: onIdTokenChanged, hash de URL, clicks del usuario.
- Salidas: fetches a /api y render de paneles.
- Estado interno: useState para token, usuario, rol, vista, ticket y submit.
- Efectos: fetch de /api/me y calls a endpoints del backend.
- Dependencias: firebase/auth, GoogleAuthPanel, AdminPanel, HistoryPanel, ToastProvider.
- Exporta a: UI completa.

### Módulo: Formulario de creación
- Propósito: cargar áreas y productos, permitir selección y crear tickets.
- Archivos clave: [frontend/src/components/TicketForm.jsx](frontend/src/components/TicketForm.jsx).
- Entradas: token Firebase, áreas y catálogo de productos desde backend.
- Salidas: payload de ticket al backend, cache en sessionStorage.
- Estado interno: useState de área, tipo, fecha, productos, cantidad, firma, destino.
- Efectos: fetch /inventory/areas y /inventory/products, sessionStorage cache.
- Dependencias: React, sessionStorage.
- Exporta a: App.jsx.

### Módulo: Panel admin
- Propósito: aprobar/rechazar tickets, gestionar usuarios y correos.
- Archivos clave: [frontend/src/components/AdminPanel.jsx](frontend/src/components/AdminPanel.jsx).
- Entradas: token Firebase y datos del usuario.
- Salidas: fetches al backend y toasts.
- Estado interno: tabs, modales, formularios y paginación locales.
- Efectos: múltiples llamadas a /api/admin/*.
- Dependencias: useToast, fetch.
- Exporta a: App.jsx.

### Módulo: Historial de usuario
- Propósito: ver y descargar sus tickets.
- Archivos clave: [frontend/src/components/HistoryPanel.jsx](frontend/src/components/HistoryPanel.jsx).
- Entradas: token Firebase.
- Salidas: lista de tickets y blobs PDF/Word.
- Estado interno: useState de tickets, page, expandedId.
- Efectos: fetch /api/my-tickets y /api/tickets/:id/download.
- Dependencias: fetch.
- Exporta a: App.jsx.

---

## 3. Mapa de conexiones

### Relaciones principales
- App.jsx → GoogleAuthPanel: login con Firebase.
- App.jsx → TicketForm: creación de tickets.
- App.jsx → AdminPanel: panel de aprobación si role admin/superadmin.
- App.jsx → HistoryPanel: historial del usuario.
- TicketForm → /api/inventory/areas y /api/inventory/products.
- TicketForm → /api/tickets (POST) y /api/tickets/:id/send-review.
- AdminPanel → /api/admin/tickets, /api/admin/users, /api/admin/email-config.
- HistoryPanel → /api/my-tickets, /api/tickets/:id/download.
- Backend app.js → controllers → services → Firestore/API externa.
- ticketController → audit.service + notification.service + stock.service + document.service.

### Flujo de datos principal
1. Firebase Auth entrega token al frontend.
2. TicketForm arma metadata y body con productos/área/motivo/firma/destino.
3. Backend crea ticket en Firestore y lo marca EN_REVISION.
4. AdminPanel consume /api/admin/tickets y aprueba o rechaza.
5. Aprobación activa stock.service, que llama a la API externa para descontar/reingresar stock.
6. Se registra auditoría y se envía mail.
7. Usuario puede descargar PDF/Word desde history o admin.

### Módulos centrales
- [backend/src/app.js](backend/src/app.js): es el hub HTTP y auth.
- [backend/src/controllers/ticketController.js](backend/src/controllers/ticketController.js): coordina el flujo crítico de negocio.
- [backend/src/services/inventory-api.service.js](backend/src/services/inventory-api.service.js): pieza clave para stock y validaciones.

### Módulos hoja
- [frontend/src/components/HistoryPanel.jsx](frontend/src/components/HistoryPanel.jsx)
- [frontend/src/components/Toast.jsx](frontend/src/components/Toast.jsx)
- [backend/src/services/audit.service.js](backend/src/services/audit.service.js)

### Dependencias circulares
No se detectan dependencias circulares explícitas en el código visible; la arquitectura es acíclica en el sentido de controlador → servicio → API/Firestore.

### Autenticación/sesión
- Frontend usa Firebase Auth (Google sign-in y token local) con persistencia browserLocalPersistence.
- Backend valida el token en requireUser() usando admin.auth().verifyIdToken.
- Si el mail es del superadmin, usa rol fijo; si no, consulta Firestore usuarios y obtiene rol/áreasPermitidas.
- El token de usuario también se reenvía a la API externa de inventario para validar permisos.

---

## 4. Contratos e interfaces

### Modelos principales
- Ticket: { id, type, status, items, assignedUsers, requestedBy, metadata, createdAt, updatedAt }
- User: { id, email, rol, areasPermitidas, nombre, createdAt, updatedAt }
- AuditEntry: { ticketId, action, user, payload, createdAt }
- StockMovement: { ticketId, source, items, approvedBy, createdAt }

### Endpoints expuestos por backend
- GET /api/health — health check.
- GET /api/inventory/products/:id — detalle de producto.
- GET /api/inventory/products — lista de productos por área.
- GET /api/inventory/areas — áreas disponibles.
- GET /api/tickets/:id/download — PDF/Word.
- POST /api/tickets — crear ticket.
- POST /api/tickets/:id/send-review — enviar a revisión.
- POST /api/tickets/:id/review — aprobar/rechazar (ruta del flujo de revisión).
- GET /api/tickets/:id — detalle de ticket.
- GET /api/my-tickets — tickets del usuario actual.
- GET /api/me — datos del usuario autenticado.
- GET /api/admin/tickets — listado de tickets (admin).
- POST /api/admin/tickets/:id/approve — aprobar.
- POST /api/admin/tickets/:id/reject — rechazar.
- GET /api/admin/users — usuarios.
- POST /api/admin/users — crear usuario.
- PATCH /api/admin/users/:uid — actualizar usuario.
- DELETE /api/admin/users/:uid — borrar usuario.
- GET /api/admin/email-config — config de correos.
- PUT /api/admin/email-config — guardar config de correos.

### Tipado estricto
- Backend: casi no usa TypeScript; todo es JS con validaciones manuales y strings literales.
- Frontend: React + JS; no hay TypeScript ni tipado formal.
- Lo más “tipado” está en validaciones manuales de estructura en servicios.

---

## 5. Gestión de estado y datos

- Estado global: no existe Redux/Zustand/Context global de negocio. El estado vive en React local (useState) y en Firebase Auth.
- Context real: [frontend/src/components/Toast.jsx](frontend/src/components/Toast.jsx) usa createContext para toasts.
- Caché local: sessionStorage en TicketForm y StepArea para áreas y productos.
- Persistencia de sesión: browserLocalPersistence en Firebase Auth.
- Base de datos: Firestore (tickets, usuarios, config, ticketAudits, stockMovements).

---

## 6. Puntos de extensión

- Nuevas páginas/vistas: se añaden en App.jsx y se enlazan con hash (#history, #admin/*).
- Nuevos items de navegación: se agregan en App.jsx y/o en AdminPanel.
- Plugins/middlewares/hooks: no hay un sistema de plugins; el patrón actual es Express middleware + servicios.
- Factories o registros: no hay registry central de módulos; se añade un controlador y un servicio nuevo.
- Configuración central: [backend/.env.example](backend/.env.example), [frontend/src/config/firebase.js](frontend/src/config/firebase.js), [frontend/vite.config.js](frontend/vite.config.js).

### Patrón recomendado para una nueva feature
1. Añadir endpoint en [backend/src/app.js](backend/src/app.js).
2. Implementar lógica en un servicio bajo [backend/src/services/](backend/src/services/).
3. Si requiere UI, crear componente en [frontend/src/components/](frontend/src/components/).
4. Conectar la vista desde [frontend/src/App.jsx](frontend/src/App.jsx).

---

## 7. Guía práctica para nuevas features

### Si quiero agregar una nueva página/vista
- Añadir un nuevo caso de navegación en App.jsx.
- Crear componente en frontend/src/components.
- Si necesita backend, añadir endpoint en app.js y servicio correspondiente.

### Si quiero agregar un nuevo endpoint o llamada a API
- Añadir la ruta en app.js.
- Implementar la lógica en un controller y servicio.
- Reutilizar requireUser/requireAdmin para seguridad.

### Si quiero agregar un nuevo componente reutilizable
- Colocarlo en frontend/src/components.
- Mantener el patrón de props explícitas y no introducir store global.
- Reutilizar ToastProvider si se necesita notificación.

### Si hay un bug en la UI
- Empezar por App.jsx y el componente que lo renderiza (TicketForm, AdminPanel, HistoryPanel).
- Revisar fetches y sessionsStorage.

### Si hay un bug en los datos
- Revisar primero ticket.service.js y stock.service.js.
- Confirmar estado real en Firestore y respuesta de la API externa.

---

## 8. Riesgos y deuda técnica relevante

- [backend/src/app.js](backend/src/app.js) contiene rutas inline de usuarios/correos que duplican lógica y usan addAuditEntry sin importar ese helper; es un riesgo real de 500 en admin.
- No hay tests automatizados; cualquier cambio en stock, autorización o mail puede romper producción sin detección.
- El uso de fetch directo a la API externa y el procesamiento en memoria de áreas puede escalar mal.
- Las credenciales Firebase del frontend están con fallback hardcodeado; conviene moverlas a .env y fallar si faltan.
- Hay archivos legacy en frontend/src/components que no se usan; aumentan ruido y confusión.

---

## Conclusión

Este sistema funciona como una API REST de tickets sobre Firestore con un frontend React simple y un flujo de aprobación administrativo. La referencia correcta para extenderlo está en [backend/src/app.js](backend/src/app.js), [backend/src/controllers/](backend/src/controllers/), [backend/src/services/](backend/src/services/), y [frontend/src/components/](frontend/src/components/).
