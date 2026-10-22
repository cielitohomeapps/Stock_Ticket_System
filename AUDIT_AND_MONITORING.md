# Auditoría integral y monitoreo

Fecha de revisión: 22 de octubre de 2026.

## Alcance y evidencia

Se revisaron la arquitectura, el historial reciente de Git, el flujo frontend/backend, las consultas Firestore, la integración de inventario, el correo, la autorización, los logs, las dependencias y la capacidad de pruebas. También se compiló el frontend y se ejecutaron pruebas y chequeos locales.

La revisión del código confirma las causas descritas abajo. No se consultaron datos ni logs de producción porque el repositorio no proporciona acceso autorizado a esos entornos; por eso no se afirma cuántos tickets históricos resultaron afectados ni desde qué fecha. El endpoint de integridad permite medirlo sin modificar documentos.

## Causas raíz confirmadas

### Tickets incompletos o aparentemente no enviados

1. El formulario principal solo creaba un documento `CREADO`, aunque el resultado presentado al usuario sugería que estaba pendiente de revisión. El envío real era otra operación. Una interrupción entre ambas acciones dejaba un borrador parcial o “silencioso”.
2. El backend validaba principalmente tipo e ítems, pero no exigía `area`, `motivo`, `firma`, `destino` y `fecha`, aunque la interfaz los trataba como obligatorios. También persistía el cuerpo casi sin normalizar.
3. Al editar un borrador, la carga del área disparaba un efecto que limpiaba los productos ya seleccionados. Esto podía convertir una edición válida en una actualización incompleta.
4. La aprobación administrativa aceptaba `CREADO` y podía saltarse el paso explícito de revisión.
5. Un ticket podía terminar como `NOTIFICADO` aun sin destinatarios configurados, y el cliente no distinguía correctamente un fallo de correo.

### Tickets omitidos de listados

La consulta administrativa aplicaba un límite en Firestore antes de ordenar y filtrar en memoria. Por tanto, un ticket válido podía existir y no aparecer. La paginación ahora se realiza en el servidor, ordenada por `createdAt`, y devuelve `hasNext`.

### Fallos difíciles de detectar

1. El tablero de monitoreo importaba componentes inexistentes y no podía compilar.
2. El navegador intentaba autenticar WebSocket mediante un header `Authorization`, algo que la API WebSocket del navegador no permite configurar de esa forma. El canal queda deshabilitado por defecto; el tablero usa REST Firebase autenticado.
3. Se registraban o guardaban respuestas completas del proveedor de inventario, con volumen y posible información sensible innecesarios.
4. La configuración de inventario descartaba una URL configurada en `localhost` y usaba silenciosamente el fallback de producción.
5. Un `403` cualquiera hacía que el frontend tratara la sesión como perdida, incluso cuando solo faltaban permisos para una acción concreta.
6. La lectura y descarga de tickets no comprobaba que el solicitante fuera el propietario o administrador.

## Cambios implementados

### Contrato y persistencia de tickets

- Contrato único y estricto en `ticket-integrity.service.js`.
- Tipo limitado a `ENTRY` o `EXIT`.
- De 1 a 100 ítems por defecto, sin duplicados, con identificador y cantidad entera positiva.
- Metadatos obligatorios y longitud acotada.
- Fecha real en formato `YYYY-MM-DD`.
- Usuarios asignados normalizados y sin duplicados.
- El envío nuevo valida inventario antes de persistir y crea una sola versión final `EN_REVISION`.
- La actualización y envío de un borrador se hace en una transacción Firestore.
- Después de escribir, el backend relee el documento y verifica su integridad. Si la escritura existió pero la verificación posterior falló, la respuesta incluye `ticketId` para evitar reintentos ciegos y duplicados.
- La auditoría es de mejor esfuerzo: un fallo en el registro de auditoría genera alerta, pero no convierte una escritura de ticket ya exitosa en un error de cara al usuario.

### Estado, aprobación y notificación

- Solo `EN_REVISION` puede aprobarse o rechazarse.
- Se mantiene el bloqueo transaccional para impedir movimientos de stock concurrentes.
- Los datos completos del proveedor no se persisten; solo resultado, estado y referencia mínima.
- Sin destinatarios o con error de correo no se marca `NOTIFICADO`; se conserva el estado de stock y se devuelve respuesta parcial (`207`) con diagnóstico seguro.
- Los campos interpolados en HTML de correo se escapan para impedir inyección de marcado.

### Autorización y exposición

- Lectura y descarga: solo propietario o administrador.
- Métricas, logs, alertas, integridad y salud detallada: solo administradores.
- `SUPERADMIN_EMAIL` ya no tiene un valor privilegiado incorporado en el código o plantilla.
- Swagger se deshabilita por defecto en producción.
- CORS usa lista permitida y el cuerpo JSON tiene límite configurable.
- Los `403` de autorización ya no cierran una sesión válida; solo `USER_NOT_REGISTERED` mantiene ese comportamiento.

### Observabilidad

Cada solicitud `/api` recibe `x-request-id` y `x-correlation-id`. Los eventos estructurados contienen, cuando aplica:

