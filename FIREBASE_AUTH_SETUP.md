# 🔧 Firebase Authentication - Solución de Errores

## Problema 1: Anonymous Sign-In
**Error**: `auth/admin-restricted-operation`  
**Causa**: La autenticación anónima no está habilitada en tu proyecto Firebase

### ✅ Solución: Habilitar Anonymous Auth en Firebase Console

1. Ve a: https://console.firebase.google.com/project/cielito-home-storage/authentication/providers
2. Busca el proveedor "Anonymous"
3. Si no aparece, haz clic en "Add Provider" y selecciona "Anonymous"
4. Presiona el toggle para **habilitarlo**
5. Guarda cambios
6. Recarga la app en el navegador (Ctrl+R o F5)

**Resultado esperado**: El botón "Continuar sin cuenta" debería funcionar

---

## Problema 2: Email/Password Sign-In
**Error**: `auth/invalid-credential`  
**Causa**: La cuenta de prueba no existe o no está habilitada la autenticación por email/contraseña

### ✅ Solución 1: Habilitar Email/Password en Firebase Console

1. Ve a: https://console.firebase.google.com/project/cielito-home-storage/authentication/providers
2. Busca "Email/Password"
3. Si no aparece, haz clic en "Add Provider" y selecciona "Email/Password"
4. En las opciones, asegúrate de marcar:
   - [x] Email/Password
   - [] Email link (opcional)
5. Guarda cambios
6. Recarga el navegador

### ✅ Solución 2: Crear Usuario de Prueba (Recomendado)

1. Ve a: https://console.firebase.google.com/project/cielito-home-storage/authentication/users
2. Haz clic en "Add User" (botón en la esquina superior derecha)
3. Ingresa:
   - **Email**: test@example.com
   - **Password**: Password123!
4. Presiona "Create"
5. En la app, intenta con esas mismas credenciales

**Resultado esperado**: Deberías ver el panel de selección de área

---

## 🎯 Flujo de Testing Completo

Después de habilitadas las opciones:

1. ✅ Abre http://127.0.0.1:5173
2. ✅ Selecciona "Continuar sin cuenta" (anonymous) O usa email/password
3. ✅ Deberías ver el formulario de selección de área
4. ✅ Selecciona un área y continúa
5. ✅ Se cargarán productos desde la API
6. ✅ Completa el flujo de creación de ticket

---

## 🛠️ Si Prefieres Saltarte la Autenticación (Testing Rápido)

Puedo modificar temporalmente el código para usar autenticación dummy durante el testing.
¿Quieres que lo haga?

---

## 📞 Necesitas Ayuda?

Si no tienes acceso a Firebase Console, proporciona tu correo y te puedo:
- Invitar como admin del proyecto Firebase
- O crear un proyecto alternativo
- O modificar el código para usar otro método de autenticación
