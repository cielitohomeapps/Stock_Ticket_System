# Ticket Automatization (Backend + Frontend)

Proyecto con separación Backend/Frontend:

1. `backend/`: API Node.js + Express.
2. `frontend/`: UI visual React con Vite.

## Arquitectura

- Backend con Express para exponer endpoints HTTP.
- Firestore para persistencia de tickets/auditoria.
- Integracion de API externa de inventario en backend.
- Notificaciones por correo con Nodemailer.
- Frontend desacoplado consumiendo el backend por HTTP.

## Estructura principal

- `backend/` - Servidor Express con lógica de tickets y stock
- `frontend/` - Aplicación React con Vite

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
