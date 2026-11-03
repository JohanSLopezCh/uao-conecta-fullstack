# UAO Conecta · prototipo funcional (frontend + backend)

Demo académica de IHC / Diseño Centrado en el Usuario. **Encontrar. Coordinar. Saber a quién acudir.** (ODS 4)
Los datos son de demostración y no representan información oficial de la UAO.

## Cómo correrlo
Requiere Node 18 o superior.

    npm install
    npm start        # abre http://localhost:3000
    npm test         # pruebas de integración (incluye SSO y Moodle simulados)

Para ver la demo con cuentas de ejemplo: `DEMO_MODE=1 npm start`. Los datos se guardan en `data.json` (bórralo para reiniciar la demo).

## Qué hace el backend (server.js)
- Registro e inicio de sesión (contraseñas con scrypt, token firmado con HMAC, límite de intentos de login).
- Roles aplicados en el servidor: solo Docente/Monitor publican recursos y deciden asesorías; solo Monitor orienta grupos;
  solo quien preguntó, un docente o un monitor marca la solución o cambia el estado de una duda.
- Anonimato real: el servidor nunca envía quién publicó una duda anónima.
- Dudas, respuestas, "útil", solución, asesorías, recursos, comunidades de estudio, tareas, acuerdos, guardados y notificaciones.

## API (todas bajo /api, con `Authorization: Bearer <token>` salvo auth)
POST /auth/register · POST /auth/login · GET /bootstrap · POST /questions · POST /questions/:id/answers ·
POST /questions/:id/answers/:i/useful · POST /questions/:id/solution · PATCH /questions/:id ·
POST /advisories · PATCH /advisories/:id · POST /resources · POST /groups · POST /groups/:id/join ·
POST /groups/:id/orient · POST /tasks · PATCH /tasks/:id · POST /files · POST /saved · POST /notifications/read

## Conexión con la UAO (Google + UAO Virtual)
La UAO usa **Google Workspace** para el correo y el ingreso único, así que el ingreso es con Google.

**1. Ingreso con Google (lo puedes hacer tú, sin TI)**
1. Entra a https://console.cloud.google.com y crea un proyecto.
2. «APIs y servicios» → «Pantalla de consentimiento de OAuth» → tipo **Externo** → completa nombre y correo. Los permisos básicos (`openid`, `email`, `profile`) no requieren verificación de Google.
3. «Credenciales» → «Crear credenciales» → **ID de cliente de OAuth** → Aplicación web. En «URI de redireccionamiento autorizados» pon `http://localhost:3000/api/auth/google/callback` (y la de tu dominio cuando lo publiques).
4. Copia el ID y el secreto a tu archivo `.env` (mira `.env.example`).
El servidor solo deja pasar cuentas con correo verificado, dominio de Workspace `uao.edu.co` y correo `@uao.edu.co`. Nunca ve la contraseña. Si la UAO bloquea apps externas en su Workspace, TI tiene que permitir tu ID de cliente.

**2. UAO Virtual (Moodle): cursos, notas y entregas**
Pones en `.env` solo `MOODLE_URL` (la dirección de UAO Virtual). Cada estudiante conecta su cuenta pegando su propia **llave de seguridad** de Moodle (Preferencias → Claves de seguridad → «Moodle mobile web service»). No es su contraseña, solo lee sus datos, se guarda cifrada (AES-256-GCM) y se puede desconectar o restablecer. Si la UAO tiene esa opción desactivada, TI debe habilitar el servicio móvil de Moodle.
Funciones de Moodle usadas: `core_webservice_get_site_info`, `core_enrol_get_users_courses`, `gradereport_user_get_grade_items`, `core_calendar_get_action_events_by_timesort`.
Opcional: si TI te da un token de servicio (`MOODLE_TOKEN`), los cursos se sincronizan por correo al entrar.

**Docentes y monitores:** `STAFF_EMAILS="prof@uao.edu.co:Docente,mon@uao.edu.co:Monitor"`.

**Modo demostración** (`DEMO_MODE=1`): activa cuentas de ejemplo y datos de muestra, útil para ver el diseño sin credenciales.

## Identidad visual
Basada en el Manual de Identidad Corporativa de la UAO (DC-1.8-MU1, versión 6, mayo de 2022): colores corporativos rojo y negro (versión web: FF0000 y 000000) y tipografía Helvetica Neue/Arial. El rojo se usa como acento y el negro como color principal de botones y títulos, para conservar el contraste. No se usa el logotipo oficial (el manual restringe su uso y pide solicitar el archivo a buzon@uao.edu.co); el nombre aparece solo como texto. Es un proyecto académico, no oficial.

## Límites conocidos de esta versión
- Los roles Docente/Monitor no se eligen al registrarse: se asignan por correo con la variable `STAFF_EMAILS` (ver abajo). En un sistema real deben venir de los sistemas de la UAO.
- El ingreso con Google y la lectura de UAO Virtual están probados solo contra servidores simulados; falta probarlos con la UAO real. No hay conexión con Banner ni con Teams. No pidas ni guardes contraseñas de UAO Virtual.
- El envío real de correos con SMTP está implementado pero no fue probado.
- Integrantes y horarios comunes de "Mi grupo" son de demostración; tareas y acuerdos son compartidos por todos.
- Los archivos adjuntos no se suben ni se descargan (solo se registran nombres).
- Persistencia en un archivo JSON: sirve para una demo, no para producción (usar una base de datos real).
- Cambia el secreto de firma: se genera solo en `data.json` la primera vez.