- `timestamp`, `level`, `service`, `environment`;
- `eventType`, `module`, `message`;
- `requestId`, `correlationId`, `ticketId`, `userId`;
- método, ruta, código HTTP y duración;
- tipo de error y metadatos seguros.

La sanitización recursiva elimina headers de autorización, cookies, contraseñas, claves, tokens, llaves privadas, datos de tarjetas y contenido libre; los emails se enmascaran. No se escriben cuerpos completos de inventario ni respuestas completas de proveedores.

Los filtros del panel cubren nivel, módulo, tipo de evento, request/correlation/ticket, texto y rango de fechas, con paginación. La vista incluye volumen, solicitudes por segundo, errores, tasa de error reciente, latencias promedio/P95/P99, usuarios activos y endpoints con más fallos.

### Integridad retroactiva

El monitor inspecciona hasta 500 documentos por ejecución y detecta:

- campos obligatorios, estado o `createdAt` ausentes;
- tickets enviados que permanecen `CREADO`;
- `EN_REVISION` sin fecha de envío o por encima del umbral;
- `NOTIFICADO` junto con error de notificación;
- bloqueo de stock sin marca temporal o vencido.

El escaneo es de solo lectura. No corrige datos históricos automáticamente porque una reparación segura requiere reglas de negocio y aprobación específicas para cada caso.

## Alertas y umbrales

Las alertas quedan disponibles en el tablero y se emiten como JSON a `stdout`:

- cualquier HTTP `5xx`;
- latencia individual mayor o igual a `ALERT_LATENCY_MS` (2 s por defecto);
- tres fallos de envío de ticket en cinco minutos por defecto;
- veinte respuestas `4xx` en cinco minutos por defecto;
- ticket inconsistente detectado por el escaneo;
- fallo del escaneo de integridad;
- fallo de rollback de stock, con severidad fatal;
- base de datos no disponible en la comprobación de salud.

Se deduplican durante `ALERT_DEDUP_WINDOW_MS` (cinco minutos por defecto) para evitar tormentas. Todos los valores están en `backend/.env.example`.

## Salud y estados

- `NORMAL`: proceso y base disponibles, error/latencia por debajo de advertencia.
- `DEGRADADO`: tasa de error o latencia supera el umbral de advertencia.
- `INCIDENTE`: base no disponible o métrica supera el umbral crítico.

La ruta pública de readiness devuelve solo un resultado operativo seguro. Los detalles de dependencia, proceso y flujo están protegidos para administradores.

## Pruebas incorporadas

Las pruebas unitarias cubren:

- normalización y rechazo de metadatos faltantes;
- cantidades no enteras o inválidas;
- detección de tickets enviados incompletos;
- autorización propietario/administrador;
- redacción de secretos y emails;
- filtrado y paginación de eventos;
- deduplicación de alertas;
- escape de contenido no confiable en email.

Comandos:

```powershell
npm test
npm run check
```

## Índices y operación

`firestore.indexes.json` declara índices para propietario/fecha, estado/fecha, área/fecha y estado/área/fecha. Hay que desplegarlos explícitamente al proyecto de tickets antes de depender de esas combinaciones en producción.

Los logs y alertas mostrados por la UI son una ventana circular en memoria: se pierden al reiniciar y cada réplica ve solo su propio proceso. El registro JSON en `stdout` es la fuente preparada para retención. En producción debe conectarse a un agregador con almacenamiento, búsqueda y destino de guardia. No se configuró un proveedor externo sin credenciales ni autorización para crear esa integración.

## Dependencias y riesgo residual

- Se retiró `nodemailer`, que no se usaba; Resend es el único transporte activo.
- Express y Firebase Admin se actualizaron dentro de versiones compatibles con la API actual.
- Vite y su plugin de React se actualizaron a la línea que exige Node 22.12 o posterior.
- El frontend dejó de depender del paquete agregado `firebase`: usa directamente `@firebase/app` y `@firebase/auth`, los únicos módulos requeridos. Así se retiró del árbol cliente Firestore y sus avisos transitivos de `@grpc/grpc-js`.
- Firebase Admin conserva avisos moderados transitivos de `uuid`. Migrar a la siguiente línea mayor requiere adaptar la API namespaced y verificar el runtime soportado antes de desplegar.

Estos avisos no deben confundirse con el defecto funcional corregido. Se documentan para que el despliegue tenga una decisión explícita y pruebas de integración, en lugar de aceptar automáticamente cambios mayores de npm.

## Validación pendiente en producción

Antes de desplegar:

1. Ejecutar el escaneo de integridad en el proyecto correcto y exportar la lista afectada.
2. Desplegar índices al proyecto Firestore de tickets.
3. Probar un ticket `ENTRY` y uno `EXIT` con una cuenta normal y una administrativa.
4. Verificar que el proveedor de inventario aplique exactamente un movimiento ante reintentos.
5. Probar destinatarios reales de Resend y la respuesta `207` ante fallo controlado.
6. Enviar el JSON de `stdout` al agregador de producción y configurar el canal de guardia.
7. Observar error rate, P95, `5xx`, tickets estancados y fallos de inventario durante el despliegue gradual.
