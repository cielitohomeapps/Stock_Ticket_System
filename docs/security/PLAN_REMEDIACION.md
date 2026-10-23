# Plan de remediación de seguridad

Fecha: 2026-10-23

Las correcciones de código de la auditoría ya están implementadas. Este plan reúne trabajo operativo o arquitectónico que no puede cerrarse únicamente desde el repositorio.

## Prioridad 0 — inmediata

### REM-001 — Verificar y completar la rotación de secretos

- Relación: SEC-013.
- Responsable sugerido: Seguridad/Plataforma, con propietarios de Firebase, inventario y Resend.
- Dependencias: acceso administrativo a los proveedores y al entorno de despliegue.
- Tareas:
  1. Confirmar la fecha y el identificador —nunca el valor— de la última rotación de las dos cuentas Firebase, API key/token de inventario, Resend y cuenta de prueba.
  2. Revocar credenciales anteriores.
  3. Mover valores a un gestor de secretos y retirar archivos de los paquetes de despliegue.
  4. Revisar logs de uso anómalo desde la fecha de exposición documentada.
- Criterios de aceptación:
  - Todas las credenciales tienen evidencia de rotación posterior a la exposición.
  - Las credenciales antiguas fallan al autenticarse.
  - CI/CD inyecta secretos sin imprimirlos y no los incluye en artefactos.

## Prioridad 1 — siguiente iteración

### REM-002 — Rate limiting distribuido y protección en el borde

- Relación: SEC-005.
- Responsable sugerido: Backend/Plataforma.
- Dependencias: Redis, API gateway, load balancer o servicio equivalente.
- Tareas: trasladar contadores por UID/IP a un almacén compartido, definir cuotas por endpoint, métricas y alertas de 429.
- Criterios de aceptación:
  - El límite se conserva al alternar entre dos réplicas.
  - Reiniciar una réplica no restablece la cuota global.
  - Pruebas automatizadas confirman `Retry-After`, ventanas y exclusión de health checks.

### REM-003 — Pruebas de integración con emuladores y doble de inventario

- Relación: SEC-001, SEC-002, SEC-003, SEC-005, SEC-010.
- Responsable sugerido: QA/Backend.
- Dependencias: Firebase Emulator Suite, servidor HTTP de inventario simulado y credenciales de prueba sin privilegios reales.
- Tareas: probar rutas Express completas con tokens de usuario/admin, IDOR, áreas ajenas, 401/403 del inventario, revocación de rol, concurrencia y handshake WebSocket.
- Criterios de aceptación:
  - Usuario A no consulta ni modifica ticket/área de B.
  - Un 401/403 de inventario en endpoints de usuario no provoca una segunda llamada de servicio.
  - Admin no modifica cuentas privilegiadas; superadmin sí bajo política.
  - Payload WebSocket mayor a 64 KiB se cierra sin degradar el proceso.
  - Ninguna prueba usa producción.

### REM-004 — Definir separación de funciones y autoaprobación

- Relación: riesgo residual de lógica de negocio.
- Responsable sugerido: Dueño de producto/Seguridad/Backend.
- Dependencias: decisión formal del proceso de inventario.
- Tareas: decidir si el solicitante puede aprobar su propio ticket y, si no, imponer `requestedBy !== approverId` en la transacción de stock.
- Criterios de aceptación:
  - Regla aprobada y documentada.
  - Prueba negativa de autoaprobación si se exige doble control.
  - No existe bypass por la ruta alternativa `/review` o `/admin/.../approve`.

### REM-005 — Validar controles de infraestructura

- Relación: límites de la auditoría.
- Responsable sugerido: Seguridad cloud/Plataforma.
- Dependencias: acceso a Firebase, hosting, DNS y proveedor de logs.
- Tareas: revisar IAM de cuentas de servicio, reglas Firestore desplegadas, HTTPS/TLS, CORS de producción, backups, acceso a logs y separación entre proyectos.
- Criterios de aceptación:
  - Principio de mínimo privilegio documentado para cada identidad.
  - Firestore deniega acceso directo no previsto desde clientes.
  - Solo HTTPS sirve producción y HSTS se observa en respuesta real.
  - `CORS_ORIGINS` contiene únicamente orígenes aprobados.

