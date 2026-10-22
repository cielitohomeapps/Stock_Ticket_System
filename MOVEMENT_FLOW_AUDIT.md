# Auditoría de flujos de tickets y movimientos de inventario

**Fecha de revisión:** 2026-10-22
**Alcance:** creación y envío de tickets, revisión administrativa, movimientos externos de inventario, notificaciones y manejo de errores visibles. La auditoría se basa en el código de este repositorio; no se ejecutaron pruebas contra producción, el proveedor real ni un emulador de Firestore.

## Resumen ejecutivo

Se identificaron y mitigaron riesgos de autorización al enviar borradores a revisión, de cambios concurrentes durante la validación de stock, de envíos duplicados y de decisiones administrativas mientras el resultado externo era incierto. Los usuarios reciben errores con códigos y mensajes específicos; los fallos de conectividad al inventario se distinguen de errores de captura.

No existe una transacción distribuida entre Firestore y la API de inventario. Por eso el sistema no puede garantizar ejecución exactamente una vez ante una respuesta perdida del proveedor. Ahora marca el resultado como `UNKNOWN`, bloquea nuevas acciones de stock y exige que un administrador verifique el inventario y registre la decisión. La seguridad de este procedimiento depende de que el administrador consulte una fuente externa confiable.

## Mapa de flujos revisados

### Envío completo

1. `TicketForm` valida los datos de captura y prepara el ticket.
2. `POST /api/tickets/submit` valida la clave de idempotencia, normaliza campos y verifica disponibilidad de stock mediante lecturas al servicio externo.
3. Tras resolver la ubicación, una transacción Firestore crea el ticket `EN_REVISION` y el documento asociado de `ticketSubmissionKeys`.
4. El backend vuelve a leer el ticket para verificar su persistencia y registra el evento de auditoría.
5. La interfaz muestra el resultado; errores exponen código y `requestId` cuando están disponibles.

El borrador existente mantiene el flujo separado `PUT /api/tickets/:id/submit`.

### Revisión y movimiento

1. El administrador aprueba un ticket `EN_REVISION`.
2. Firestore adquiere un lock por ticket en una transacción.
3. El backend consulta y modifica el inventario mediante llamadas externas secuenciales. Si un artículo falla tras otros ya aplicados, intenta compensarlos.
4. Firestore registra el movimiento y el estado final en otra transacción.
5. La notificación por correo se intenta después y su fallo se registra sin revertir el movimiento.

La ruta de administración verifica estado y permisos; rechazar o devolver no es posible mientras hay procesamiento activo o resultado incierto.

### Resultado externo incierto

Un timeout o una interrupción entre la API externa y la persistencia local puede dejar indeterminado el resultado. En ese caso el ticket conserva `stockSyncStatus: "UNKNOWN"`, la UI bloquea las acciones incompatibles y ofrece al administrador una conciliación con decisión `APPLIED`/`NOT_APPLIED`, resumen del ticket y motivo obligatorio. La decisión y su entrada de auditoría se escriben en la misma transacción Firestore.

## Matriz de estados relevantes

| Estado del ticket | Condición relevante | Acción permitida / transición |
|---|---|---|
| `CREADO` | Borrador | El propietario puede editarlo y enviarlo por el flujo de borrador. |
| `EN_REVISION` | Sin lock ni resultado incierto | Admin puede aprobar, rechazar o devolver. |
| `EN_REVISION` | `stockProcessing: true` | Se bloquean rechazo/devolución y otro procesamiento; un lock vigente responde conflicto. |
| `EN_REVISION` | `stockSyncStatus: "UNKNOWN"` | Se bloquean aprobación, rechazo y devolución; solo conciliación administrativa. |
| `STOCK_ACTUALIZADO` | Movimiento confirmado o conciliado como aplicado | No se repite aprobación; se puede intentar/registrar notificación según el flujo existente. |
| `NOTIFICADO` | Correo registrado como enviado | Estado terminal del flujo normal. |
| `RECHAZADO` | Decisión administrativa | Estado terminal del flujo normal. |
| `PENDIENTE_CORRECCION` | Devuelto al creador | Se conserva el flujo de corrección existente. |

La conciliación `APPLIED` lleva el ticket a `STOCK_ACTUALIZADO`, crea un movimiento con fuente `manual-reconciliation` y no manda correo automáticamente. `NOT_APPLIED` limpia el estado incierto y deja el ticket en `EN_REVISION` para una decisión posterior.

## Hallazgos y mitigaciones

