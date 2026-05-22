# Ticket Automatization (Backend + Frontend)

Proyecto con separación Backend/Frontend:

1. `backend/`: API Node.js + Express.
2. `frontend/`: UI visual React con Vite.

## Arquitectura

- **Backend con Express** para exponer endpoints HTTP.
- **Firestore** para persistencia de tickets/auditoria.
- **Integracion de API externa de inventario** en backend.
- **Notificaciones por correo** con Nodemailer y Resend.
- **Frontend desacoplado** consumiendo el backend por HTTP.
- **Autenticación** mediante Firebase Auth.

### Arquitectura General

El proyecto sigue una arquitectura cliente-servidor con separación clara entre frontend y backend:

- **Frontend (React + Vite)**: Interfaz de usuario para creación de tickets, administración y historial.
- **Backend (Node.js + Express)**: API REST que maneja la lógica de negocio, integración con servicios externos y persistencia.
- **Base de Datos**: Firestore (NoSQL) para tickets, usuarios y auditoría.
- **Servicios Externos**: API de inventario, servicios de email (Nodemailer, Resend).

### Componentes Principales

#### Backend

- **Servidor (server.js)**: Punto de entrada que inicia el servidor Express.
- **Aplicación (app.js)**: Configuración de Express, middlewares de autenticación, rutas API.
- **Configuración (config/firebase.js)**: Inicialización de Firebase Admin SDK y Firestore.
- **Servicios**:
  - `ticket.service.js`: Gestión de tickets (crear, aprobar, rechazar, listar).
  - `stock.service.js`: Movimientos de stock relacionados con tickets.
  - `inventory-api.service.js`: Integración con API externa de inventario.
  - `notification.service.js`: Envío de notificaciones por email.
  - `email.templates.js`: Plantillas de email.
  - `audit.service.js`: Registro de auditoría.
  - `document.service.js`: Generación de PDFs y documentos Word.
  - `user.service.js`: Gestión de usuarios y configuración de email.

#### Frontend

- **App.jsx**: Componente principal que maneja autenticación, navegación y estado global.
- **Componentes**:
  - `GoogleAuthPanel.jsx`: Panel de autenticación con Google.
  - `TicketForm.jsx`: Formulario para crear tickets.
  - `StepResult.jsx`: Resultado del proceso de ticket.
  - `AdminPanel.jsx`: Panel de administración para usuarios y tickets.
  - `HistoryPanel.jsx`: Historial de tickets del usuario.
  - `Toast.jsx`: Notificaciones en la UI.
  - Otros componentes auxiliares para pasos y elementos.

### Flujo de Trabajo

1. **Autenticación**: Usuario se autentica via Firebase Auth.
2. **Creación de Ticket**: Usuario selecciona productos, tipo de ticket (entrada/salida), motivo.
3. **Envío a Revisión**: Ticket pasa a estado EN_REVISION.
4. **Aprobación/Rechazo**: Administrador aprueba o rechaza el ticket.
5. **Movimiento de Stock**: Si aprobado, se actualiza stock via API externa.
6. **Notificación**: Se envía email a usuarios asignados.

### Tecnologías Utilizadas

- **Backend**: Node.js, Express, Firebase Admin SDK, Firestore, Nodemailer, Resend, PDFKit, Docx.
- **Frontend**: React, Vite, Firebase Auth.
- **Base de Datos**: Firestore.
- **Desarrollo**: Concurrently para ejecutar ambos servicios.

## Estructura principal

- `backend/` - Servidor Express con lógica de tickets y stock
- `frontend/` - Aplicación React con Vite
- `functions/` - (Reservado para futuras funciones de Firebase)

## Requisitos

- Node.js 20+

## Configuracion backend

1. Copia `backend/.env.example` a `backend/.env`.
2. Completa tus variables:
   - `PORT` (default `3001`)
   - `APPROVER_ROLES`
   - `INVENTORY_API_BASE_URL`
   - `INVENTORY_AUTH_API_KEY`
   - `SMTP_*` y `MAIL_FROM` (si deseas notificaciones por correo)
3. Opcional: agrega `backend/service-account.json` para inicializar Firebase Admin con credenciales explicitas.

## Ejecutar en local

### Proyecto completo (recomendado)

```bash
npm install
npm run install:all
npm run dev
```

Esto levanta backend y frontend al mismo tiempo desde la raiz del proyecto.

- Frontend (Vite): `http://127.0.0.1:5173`
- Backend (Express): `http://localhost:3001`

## Mejoras Sugeridas

- **TypeScript**: Migrar a TypeScript para mejor type safety en backend y frontend.
- **Pruebas**: Agregar tests unitarios e integración (Jest, React Testing Library).
- **Documentación API**: Implementar Swagger/OpenAPI para documentación de endpoints.
- **Seguridad**: Validación de inputs, rate limiting, sanitización.
- **Logging**: Mejorar logging con Winston o similar.
- **Error Handling**: Manejo de errores más robusto y consistente.
- **CI/CD**: Pipeline de despliegue automatizado.
- **Monitoreo**: Integración con herramientas de monitoreo (Sentry, etc.).
- **Base de Datos**: Considerar migración a PostgreSQL si se requiere SQL.
- **Frontend**: Mejorar estado global con Redux o Context API más estructurado.
- **Backend**: Separar controladores de servicios para mejor organización.

### 1) Backend

```bash
cd backend
npm install
npm run dev
```

Backend local: `http://localhost:3001`

### 2) Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend local: `http://127.0.0.1:5173` (Vite)

La UI apunta por defecto a `/api` y Vite hace proxy a `http://localhost:3001`.

## Despliegue en Producción (Render)

1. Sube el repositorio a GitHub.
2. En Render, crea un nuevo "Web Service" conectando tu repo.
3. Configura:
   - **Build Command**: `npm run build`
   - **Start Command**: `npm start`
4. Agrega las variables de entorno en Render (basado en `backend/.env.example`):
   - `PORT` (Render lo setea automáticamente)
   - `APPROVER_ROLES`
   - `INVENTORY_API_BASE_URL`
   - `INVENTORY_AUTH_API_KEY`
   - `INVENTORY_STATIC_BEARER_TOKEN`
   - `FIREBASE_PROJECT_ID`
   - `FIREBASE_CLIENT_EMAIL`
   - `FIREBASE_PRIVATE_KEY`
   - `RESEND_API_KEY`
   - `MAIL_FROM`
5. Despliega. El backend servirá tanto la API como los archivos estáticos del frontend.

**Componentes React:**
- `AuthPanel`: Contexto usuario/rol/token/URL API
- `CreateTicketPanel`: Formulario crear tickets
- `TicketActionsPanel`: Botones enviar/aprobar/rechazar/consultar
- `OutputPanel`: Respuesta en tiempo real del backend

## Endpoints backend

Base URL local: `http://localhost:3001/api`

- `GET /health`
- `GET /inventory/products/:id`
- `POST /tickets`
- `POST /tickets/:id/send-review`
- `POST /tickets/:id/review`
- `GET /tickets/:id`

### Headers requeridos

- `x-user-id`
- `x-user-role`
- `Authorization: Bearer <token>` (opcional, segun tu flujo)

## Flujo de negocio

1. Crear ticket de entrada/salida.
2. Enviar a revision.
3. Aprobar o rechazar.
4. Si aprueba: actualizar stock en API de inventario externa.
5. Intentar notificacion por correo.

## Estados de ticket

- `CREADO`
- `EN_REVISION`
- `RECHAZADO`
- `STOCK_ACTUALIZADO`
- `NOTIFICADO`