## Prioridad 2 — corto plazo

### REM-006 — Restringir destinatarios de notificaciones

- Relación: SEC-009.
- Responsable sugerido: Backend/Producto.
- Dependencias: política de dominios o directorio corporativo.
- Tareas: validar `assignedUsers` contra usuarios registrados o dominios aprobados y distinguir destinatarios configurados de destinatarios solicitados.
- Criterios de aceptación:
  - Un correo sintácticamente válido pero no autorizado se rechaza.
  - Existe prueba positiva para un usuario registrado y negativa para dominio externo.

### REM-007 — Retención y TTL de datos operativos

- Relación: privacidad y agotamiento de almacenamiento.
- Responsable sugerido: Datos/Plataforma/Legal.
- Dependencias: requisitos legales y soporte de TTL de Firestore.
- Tareas: definir retención de `ticketSubmissionKeys`, auditorías, movimientos, errores y logs; desplegar TTL donde aplique.
- Criterios de aceptación:
  - Matriz de retención aprobada.
  - Documentos vencidos se eliminan automáticamente en un entorno de prueba.
  - Auditorías obligatorias conservan integridad y acceso restringido.

### REM-008 — Escalar reportes sin lecturas completas

- Relación: riesgo residual de disponibilidad.
- Responsable sugerido: Backend/Datos.
- Dependencias: índices, agregaciones o materialización.
- Tareas: paginar analytics, limitar rangos de fechas y/o mantener agregados incrementales.
- Criterios de aceptación:
  - Ningún request lee toda la colección sin límite.
  - Prueba de carga con volumen representativo cumple presupuesto de memoria/latencia.
  - Totales coinciden con una muestra validada.

### REM-009 — CSP completa y matriz de orígenes

- Relación: SEC-012.
- Responsable sugerido: Frontend/Seguridad.
- Dependencias: inventario de Firebase Auth, API, imágenes y hosting.
- Tareas: desplegar primero `Content-Security-Policy-Report-Only`, corregir violaciones y activar `default-src`, `script-src`, `style-src`, `img-src` y `connect-src` restrictivos.
- Criterios de aceptación:
  - Login Firebase, API y descarga funcionan bajo CSP aplicada.
  - No se requieren `unsafe-eval`; cualquier `unsafe-inline` queda justificado o eliminado.

### REM-010 — Revalidación de WebSocket y límites de mensajes

- Relación: SEC-010.
- Responsable sugerido: Backend.
- Dependencias: mecanismo de consulta de rol eficiente.
- Tareas: revalidar rol/revocación periódicamente, limitar frecuencia de mensajes y agregar heartbeat.
- Criterios de aceptación:
  - Una cuenta degradada pierde el stream en un intervalo acordado inferior a la vida del token.
  - El servidor cierra clientes inactivos o abusivos y libera sus sesiones.

## Prioridad 3 — mantenimiento

### REM-011 — Alinear roles documentados y configuración

- Relación: corrección/configuración.
- Responsable sugerido: Producto/Backend.
- Dependencias: matriz de roles aprobada.
- Tareas: decidir el propósito de `APPROVER_ROLES`, eliminarlo si no se usa o implementarlo con autorización por área para `jefe_area`.
- Criterios de aceptación:
  - README, `.env.example`, frontend y middleware comparten los mismos roles.
  - Una prueba por rol demuestra permisos positivos y negativos.

### REM-012 — Integrar análisis continuo

- Relación: prevención de regresiones.
- Responsable sugerido: DevSecOps.
- Dependencias: pipeline CI.
- Tareas: ejecutar `npm test`, `npm run check`, `npm audit` y escaneo de secretos en cada cambio; bloquear severidades acordadas.
- Criterios de aceptación:
  - El pipeline falla ante una regresión de las pruebas de seguridad.
  - El pipeline no imprime secretos ni sube archivos `.env`/cuentas de servicio.
  - Existe proceso de excepción con caducidad y responsable funcional.
