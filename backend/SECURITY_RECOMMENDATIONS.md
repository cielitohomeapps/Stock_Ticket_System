# Recomendaciones de Seguridad Post-Implementación

## Rotación Urgente de Credenciales

Las siguientes credenciales estuvieron expuestas en `.env` y deben ser rotadas INMEDIATAMENTE:

1. **Firebase Private Key** (`FIREBASE_PRIVATE_KEY`)
   - Ir a Firebase Console → Project Settings → Service Accounts
   - Generar una nueva clave privada
   - Reemplazar en el entorno de producción

2. **Firebase API Key** (`INVENTORY_AUTH_API_KEY`)
   - Ir a Firebase Console → Project Settings → General → Web API Key
   - Restringir la API Key por aplicación (App Check) o regenerar

3. **Resend API Key** (`RESEND_API_KEY`)
   - Ir a Resend.com → API Keys
   - Revocar la key actual y generar una nueva

4. **Static Bearer Token** (`INVENTORY_STATIC_BEARER_TOKEN`)
   - Generar un nuevo token en el servicio de inventario

5. **Firebase Test Password** (`FIREBASE_TEST_PASSWORD`)
   - Cambiar la contraseña de la cuenta de prueba en Firebase Authentication

## Buenas Prácticas

- No almacenar secretos en archivos locales que puedan ser compartidos accidentalmente.
- Usar variables de entorno del sistema operativo en lugar de archivos `.env` en producción.
- Considerar Google Secret Manager o AWS Secrets Manager para producción.
- Habilitar Firebase App Check para restringir uso de la API Key.
- Usar Firebase Emulator Suite para desarrollo local.