| Prioridad | Hallazgo y efecto | Mitigación aplicada | Residual |
|---|---|---|---|
| Alta | Una respuesta perdida o un timeout del proveedor puede ocurrir después de aplicar un movimiento. Repetir el POST podría descontar/agregar stock dos veces. | Los reintentos automáticos transitorios se limitan a GET; el resultado indeterminado bloquea acciones y requiere conciliación auditable por administrador. | El proveedor no ofrece aquí una clave idempotente ni una consulta de estado verificable. No se puede garantizar exactamente una vez; la decisión operativa debe basarse en el historial del inventario. |
| Alta | Dos envíos del mismo formulario pueden crear tickets duplicados si el cliente repite la solicitud tras perder la respuesta. | `Idempotency-Key` se hashea con la identidad del usuario; el fingerprint normalizado y la creación del ticket/clave se coordinan en Firestore. El frontend conserva la clave en `sessionStorage` entre recargas. | Clientes externos deben enviar una clave válida. La conciliación de un key reutilizado con payload distinto requiere revisar Mis Tickets y confirmar explícitamente que se inicie un nuevo envío. No se probó Firestore real bajo concurrencia. |
| Alta | La ruta de envío a revisión podía actuar sobre tickets ajenos o sobre datos que cambiaron mientras se consultaba el stock externo. | Se valida la propiedad del borrador y se compara el contenido antes de completar la transición transaccional. | La disponibilidad externa puede cambiar después de validar y antes de ejecutar el movimiento final. |
| Media | Revisar o cambiar la decisión del ticket mientras la API externa procesa stock podría dejar estados incompatibles. | Lock transaccional, comprobaciones de estado en finalización y bloqueo de rechazo/devolución mientras procesa o requiere conciliación. | La transacción Firestore no incluye las escrituras externas; los cambios simultáneos entre tickets distintos aún dependen de las garantías del proveedor. |
| Media | Una notificación por correo puede fallar después de aplicar el stock, lo que no debe aparentar que el movimiento falló. | El backend registra el error de notificación y devuelve el estado de stock aplicado con una advertencia; la UI informa que la conciliación manual no envía correo. | El envío de correo es un efecto separado y no se valida en este repositorio contra Resend. El reintento/recuperación operativa de notificaciones requiere revisar el estado del ticket. |
| Media | Errores de captura y dependencia inactiva no explicaban claramente qué corregir. | Alertas visibles para campos y cantidades, stock insuficiente y disponibilidad del sistema de inventario; se conservan `status`, `code` y `requestId` en el cliente. Errores 5xx ocultan detalles internos en producción. | Los textos de errores del proveedor pueden cambiar; los mapeos del cliente cubren los códigos conocidos, no todas las respuestas externas. |

## Límites de atomicidad

| Operación | Protección local | Límite |
|---|---|---|
| Crear ticket y asociar clave de idempotencia | Una transacción Firestore crea ambos documentos. | Lecturas previas de stock y resolución de ubicación son externas/separadas y se pueden repetir con una clave aún no persistida. |
| Aplicar movimiento por ticket | Lock y finalización del ticket/movimiento usan transacciones Firestore; hay compensación secuencial ante fallos parciales. | La llamada a la API externa no participa en la transacción Firestore. Timeout, caída del proceso o fallo de compensación pueden dejar resultado incierto. |
| Conciliar resultado incierto | Ticket, movimiento manual cuando aplica y evento `ticketAudits` se escriben juntos en una transacción. | El backend no verifica automáticamente el historial del proveedor; la verdad externa la confirma el administrador. |
| Enviar notificación | El resultado de correo actualiza el estado/registro por separado y los fallos se hacen visibles. | No existe transacción distribuida con Resend ni una validación de entrega real en estas pruebas. |

## UX y manejo de errores

- Los errores del formulario se presentan como alertas accesibles, con explicación y reintento cuando la operación es segura.
- El fallo de la API de inventario indica explícitamente revisar que ese sistema esté activo.
- El stock insuficiente solicita reducir la cantidad o revisar existencias.
- Cantidades deben ser enteros positivos; el valor temporal vacío durante la edición no se sustituye por un valor implícito.
- Un resultado externo incierto se muestra como una alerta operativa para administradores y no se trata como un simple reintento.
- Los errores administrativos conservan el código y `requestId`; el servidor registra contexto sin incluir tokens o contenido libre sensible.

## Pruebas y evidencia

Los tests unitarios cubren normalización y validación de tickets, control de acceso puro, decisiones de conciliación, creación de fingerprint/ID de idempotencia y utilidades de observabilidad. En la validación final ejecutada para esta revisión:

- `npm test --prefix backend`: 16/16 pruebas pasaron.
- `npm run check --prefix backend`: pasó.
- `npm run build --prefix frontend`: pasó; Vite advierte que el bundle JavaScript minificado supera 500 kB.
- `git diff --check`: pasó; Git mostró advertencias de conversión LF/CRLF existentes en varios archivos editados.

No se considera probado:

- Concurrencia transaccional usando Firestore Emulator o una base aislada.
- Fallos y compensaciones contra una API de inventario de pruebas.
- Atomicidad del proveedor entre tickets distintos.
- Entrega de correos reales.
- Despliegue coordinado o rollback en producción.

## Despliegue y reversión

1. Confirmar que todos los clientes que llaman directamente a `POST /api/tickets/submit` agreguen `Idempotency-Key` (8–128 caracteres); los clientes antiguos sin el header recibirán `400`.
2. Desplegar backend y frontend como una versión coordinada. Publicar backend primero sin actualizar los clientes dejará a esos clientes sin poder crear tickets completos.
3. Desplegar los índices declarados para la base Firestore de tickets si aún no se han creado, y validar rutas en un ambiente de pruebas.
4. Confirmar el flujo normal, la alerta de inventario no disponible y el procedimiento administrativo con un entorno de integración controlado.
5. Ante rollback, coordinar también los clientes: una versión vieja puede ignorar el header, pero no tendrá protección de idempotencia. No borrar `ticketSubmissionKeys`, `stockMovements` ni los registros de auditoría.

## Riesgos y decisiones pendientes

- La API externa debería ofrecer idempotencia para mutaciones o un endpoint fiable de consulta del resultado, reduciendo la dependencia de conciliación manual.
- Hace falta una prueba de integración con Firestore Emulator que demuestre que dos solicitudes concurrentes con la misma clave crean un único ticket y que una clave con otro payload recibe conflicto.
- Hace falta un contrato probado del proveedor para asegurar que las validaciones de stock y las modificaciones son atómicas frente a otros tickets.
- La colección de claves idempotentes no tiene política de expiración; definir retención/eliminación requiere una decisión operativa que preserve la ventana necesaria para reintentos.
- Los consumidores externos del endpoint deben actualizarse y verificarse antes del despliegue.
