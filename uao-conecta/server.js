'use strict';
/**
 * UAO Conecta · Backend (Express + persistencia en data.json)
 * - Sirve el frontend estático desde /public
 * - Modo demostración: DEMO_MODE=1 (o automático si NO hay credenciales de Google)
 * - Ingreso institucional con Google OAuth 2.0 + PKCE cuando hay credenciales
 * - API pública de datos de ejemplo: GET /api/data
 * Nota Render: el disco es efímero; data.json y /uploads se regeneran en cada deploy/reinicio.
 */
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ---------- .env sin dependencias (las variables del entorno tienen prioridad) ----------
try {
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach(l => {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !l.trim().startsWith('#') && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch {}

// ---------- Configuración ----------
const PORT = Number(process.env.PORT) || 3000;
const FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const UPLOADS = process.env.UPLOADS_DIR || path.join(path.dirname(FILE), 'uploads');
const PUBLIC_DIR = path.join(__dirname, 'public');
const DOMAIN = (process.env.ALLOWED_DOMAIN || 'uao.edu.co').toLowerCase();
const TZ = 'America/Bogota';
const SEED_V = 2;
const VERSION = '1.3.0'; // el cliente lo usa para detectar un servidor sin reiniciar // súbelo para forzar la regeneración de los datos demo
const STAFF = Object.fromEntries(
  (process.env.STAFF_EMAILS || '').split(',').map(x => x.trim().toLowerCase().split(':'))
    .filter(a => a[0] && ['docente', 'monitor'].includes(a[1]))
    .map(a => [a[0], a[1][0].toUpperCase() + a[1].slice(1)])
);

const G = {
  client: process.env.GOOGLE_CLIENT_ID || '',
  secret: process.env.GOOGLE_CLIENT_SECRET || '',
  redirect: process.env.GOOGLE_REDIRECT_URI || '',
  auth: process.env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth',
  token: process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token'
};
const SSO = !!(G.client && G.secret);
const CB_PATH = '/api/auth/google/callback';
// REDIRECT_URI dinámico: 1) GOOGLE_REDIRECT_URI  2) RENDER_EXTERNAL_URL (lo define Render)  3) host de la petición
const redirectFor = req => G.redirect
  || (process.env.RENDER_EXTERNAL_URL ? process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '') + CB_PATH : '')
  || `${req.protocol}://${req.get('host')}${CB_PATH}`;
// Dominio institucional: el correo DEBE terminar en @ALLOWED_DOMAIN
const inDomain = email => typeof email === 'string' && email.toLowerCase().endsWith('@' + DOMAIN);
// Modo demo (cuentas *@demo.uao + datos de ejemplo). Activo salvo DEMO_MODE=0.
const DEMO = process.env.DEMO_MODE !== '0';

const MOODLE = {
  url: (process.env.MOODLE_URL || 'https://campus.uaovirtual.edu.co').replace(/\/$/, ''),
  token: process.env.MOODLE_TOKEN || ''
};
const LMS = !!MOODLE.url;

let mail = null;
try { if (process.env.SMTP_URL) mail = require('nodemailer').createTransport(process.env.SMTP_URL); } catch {}
async function sendCode(to, code) {
  if (mail) {
    await mail.sendMail({
      from: process.env.MAIL_FROM || 'UAO Conecta <no-reply@uao-conecta.local>', to,
      subject: 'Tu código de verificación de UAO Conecta',
      text: `Tu código es ${code}. Vence en 15 minutos. Si no fuiste tú, ignora este mensaje.`
    });
  } else console.log(`[modo demostración] Código para ${to}: ${code}`);
}

const hash = (p, s = crypto.randomBytes(16).toString('hex')) => s + ':' + crypto.scryptSync(String(p), s, 32).toString('hex');
const same = (p, h) => {
  if (!h || typeof h !== 'string' || !h.includes(':')) return false;
  const a = Buffer.from(hash(p, h.split(':')[0])), b = Buffer.from(h);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const r2 = x => Math.round(x * 100) / 100;

// ======================================================================
//  DATOS DE EJEMPLO (ficticios, solo para la demostración académica)
// ======================================================================
const PERIODO = '2026-2S';
const PESOS = [0.3, 0.3, 0.4]; // Corte 1, Corte 2, Corte 3
const DEMO_PW = 'demo1234';
// Cuenta de ejemplo: SIEMPRE disponible (aunque DEMO_MODE=0 o haya Google), con todos los datos de muestra
const EJEMPLO = { email: process.env.EXAMPLE_EMAIL || 'ejemplo@demo.uao', password: process.env.EXAMPLE_PASSWORD || 'Ejemplo2026', n: 'Estudiante Ejemplo' };

const MATERIAS = [
  { n: 'Cálculo Vectorial', cod: '541292', grp: 'B-1', cr: 4, plat: 'moodle', area: 'Ciencias Básicas', alias: ['calculo 3', 'calculo multivariable', 'vectorial'], desc: 'Funciones de varias variables, derivadas parciales, integrales múltiples y teoremas de Green, Stokes y Gauss.' },
  { n: 'Interacción Humano-Computador', sigla: 'IHC', cod: '532200', grp: 'B-1', cr: 3, plat: 'classroom', area: 'Diseño', alias: ['ihc', 'hci', 'ux', 'usabilidad', 'diseño centrado en el usuario'], desc: 'Diseño centrado en el usuario, prototipado y evaluación de usabilidad.' },
  { n: 'Multimedia', cod: 'IMM-2304', grp: '01', cr: 3, plat: 'moodle', area: 'Diseño', alias: ['audio', 'video', 'animacion', 'edicion'], desc: 'Producción y edición de audio, video e imagen digital.' },
  { n: 'Formación Ciudadana', cod: 'HUM-1102', grp: '05', cr: 2, plat: 'moodle', area: 'Humanidades', alias: ['ciudadania', 'constitucion', 'democracia'], desc: 'Constitución Política, participación democrática y convivencia.' },
  { n: 'Probabilidad y Estadística', cod: 'MAT-2205', grp: '03', cr: 3, plat: 'moodle', area: 'Ciencias Básicas', alias: ['estadistica', 'probabilidad', 'regresion'], desc: 'Variables aleatorias, distribuciones, inferencia y regresión lineal.' },
  { n: 'Programación Orientada a Objetos', cod: 'INF-2101', grp: '01', cr: 3, plat: 'classroom', area: 'Informática', alias: ['poo', 'oop', 'java', 'programacion'], desc: 'Clases, herencia, polimorfismo, interfaces y patrones básicos.' },
  { n: 'Física II', cod: 'FIS-1202', grp: '04', cr: 4, plat: 'moodle', area: 'Ciencias Básicas', alias: ['electricidad', 'magnetismo', 'fisica 2'], desc: 'Electrostática, circuitos eléctricos y magnetismo.' },
  { n: 'Bases de Datos', cod: 'INF-2302', grp: '02', cr: 3, plat: 'classroom', area: 'Informática', alias: ['sql', 'bd', 'modelo relacional'], desc: 'Modelo entidad-relación, SQL y normalización.' },
  { n: 'Diseño de Interfaces Web', cod: 'IMM-2402', grp: '01', cr: 3, plat: 'moodle', area: 'Diseño', alias: ['html', 'css', 'frontend', 'web'], desc: 'Maquetación responsive con HTML, CSS y accesibilidad web.' },
  { n: 'Inglés IV', cod: 'IDI-1404', grp: '07', cr: 2, plat: 'manual', area: 'Idiomas', alias: ['ingles', 'english'], desc: 'Comunicación oral y escrita en inglés, nivel B1.' }
];
const BYNAME = Object.fromEntries(MATERIAS.map(m => [m.n, m]));
// Materias inscritas por el estudiante demo (las demás solo aparecen en el buscador)
const INSCRITAS = ['Cálculo Vectorial', 'Interacción Humano-Computador', 'Multimedia', 'Formación Ciudadana', 'Probabilidad y Estadística', 'Programación Orientada a Objetos'];
// Notas por corte [C1 30 %, C2 30 %, C3 40 %]; la definitiva se calcula
const NOTAS_DEMO = {
  'Cálculo Vectorial': [3.4, 3.9, 4.2],
  'Interacción Humano-Computador': [4.5, 4.3, 4.7],
  'Multimedia': [4.0, 4.4, 4.1],
  'Formación Ciudadana': [4.2, 3.8, 4.0],
  'Probabilidad y Estadística': [3.1, 2.6, 3.5],
  'Programación Orientada a Objetos': [2.8, 2.4, 2.9]
};
const defOf = c => r2(c.reduce((a, x, i) => a + x * PESOS[i], 0));

const PERSONAS = [
  { email: 'docente@demo.uao', correo: 'marta.ospina@uao.edu.co', n: 'Prof. Marta Ospina (demo)', rol: 'Docente', s: 'Cálculo Vectorial', disp: 'Lun y mié 2:00–4:00 p. m.', mod: 'Presencial', info: 'Derivadas parciales, integrales múltiples y campos vectoriales.' },
  { email: 'docente2@demo.uao', n: 'Prof. Ricardo Vélez (demo)', rol: 'Docente', s: 'Programación Orientada a Objetos', disp: 'Jue 10:00 a. m.–12:00 m.', mod: 'Virtual', info: 'Diseño de clases, herencia y buenas prácticas.' },
  { email: 'docente3@demo.uao', correo: 'natalia.cifuentes@uao.edu.co', n: 'Prof. Natalia Cifuentes (demo)', rol: 'Docente', s: 'Interacción Humano-Computador', disp: 'Mar 9:00–11:00 a. m.', mod: 'Presencial', info: 'Prototipado, pruebas de usabilidad y heurísticas de Nielsen.' },
  { email: 'docente4@demo.uao', n: 'Prof. Julián Arango (demo)', rol: 'Docente', s: 'Multimedia', disp: 'Vie 2:00–4:00 p. m.', mod: 'Presencial', info: 'Edición de video, mezcla de audio y composición.' },
  { email: 'docente5@demo.uao', n: 'Prof. Diana Lozano (demo)', rol: 'Docente', s: 'Formación Ciudadana', disp: 'Mié 10:00–11:00 a. m.', mod: 'Virtual', info: 'Constitución, derechos fundamentales y participación.' },
  { email: 'docente6@demo.uao', n: 'Prof. Hernán Castaño (demo)', rol: 'Docente', s: 'Probabilidad y Estadística', disp: 'Lun 4:00–6:00 p. m.', mod: 'Presencial', info: 'Distribuciones, pruebas de hipótesis y regresión.' },
  { email: 'monitor@demo.uao', correo: 'andres.mejia@uao.edu.co', n: 'Andrés Mejía (demo)', rol: 'Monitor', s: 'Cálculo Vectorial', disp: 'Mar y jue 3:00–4:00 p. m.', mod: 'Presencial', info: 'Integrales dobles y triples, cambio de coordenadas.' },
  { email: 'monitor2@demo.uao', n: 'Valeria Cruz (demo)', rol: 'Monitor', s: 'Programación Orientada a Objetos', disp: 'Mié 10:00–11:00 a. m.', mod: 'Virtual', info: 'Java, clases abstractas e interfaces.' },
  { email: 'monitor3@demo.uao', correo: 'camilo.rengifo@uao.edu.co', n: 'Camilo Rengifo (demo)', rol: 'Monitor', s: 'Interacción Humano-Computador', disp: 'Lun 11:00 a. m.–12:00 m.', mod: 'Virtual', info: 'Figma, wireframes y pruebas con usuarios.' },
  { email: 'monitor4@demo.uao', n: 'Isabela Muñoz (demo)', rol: 'Monitor', s: 'Multimedia', disp: 'Jue 2:00–3:30 p. m.', mod: 'Presencial', info: 'Premiere, After Effects y Audition.' },
  { email: 'monitor5@demo.uao', n: 'Sebastián Ortiz (demo)', rol: 'Monitor', s: 'Probabilidad y Estadística', disp: 'Vie 9:00–10:30 a. m.', mod: 'Presencial', info: 'Intervalos de confianza, valor p y regresión lineal.' },
  { email: 'monitor6@demo.uao', n: 'Laura Patiño (demo)', rol: 'Monitor', s: 'Formación Ciudadana', disp: 'Lun 3:00–4:00 p. m.', mod: 'Virtual', info: 'Preparación de ensayos y mecanismos de participación.' },
  { email: 'monitor7@demo.uao', n: 'Mariana Peña (demo)', rol: 'Monitor', s: 'Física II', disp: 'Mar 1:00–2:00 p. m.', mod: 'Presencial', info: 'Ley de Coulomb, campo eléctrico y circuitos.' },
  { email: 'monitor9@demo.uao', correo: 'juliana.rojas@uao.edu.co', n: 'Juliana Rojas (demo)', rol: 'Monitor', s: 'Interacción Humano-Computador', disp: 'Jue 4:00–5:30 p. m.', mod: 'Presencial', info: 'Evaluación heurística y análisis de resultados de pruebas.' },
  { email: 'monitor8@demo.uao', n: 'Daniel Torres (demo)', rol: 'Monitor', s: 'Bases de Datos', disp: 'Mié 4:00–5:00 p. m.', mod: 'Virtual', info: 'Consultas SQL, joins y normalización.' }
];

const APOYO = [
  { id: 1, n: 'Monitorías académicas', d: 'Acompañamiento entre pares en las asignaturas con mayor dificultad. Agéndalas desde la pestaña Monitores.', canal: 'Presencial y virtual' },
  { id: 2, n: 'Biblioteca', d: 'Préstamo de libros, bases de datos académicas y salas de estudio grupal.', canal: 'Presencial y virtual' },
  { id: 3, n: 'Asesoría psicopedagógica', d: 'Técnicas de estudio, manejo del tiempo y orientación académica.', canal: 'Con cita previa' },
  { id: 4, n: 'Centro de escritura', d: 'Revisión de informes, ensayos y normas de citación (APA/IEEE).', canal: 'Virtual' },
  { id: 5, n: 'Salas de cómputo', d: 'Equipos con software de diseño, programación y edición multimedia.', canal: 'Presencial' }
];

// Entregas demo: d = días desde hoy (negativo = vencida), h:mi = hora límite (Bogotá)
const DEMO_ENT = [
  { k: 'cv-t5', n: 'Taller 5: integrales dobles', s: 'Cálculo Vectorial', d: 1, h: 23, mi: 59, src: 'moodle' },
  { k: 'cv-q3', n: 'Quiz 3: teorema de Green', s: 'Cálculo Vectorial', d: 6, h: 10, mi: 0, src: 'moodle' },
  { k: 'ihc-proto', n: 'Prototipo de alta fidelidad (Figma)', s: 'Interacción Humano-Computador', d: 3, h: 23, mi: 59, src: 'classroom' },
  { k: 'ihc-heur', n: 'Informe de evaluación heurística', s: 'Interacción Humano-Computador', d: -2, h: 23, mi: 59, src: 'classroom' },
  { k: 'mm-video', n: 'Proyecto final: cortometraje', s: 'Multimedia', d: 9, h: 23, mi: 59, src: 'moodle' },
  { k: 'mm-audio', n: 'Ejercicio de mezcla de audio', s: 'Multimedia', d: -5, h: 23, mi: 59, src: 'moodle' },
  { k: 'fc-ensayo', n: 'Ensayo: mecanismos de participación', s: 'Formación Ciudadana', d: 0, h: 18, mi: 0, src: 'moodle' },
  { k: 'pye-taller', n: 'Taller de regresión lineal', s: 'Probabilidad y Estadística', d: 2, h: 23, mi: 59, src: 'moodle' },
  { k: 'pye-parcial', n: 'Parcial final (tercer corte)', s: 'Probabilidad y Estadística', d: 13, h: 8, mi: 0, src: 'moodle' },
  { k: 'poo-lab', n: 'Laboratorio 6: herencia y polimorfismo', s: 'Programación Orientada a Objetos', d: 4, h: 23, mi: 59, src: 'classroom' },
  { k: 'poo-proy', n: 'Proyecto final POO (avance 2)', s: 'Programación Orientada a Objetos', d: -1, h: 23, mi: 59, src: 'classroom' }
];
const DEMO_DONE = ['moodlemm-audio', 'classroompoo-proy'];

// ---------- utilidades de fecha/ids ----------
const TZ_OFF = 5 * 36e5; // Bogotá UTC-5 (sin horario de verano)
const bogota = (off, h = 23, mi = 59) => {
  const b = new Date(Date.now() - TZ_OFF);
  return Math.floor((Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate() + off, h, mi) + TZ_OFF) / 1000);
};
const iso = s => new Date(s * 1000).toISOString();
const sid = k => 1e9 + parseInt(crypto.createHash('sha1').update(k).digest('hex').slice(0, 7), 16);
const fmt = t => t ? new Date(t).toLocaleString('es-CO', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' }) : '';
const today = () => new Date().toLocaleDateString('es-CO', { timeZone: TZ, day: 'numeric', month: 'short' }).replace('.', '');

const demoNotas = () => INSCRITAS.map(n => ({ m: n, c: BYNAME[n].cr, cortes: [...NOTAS_DEMO[n]], n: defOf(NOTAS_DEMO[n]) }));

function seed() {
  const pw = hash(DEMO_PW), now = Date.now(), users = [];
  if (DEMO) {
    users.push({ id: 1, n: 'Estudiante Demo', email: 'estudiante@demo.uao', rol: 'Estudiante', pw, prog: 'Ingeniería Multimedia', cursos: [...INSCRITAS], verified: true, demo: true, promAcum: 3.86, notas: demoNotas(), portalSync: now, syncM: now, syncC: now, done: DEMO_DONE.map(sid) });
    PERSONAS.forEach((p, i) => users.push({ id: i + 2, n: p.n, email: p.email, rol: p.rol, pw, prog: p.rol === 'Docente' ? 'Docente UAO (demo)' : 'Monitor UAO (demo)', cursos: [p.s], verified: true, demo: true, s: p.s, disp: p.disp, mod: p.mod, info: p.info }));
  }
  const id = e => (users.find(u => u.email === e) || {}).id || 0;
  const A = (email, n, by, x, votes = [], sol = 0) => ({ by, n, x, v: votes, sol, uid: id(email) });
  const q = [
    { id: 1, t: '¿Cuándo conviene usar coordenadas polares en una integral doble?', s: 'Cálculo Vectorial', d: 'La región es un círculo y la integral cartesiana se vuelve muy larga.', f: '3 nov', st: 'Resuelta', au: 'Camila R.', tags: ['integrales'], uid: 0,
      a: [A('monitor@demo.uao', 'Andrés Mejía (demo)', 'Monitor', 'Cuando la región o el integrando dependen de x²+y². Cambia x=r cosθ, y=r sinθ y no olvides el jacobiano r: dA = r dr dθ.', [-1, -2, -3], 1)] },
    { id: 2, t: '¿Cuántos usuarios necesito para una prueba de usabilidad?', s: 'Interacción Humano-Computador', d: 'Para el prototipo del proyecto final, ¿con cuántas personas es suficiente?', f: '2 nov', st: 'Resuelta', au: 'Anónimo', tags: ['usabilidad'], uid: 0,
      a: [A('monitor3@demo.uao', 'Camilo Rengifo (demo)', 'Monitor', 'Con unas 5 personas por ronda se detecta la mayoría de problemas graves; es mejor hacer varias rondas cortas e iterar el prototipo.', [-1, -4], 1)] },
    { id: 3, t: '¿Qué formato uso para exportar el cortometraje final?', s: 'Multimedia', d: 'El archivo me queda de varios GB y la plataforma no lo acepta.', f: '1 nov', st: 'En discusión', au: 'Juan D.', tags: ['video'], uid: 0,
      a: [A('', 'Laura P.', 'Estudiante', 'Yo exporté en MP4 con H.264 a 1080p y bitrate variable, quedó de unos 300 MB.', [-2])] },
    { id: 4, t: '¿Diferencia entre clase abstracta e interfaz?', s: 'Programación Orientada a Objetos', d: 'En el laboratorio 6 no sé cuál usar para las figuras.', f: '31 oct', st: 'En discusión', au: 'Anónimo', tags: ['herencia'], uid: 0,
      a: [A('monitor2@demo.uao', 'Valeria Cruz (demo)', 'Monitor', 'La clase abstracta comparte estado y código común (atributos, métodos implementados); la interfaz define un contrato que varias clases no relacionadas pueden cumplir.', [-3])] },
    { id: 5, t: '¿Cómo interpreto el valor p en una prueba de hipótesis?', s: 'Probabilidad y Estadística', d: 'Me dio p = 0,03 con α = 0,05 y no sé qué concluir.', f: '30 oct', st: 'Sin respuesta', au: 'Anónimo', tags: ['inferencia'], uid: 0, a: [] },
    { id: 6, t: '¿Qué mecanismos de participación entran en el parcial?', s: 'Formación Ciudadana', d: 'No sé si incluye revocatoria del mandato y cabildo abierto.', f: '29 oct', st: 'Sin respuesta', au: 'María F.', tags: ['parcial'], uid: 0, a: [] }
  ];
  const R = [
    { id: 1, n: 'Guía de derivadas parciales y gradiente', s: 'Cálculo Vectorial', ty: 'Guía', d: 'Ejercicios resueltos paso a paso con interpretación geométrica.', f: '20 oct', au: 'Prof. Marta Ospina (demo)' },
    { id: 2, n: 'Taller 5: integrales dobles y triples', s: 'Cálculo Vectorial', ty: 'Taller', d: 'Incluye cambio a coordenadas polares, cilíndricas y esféricas.', f: '28 oct', au: 'Andrés Mejía (demo)' },
    { id: 3, n: 'Resumen: teoremas de Green, Stokes y Gauss', s: 'Cálculo Vectorial', ty: 'Apunte', d: 'Cuadro comparativo con condiciones de uso.', f: '4 nov', au: 'Andrés Mejía (demo)' },
    { id: 4, n: 'Heurísticas de Nielsen con ejemplos', s: 'Interacción Humano-Computador', ty: 'Guía', d: 'Las 10 heurísticas con ejemplos de interfaces reales.', f: '15 oct', au: 'Prof. Natalia Cifuentes (demo)' },
    { id: 5, n: 'Plantilla de guion para prueba con usuarios', s: 'Interacción Humano-Computador', ty: 'Documento', d: 'Consentimiento, tareas, métricas y preguntas de cierre.', f: '27 oct', au: 'Camilo Rengifo (demo)' },
    { id: 6, n: 'Guía de exportación de video (H.264)', s: 'Multimedia', ty: 'Guía', d: 'Configuración recomendada de resolución, bitrate y audio.', f: '30 oct', au: 'Isabela Muñoz (demo)' },
    { id: 7, n: 'Banco de sonidos y música libre', s: 'Multimedia', ty: 'Enlace', d: 'Recursos con licencia Creative Commons para el cortometraje.', f: '22 oct', au: 'Prof. Julián Arango (demo)', url: 'https://freesound.org' },
    { id: 8, n: 'Constitución de 1991: derechos fundamentales', s: 'Formación Ciudadana', ty: 'Material de estudio', d: 'Lectura guiada de los títulos I y II.', f: '10 oct', au: 'Prof. Diana Lozano (demo)' },
    { id: 9, n: 'Formulario de distribuciones de probabilidad', s: 'Probabilidad y Estadística', ty: 'Documento', d: 'Binomial, Poisson, normal y t de Student con sus parámetros.', f: '18 oct', au: 'Sebastián Ortiz (demo)' },
    { id: 10, n: 'Taller de regresión lineal simple', s: 'Probabilidad y Estadística', ty: 'Taller', d: 'Mínimos cuadrados, R² e interpretación de coeficientes.', f: '1 nov', au: 'Prof. Hernán Castaño (demo)' },
    { id: 11, n: 'Apuntes de herencia y polimorfismo', s: 'Programación Orientada a Objetos', ty: 'Apunte', d: 'Ejemplos en Java con diagramas UML.', f: '25 oct', au: 'Valeria Cruz (demo)' },
    { id: 12, n: 'Ejercicios de SQL con joins', s: 'Bases de Datos', ty: 'Taller', d: 'INNER, LEFT y RIGHT JOIN con una base de datos de ejemplo.', f: '26 oct', au: 'Daniel Torres (demo)' },
    { id: 13, n: 'Ley de Coulomb y campo eléctrico', s: 'Física II', ty: 'Guía', d: 'Problemas resueltos de cargas puntuales y distribuciones.', f: '19 oct', au: 'Mariana Peña (demo)' }
  ];
  const st = id('estudiante@demo.uao');
  const Gr = [
    { id: 1, n: 'Estudio para el parcial de Cálculo Vectorial', s: 'Cálculo Vectorial', m: [st, -2, -3, -4].filter(Boolean), o: [id('monitor@demo.uao')].filter(Boolean) },
    { id: 2, n: 'Equipo del prototipo IHC', s: 'Interacción Humano-Computador', m: [st, -2, -5].filter(Boolean), o: [] },
    { id: 3, n: 'Edición colaborativa Multimedia', s: 'Multimedia', m: [-1, -2, -3, -4, -5], o: [] },
    { id: 4, n: 'Estadística sin miedo', s: 'Probabilidad y Estadística', m: [-1, -3, -6], o: [id('monitor5@demo.uao')].filter(Boolean) }
  ];
  const T = [
    { id: 1, n: 'Prototipo en Figma (alta fidelidad)', w: 'Camila R.', d: '13 nov', st: 'En proceso' },
    { id: 2, n: 'Guion de la prueba con usuarios', w: 'Estudiante Demo', d: '12 nov', st: 'Pendiente' },
    { id: 3, n: 'Informe de evaluación heurística', w: 'Laura P.', d: '8 nov', st: 'Completada' },
    { id: 4, n: 'Video demo para Multimedia', w: 'Juan D.', d: '19 nov', st: 'Pendiente' }
  ];
  const F = [
    { id: 1, n: 'Acuerdo: reunirnos martes y jueves a las 4 p. m.', au: 'Estudiante Demo', f: '3 nov', ty: 'Acuerdo' },
    { id: 2, n: 'Acuerdo: cada integrante prueba el prototipo con 2 usuarios', au: 'Camila R.', f: '1 nov', ty: 'Acuerdo' },
    { id: 3, n: 'Acuerdo: entregas internas un día antes de la fecha límite', au: 'Laura P.', f: '28 oct', ty: 'Acuerdo' }
  ];
  const D0 = {
    v: SEED_V, secret: crypto.randomBytes(32).toString('hex'),
    seq: { u: users.length, q: q.length, r: R.length, g: Gr.length, t: T.length, f: F.length, a: 0, e: 0 },
    users, q, R, G: Gr, T, F, A: [], N: [], sv: [], cat: MATERIAS.map(m => m.n)
  };
  users.forEach(demoRefresh);
  return D0;
}

// ---------- Carga/persistencia ----------
function readData() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return null; } }
function persist() {
  try {
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(D));
    fs.renameSync(tmp, FILE);
  } catch (e) { console.log('[datos] No se pudo guardar:', e.message); }
}
let D; // se carga más abajo, cuando todos los helpers existen

const nid = k => (D.seq[k] = (D.seq[k] || 0) + 1);
function ensureExample() {
  // Contenido de muestra si la base está vacía (dudas, recursos, comunidades, tareas, acuerdos)
  const s0 = seed();
  [['q', 'q'], ['R', 'r'], ['G', 'g'], ['T', 't'], ['F', 'f']].forEach(([k, sq]) => {
    if (!D[k].length) { D[k] = s0[k]; D.seq[sq] = Math.max(D.seq[sq] || 0, ...s0[k].map(x => x.id)); }
  });
  let u = D.users.find(x => x.email === EJEMPLO.email);
  if (!u) {
    const now = Date.now();
    D.users.push(u = { id: Math.max(0, ...D.users.map(x => x.id)) + 1, email: EJEMPLO.email, n: EJEMPLO.n, rol: 'Estudiante', prog: 'Ingeniería Multimedia',
      verified: true, demo: true, ejemplo: true, cursos: [...INSCRITAS], notas: demoNotas(), promAcum: 3.86, portalSync: now, syncM: now, syncC: now, done: DEMO_DONE.map(sid) });
  }
  if (!same(EJEMPLO.password, u.pw)) u.pw = hash(EJEMPLO.password);
  Object.assign(u, { rol: 'Estudiante', verified: true, demo: true, ejemplo: true });
  if (!u.cursos || !u.cursos.length) u.cursos = [...INSCRITAS];
  if (!u.notas || !u.notas.length) u.notas = demoNotas();
  demoRefresh(u);
}
function ensureStaff() {
  let pw = null;
  PERSONAS.forEach(p => {
    let u = D.users.find(x => x.email === p.email);
    if (!u) {
      pw = pw || hash(DEMO ? DEMO_PW : crypto.randomBytes(18).toString('hex'));
      D.users.push(u = { id: nid('u'), email: p.email, pw, verified: true, demo: true });
    }
    Object.assign(u, { n: p.n, rol: p.rol, correo: p.correo || '', prog: p.rol === 'Docente' ? 'Docente UAO (demo)' : 'Monitor UAO (demo)', cursos: [p.s], s: p.s, disp: p.disp, mod: p.mod, info: p.info, verified: true });
  });
  D.seq.u = Math.max(D.seq.u || 0, ...D.users.map(u => u.id));
}
const clean = (s, n = 500) => String(s ?? '').trim().slice(0, n);
const bad = (res, m) => res.status(400).json({ error: m });
const nf = res => res.status(404).json({ error: 'No encontrado.' });
const notify = (uid, x, h) => { if (uid > 0) D.N.push({ uid, x, r: 0, h }); };
const CAT = () => D.cat;

const sign = u => {
  const b = Buffer.from(JSON.stringify({ u, e: Date.now() + 7 * 864e5 })).toString('base64url');
  return b + '.' + crypto.createHmac('sha256', D.secret).update(b).digest('base64url');
};
const unsign = t => {
  const [b, s] = String(t || '').split('.');
  if (!b || !s || crypto.createHmac('sha256', D.secret).update(b).digest('base64url') !== s) return;
  try { const p = JSON.parse(Buffer.from(b, 'base64url')); return p.e > Date.now() ? p.u : undefined; } catch {}
};
const auth = (req, res, next) => {
  const u = D.users.find(x => x.id === unsign((req.headers.authorization || '').slice(7)));
  if (!u) return res.status(401).json({ error: 'Inicia sesión para continuar.' });
  req.me = u;
  next();
};
const need = (...r) => (req, res, next) => r.includes(req.me.rol) ? next() : res.status(403).json({ error: 'Tu rol no permite esta acción.' });

// Diccionario opcional código -> nombre (materias.json) y nombres propios de cada estudiante
// Código institucional -> nombre. Se pueden agregar más en materias.json: { "532200": "Nombre" }
const CODIGOS = Object.fromEntries(MATERIAS.filter(m => /^\d{3,}$/.test(m.cod)).map(m => [m.cod, m.n]));
let MAT = { ...CODIGOS };
try { Object.assign(MAT, JSON.parse(fs.readFileSync(process.env.MATERIAS_FILE || path.join(__dirname, 'materias.json'), 'utf8'))); } catch {}
const codeOf = s => { const m = String(s).match(/^\s*(\d{3,})/); return m ? m[1] : String(s).trim(); };
// Nombre visible de una materia: '532200-B-1-(2026-2S)' -> 'Interacción Humano-Computador'
const disp = raw => { if (raw == null) return raw; const r = String(raw); if (BYNAME[r]) return r; const k = codeOf(r); return MAT[k] || r; };
const nameFor = (u, raw) => { const k = codeOf(raw); return (u.alias && u.alias[k]) || MAT[k] || null; };
function rebuildCourses(u) {
  const seen = new Set(), out = [];
  const add = (k, raw, n, manual) => { if (seen.has(k)) return; seen.add(k); out.push({ k, raw, n, named: n !== raw, manual: !!manual }); };
  (u.rawc || []).forEach(r => add(codeOf(r), r, nameFor(u, r) || r));
  (u.manual || []).forEach(m => add(m.k, m.k, m.n, true));
  const names = [...new Set([...out.map(e => e.n), ...(u.gcn || [])])];
  names.forEach(n => { if (!D.cat.includes(n)) D.cat.push(n); });
  u.cursos = names;
  return out;
}
const Q = id => D.q.find(q => q.id === +id);
const canMod = (q, me) => q.uid === me.id || me.rol !== 'Estudiante';

// ---------- Datos derivados para el frontend ----------
const setSync = (u, src, items) => {
  u.sy = (u.sy || []).filter(e => e.src !== src).concat(items.slice(0, 80).map(i => ({ id: sid(src + i.k), n: i.n, s: i.s, due: iso(i.t), src })));
};
// Carga los datos de ejemplo a un usuario real (Google) mientras no conecte plataformas reales
function giveDemo(u) {
  if (!DEMO || u.rol !== 'Estudiante' || u.demo || u.mt || u.ical || u.gc) return;
  const now = Date.now();
  Object.assign(u, { demo: true, cursos: [...INSCRITAS], notas: demoNotas(), promAcum: u.promAcum ?? 3.86, portalSync: now, syncM: now, syncC: now, done: DEMO_DONE.map(sid) });
  demoRefresh(u);
}
// Usuario con datos de demostración (cuentas demo o usuarios que pulsaron "sincronizar" en modo demo)
function demoRefresh(u) {
  if (!u || !u.demo || u.rol !== 'Estudiante') return;
  ['moodle', 'classroom'].forEach(src => setSync(u, src,
    DEMO_ENT.filter(e => e.src === src && (u.cursos || []).includes(e.s)).map(e => ({ k: e.k, n: e.n, s: e.s, t: bogota(e.d, e.h, e.mi) }))));
}
const courseOut = raw => { const n = disp(raw), m = BYNAME[n] || {}, g = String(raw).match(/^\d{3,}-([A-Z0-9]+-\d+)/); return { n, sigla: m.sigla || '', cod: m.cod || (n !== raw ? codeOf(raw) : ''), grp: m.grp || (g ? g[1] : ''), cr: m.cr || null, per: PERIODO }; };
const uniqNames = l => [...new Set((l || []).map(disp))];
const catalogOut = () => [
  ...MATERIAS.map(({ plat, ...m }) => ({ ...m, per: PERIODO, plataforma: plat })),
  ...uniqNames(D.cat).filter(n => !BYNAME[n]).map(n => ({ n, cod: '', grp: '', cr: null, per: PERIODO, area: 'Otra', alias: [], desc: '' }))
];
const srcOf = u => {
  if (u.demo && !(u.mt || u.ical || u.gc)) {
    const mine = (u.cursos || []).filter(n => BYNAME[n]);
    const pick = k => mine.filter(n => BYNAME[n].plat === k).map(courseOut);
    return {
      moodle: { conectado: !!u.syncM, cursos: u.syncM ? pick('moodle') : [], sync: fmt(u.syncM) },
      classroom: { conectado: !!u.syncC, cursos: u.syncC ? pick('classroom') : [] },
      manual: [...pick('manual'), ...(u.syncM ? [] : pick('moodle')), ...(u.syncC ? [] : pick('classroom')), ...(u.cursos || []).filter(n => !BYNAME[n]).map(courseOut)]
    };
  }
  const lms = !!(u.mt || u.ical), names = uniqNames(u.cursos), gc = uniqNames(u.gcn);
  return {
    moodle: { conectado: lms, cursos: lms ? names.filter(n => !gc.includes(n)).map(courseOut) : [], sync: fmt(u.synced) },
    classroom: { conectado: !!u.gc, cursos: gc.map(courseOut) },
    manual: lms || u.gc ? [] : names.map(courseOut)
  };
};
const portalOf = u => {
  const n = u.notas || [];
  if (!n.length) return null;
  const rows = n.map(i => {
    const c = Array.isArray(i.cortes) && i.cortes.length === 3 ? i.cortes : [];
    return { s: disp(i.m), cod: (BYNAME[i.m] || {}).cod || '', cr: i.c, n: c, def: c.length ? defOf(c) : i.n };
  });
  const cr = rows.reduce((a, i) => a + i.cr, 0), sem = r2(rows.reduce((a, i) => a + i.cr * i.def, 0) / cr);
  return {
    notas: rows, sem, prom: u.promAcum != null ? u.promAcum : sem,
    cred: rows.filter(i => i.def >= 3).reduce((a, i) => a + i.cr, 0), credTot: cr,
    pesos: PESOS, sync: u.portalSync ? fmt(u.portalSync) : 'manualmente'
  };
};
const entregasOf = u => [
  ...(u.ent || []).map(e => ({ ...e, s: disp(e.s), src: 'manual' })),
  ...(u.sy || []).map(e => ({ ...e, s: disp(e.s), st: (u.done || []).includes(e.id) ? 'Entregada' : 'Pendiente' }))
];
const pubR = r => { const { file, ...x } = r; return file ? { ...x, file: { name: file.name, size: file.size } } : x; };
const personas = () => D.users.filter(u => u.rol !== 'Estudiante' && u.verified !== false)
  .map(u => ({ id: u.id, n: u.n, r: u.rol, correo: u.correo || (inDomain(u.email) ? u.email : ''), s: disp(u.s) || 'General', disp: u.disp || 'Por definir', mod: u.mod || 'Por definir', info: u.info || '' }));

const view = me => ({
  me: {
    id: me.id, n: me.n, prog: me.prog, rol: me.rol,
    cursos: uniqNames(DEMO ? (me.cursos && me.cursos.length ? me.cursos : [...CAT()]) : (me.cursos || [])),
    cat: uniqNames(CAT()), managed: !!(me.mt || me.ical), mc: !!(me.mt || me.ical), gc: !!me.gc, demo: !!me.demo,
    notas: me.notas || [], email: me.email, fuentes: srcOf(me), portal: portalOf(me)
  },
  periodo: PERIODO,
  catalog: catalogOut(),
  apoyo: APOYO,
  q: D.q.map(q => ({
    id: q.id, t: q.t, s: disp(q.s), d: q.d, f: q.f, st: q.st, au: q.au, tags: q.tags, mine: q.uid === me.id, can: canMod(q, me),
    a: q.a.map((a, i) => ({ id: i, by: a.by, n: a.n, x: a.x, u: (a.v || []).length, vm: (a.v || []).includes(me.id), sol: a.sol }))
  })),
  R: D.R.map(pubR),
  G: D.G.map(g => ({ id: g.id, n: g.n, s: g.s, m: g.m.length, j: +g.m.includes(me.id), o: me.rol === 'Monitor' ? +g.o.includes(me.id) : +(g.o.length > 0) })),
  A: D.A.filter(a => me.rol === 'Estudiante' ? a.uid === me.id : a.p === me.id).map(a => ({ id: a.id, p: a.p, by: a.by, pn: a.pn, tema: a.tema, msg: a.msg, st: a.st, mod: a.mod, hor: a.hor, f: a.f })),
  T: D.T,
  E: entregasOf(me),
  F: D.F,
  N: D.N.filter(n => n.uid === me.id).map(({ x, r, h }) => ({ x, r, h })).reverse(),
  sv: D.sv.filter(s => s.uid === me.id).map(s => s.k),
  P: personas()
});

// ---------- Carga de datos (después de definir los helpers) ----------
D = readData();
if (!D || process.env.RESET_DATA === '1' || (DEMO && D.v !== SEED_V)) {
  if (D) console.log('[datos] Regenerando datos de demostración (v' + SEED_V + ').');
  D = seed();
  persist();
}
D.seq = D.seq || {};
['users', 'q', 'R', 'G', 'T', 'F', 'A', 'N', 'sv'].forEach(k => { if (!Array.isArray(D[k])) D[k] = []; });
D.cat = [...new Set([...(D.cat || []), ...MATERIAS.map(m => m.n)])];
if (!D.secret) D.secret = crypto.randomBytes(32).toString('hex');
ensureStaff();
ensureExample();
persist();

// ======================================================================
//  APP
// ======================================================================
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // Render está detrás de un proxy (req.ip correcto)
const jsonSmall = express.json({ limit: '100kb' }), jsonBig = express.json({ limit: '5mb' });
app.use((req, res, next) => (req.method === 'POST' && req.path === '/api/resources' ? jsonBig : jsonSmall)(req, res, next));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(express.static(PUBLIC_DIR));

app.get('/healthz', (req, res) => res.json({ ok: true, version: VERSION, demo: DEMO, sso: SSO }));

// ---------- API pública de datos de ejemplo ----------
app.get('/api/data', (req, res) => {
  const stu = DEMO ? D.users.find(u => u.email === 'estudiante@demo.uao') : null;
  const P = personas();
  res.json({
    periodo: PERIODO,
    pesos: { corte1: PESOS[0], corte2: PESOS[1], corte3: PESOS[2] },
    materias: catalogOut(),
    notasEjemplo: stu ? portalOf(stu) : null,
    monitores: P.filter(p => p.r === 'Monitor'),
    docentes: P.filter(p => p.r === 'Docente'),
    recursos: D.R.map(pubR),
    apoyo: APOYO
  });
});

// ---------- Autenticación con correo/contraseña (demo) ----------
const tries = {};
// El ingreso con correo/contraseña SIEMPRE está permitido (cuenta de ejemplo y cuentas demo) junto con Google.
// Solo el auto-registro con contraseña se desactiva cuando hay Google y el modo demo está apagado.
const ssoOnly = (req, res, next) => SSO && !DEMO ? res.status(400).json({ error: 'Entra con tu cuenta institucional de Google.' }) : next();
['register', 'resend', 'verify'].forEach(a => app.post('/api/auth/' + a, ssoOnly));

app.post('/api/auth/login', (req, res, next) => {
  const t = Date.now(), k = req.ip;
  tries[k] = (tries[k] || []).filter(x => t - x < 6e5);
  if (tries[k].length >= 20) return res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos.' });
  tries[k].push(t);
  next();
}, (req, res) => {
  const u = D.users.find(x => x.email === clean(req.body.email, 120).toLowerCase());
  if (!u || !same(req.body.password, u.pw)) return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
  if (u.verified === false) return res.status(403).json({ error: 'Verifica tu correo institucional con el código que te enviamos.', pending: true, email: u.email });
  res.json({ token: sign(u.id) });
});

const dev = c => process.env.ALLOW_DEV_CODE === '1' ? { devCode: c } : {};
async function issue(u, res) {
  const code = String(crypto.randomInt(100000, 1000000));
  u.code = hash(code); u.exp = Date.now() + 9e5; u.tries = 0; u.sent = Date.now();
  persist();
  try { await sendCode(u.email, code); } catch { return res.status(502).json({ error: 'No pudimos enviar el código al correo. Inténtalo de nuevo más tarde.' }); }
  res.json({ pending: true, email: u.email, ...dev(code) });
}

app.post('/api/auth/register', async (req, res) => {
  const b = req.body || {}, e = clean(b.email, 120).toLowerCase(), n = clean(b.n, 80);
  if (!n || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || String(b.password || '').length < 8) return bad(res, 'Escribe tu nombre, tu correo institucional y una contraseña de al menos 8 caracteres.');
  if (!inDomain(e)) return bad(res, 'Usa tu correo institucional (@' + DOMAIN + ').');
  let u = D.users.find(x => x.email === e);
  if (u && u.verified !== false) return bad(res, 'Ese correo ya tiene una cuenta. Inicia sesión.');
  if (u && Date.now() - (u.sent || 0) < 3e4) return bad(res, 'Espera unos segundos antes de pedir otro código.');
  const cursos = (Array.isArray(b.cursos) ? b.cursos : []).filter(c => CAT().includes(c));
  const rec = { n, email: e, rol: STAFF[e] || 'Estudiante', prog: clean(b.prog, 80) || 'Ingeniería', pw: hash(b.password), cursos: cursos.length ? cursos : [...CAT()], verified: false };
  if (u) Object.assign(u, rec); else D.users.push(u = { id: nid('u'), ...rec });
  await issue(u, res);
});

app.post('/api/auth/resend', async (req, res) => {
  const u = D.users.find(x => x.email === clean(req.body.email, 120).toLowerCase() && x.verified === false);
  if (!u) return bad(res, 'No hay una verificación pendiente para ese correo.');
  if (Date.now() - (u.sent || 0) < 3e4) return bad(res, 'Espera unos segundos antes de pedir otro código.');
  await issue(u, res);
});

app.post('/api/auth/verify', (req, res) => {
  const u = D.users.find(x => x.email === clean(req.body.email, 120).toLowerCase());
  if (!u || u.verified !== false || !u.code) return bad(res, 'No hay una verificación pendiente para ese correo.');
  if (Date.now() > u.exp || u.tries >= 5) return bad(res, 'El código venció o se agotaron los intentos. Pide uno nuevo.');
  u.tries++;
  if (!same(String(req.body.code || '').trim(), u.code)) { persist(); return bad(res, 'El código no es correcto.'); }
  u.verified = true; delete u.code; delete u.exp; delete u.tries;
  persist();
  res.json({ token: sign(u.id) });
});

// ---------- Google Workspace UAO (ingreso) + UAO Virtual / Moodle ----------
app.get('/api/config', (req, res) => res.json({ version: VERSION, ejemplo: { email: EJEMPLO.email, password: EJEMPLO.password }, sso: SSO, redirect: SSO ? redirectFor(req) : '', lms: LMS, demo: DEMO, domain: DOMAIN, periodo: PERIODO, portalUrl: process.env.PORTAL_URL || '', moodleUrl: MOODLE.url }));

const pend = {}, codes = {}, b64 = b => b.toString('base64url');
const sweep = o => { const t = Date.now(); for (const k in o) if (o[k].exp < t) delete o[k]; };

app.get('/api/auth/google', (req, res) => {
  if (!SSO) return res.redirect('/#ssoerror=' + encodeURIComponent('El ingreso con Google no está configurado en este servidor.'));
  sweep(pend);
  const state = b64(crypto.randomBytes(16)), nonce = b64(crypto.randomBytes(16)), ver = b64(crypto.randomBytes(32));
  const redirect = redirectFor(req);
  pend[state] = { nonce, ver, redirect, exp: Date.now() + 6e5 };
  const q = new URLSearchParams({
    client_id: G.client, response_type: 'code', redirect_uri: redirect, scope: 'openid email profile', state, nonce,
    code_challenge: b64(crypto.createHash('sha256').update(ver).digest()), code_challenge_method: 'S256', hd: DOMAIN, prompt: 'select_account'
  });
  res.redirect(`${G.auth}?${q}`);
});

const ssoFail = (res, m) => res.redirect('/#ssoerror=' + encodeURIComponent(m));

app.get('/api/auth/google/callback', async (req, res) => {
  try {
    const p = pend[String(req.query.state || '')];
    delete pend[String(req.query.state || '')];
    if (!p || p.exp < Date.now()) return ssoFail(res, 'La sesión de inicio expiró. Inténtalo de nuevo.');
    if (p.kind === 'classroom') return classroomCb(req, res, p);
    if (req.query.error) return ssoFail(res, 'Google no autorizó el ingreso.');
    const r = await fetch(G.token, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: G.client, client_secret: G.secret, grant_type: 'authorization_code', code: String(req.query.code || ''), redirect_uri: p.redirect, code_verifier: p.ver })
    });
    const t = await r.json().catch(() => ({}));
    if (!r.ok || !t.id_token) return ssoFail(res, 'No pudimos validar tu ingreso con Google.');
    const c = JSON.parse(Buffer.from(t.id_token.split('.')[1], 'base64url'));
    if (c.aud !== G.client || c.nonce !== p.nonce || c.exp * 1000 < Date.now() || !/^(https:\/\/)?accounts\.google\.com$/.test(c.iss || '')) return ssoFail(res, 'La respuesta de Google no es válida.');
    const email = String(c.email || '').toLowerCase();
    if (c.email_verified !== true || !inDomain(email) || String(c.hd || '').toLowerCase() !== DOMAIN) {
      console.log('[SSO] Acceso denegado (dominio no institucional):', email || '(sin correo)');
      return ssoFail(res, 'Acceso denegado: solo se permiten cuentas institucionales @' + DOMAIN + '.');
    }
    let u = D.users.find(x => x.email === email);
    if (!u) D.users.push(u = { id: nid('u'), n: clean(c.name, 80) || email.split('@')[0], email, rol: 'Estudiante', pw: hash(crypto.randomBytes(24).toString('hex')), prog: 'UAO', cursos: [], verified: true });
    u.verified = true;
    u.rol = STAFF[email] || 'Estudiante';
    delete u.code;
    giveDemo(u);
    if (MOODLE.token) await syncCourses(u).catch(e => console.log('[Moodle] Error al sincronizar cursos:', e.message));
    persist();
    sweep(codes);
    const code = b64(crypto.randomBytes(24));
    codes[code] = { uid: u.id, exp: Date.now() + 6e4 };
    res.redirect('/#sso=' + code);
  } catch (e) {
    console.log('[SSO]', e.message);
    ssoFail(res, 'No pudimos completar el ingreso. Inténtalo de nuevo.');
  }
});

app.post('/api/auth/exchange', (req, res) => {
  const k = String(req.body.code || ''), c = codes[k];
  delete codes[k];
  if (!c || c.exp < Date.now()) return bad(res, 'El enlace de ingreso venció. Inicia sesión de nuevo.');
  res.json({ token: sign(c.uid) });
});

// Cifrado de credenciales/llaves
const ek = () => crypto.createHash('sha256').update(D.secret + ':moodle').digest();
const enc = t => {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', ek(), iv), x = Buffer.concat([c.update(t, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), x].map(b => b.toString('base64')).join('.');
};
const dec = s => {
  const [iv, tag, x] = s.split('.').map(v => Buffer.from(v, 'base64')), d = crypto.createDecipheriv('aes-256-gcm', ek(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(x), d.final()]).toString('utf8');
};

async function moodle(fn, params, tok) {
  const r = await fetch(MOODLE.url + '/webservice/rest/server.php', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ wstoken: tok || MOODLE.token, wsfunction: fn, moodlewsrestformat: 'json', ...params })
  });
  const d = await r.json();
  if (d && d.exception) throw new Error(d.errorcode || d.message || 'Error de Moodle');
  return d;
}

async function syncCourses(u) {
  if (!LMS) return false;
  let cs;
  if (u.mt) cs = await moodle('core_enrol_get_users_courses', { userid: u.mid }, dec(u.mt));
  else if (MOODLE.token) {
    const us = await moodle('core_user_get_users_by_field', { field: 'email', 'values[0]': u.email });
    if (!us.length) throw new Error('El correo no existe en Moodle');
    u.mid = us[0].id;
    cs = await moodle('core_enrol_get_users_courses', { userid: u.mid });
  } else return false;
  const names = [...new Set(cs.map(c => clean(c.fullname, 100)).filter(Boolean))];
  names.forEach(n => { if (!D.cat.includes(n)) D.cat.push(n); });
  u.cursos = names;
  u.synced = Date.now();
  return true;
}

app.post('/api/me/moodle', auth, async (req, res) => {
  if (!LMS) return res.status(501).json({ error: 'UAO Virtual no está configurado.' });
  const t = clean(req.body.token, 200);
  if (!/^[0-9a-f]{20,64}$/i.test(t)) return bad(res, 'Esa llave no parece válida.');
  try {
    const i = await moodle('core_webservice_get_site_info', {}, t);
    if (!i.userid) throw new Error('Sin usuario');
    req.me.mt = enc(t); req.me.mid = i.userid; delete req.me.demo;
    await syncCourses(req.me);
    persist();
    res.json({ ok: 1, cursos: req.me.cursos });
  } catch { res.status(502).json({ error: 'UAO Virtual no aceptó esa llave.' }); }
});

// Parsers para Calendario (iCal)
const icalOk = v => {
  try {
    const u = new URL(v), m = new URL(MOODLE.url);
    return u.hostname === m.hostname && u.pathname.includes('/calendar/export_execute.php') && u.searchParams.has('userid') && u.searchParams.has('authtoken');
  } catch { return false; }
};
const icsText = x => x.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();
function parseIcs(t) {
  const L = t.replace(/\r?\n[ \t]/g, '').split(/\r?\n/), ev = [];
  let c = null;
  for (const l of L) {
    if (l === 'BEGIN:VEVENT') c = {};
    else if (l === 'END:VEVENT') { if (c && c.n && c.t) ev.push(c); c = null; }
    else if (c) {
      const i = l.indexOf(':');
      if (i < 0) continue;
      const k = l.slice(0, i).split(';')[0].toUpperCase(), v = l.slice(i + 1);
      if (k === 'SUMMARY') c.n = clean(icsText(v), 120);
      else if (k === 'CATEGORIES') c.c = clean(icsText(v), 100);
      else if (k === 'URL') c.url = v.trim();
      else if (k === 'DTSTART') {
        const m = v.match(/^(\d{4})(\d\d)(\d\d)(?:T(\d\d)(\d\d)(\d\d)(Z)?)?/);
        if (m) {
          const ms = Date.UTC(+m[1], m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
          c.t = Math.floor((m[7] || !m[4] ? ms : ms + 5 * 36e5) / 1000);
        }
      }
    }
  }
  return ev;
}
async function readIcal(u) {
  const r = await fetch(dec(u.ical), { redirect: 'follow' });
  if (!r.ok) throw new Error('http ' + r.status);
  const ev = parseIcs(await r.text());
  u.rawc = [...new Set(ev.map(e => e.c).filter(Boolean))];
  const names = rebuildCourses(u).map(e => e.n);
  u.synced = Date.now();
  const now = Date.now() / 1000;
  setSync(u, 'moodle', ev.filter(e => e.t >= now - 864e5).map(e => ({ k: e.n + e.t, n: e.n, s: e.c ? (nameFor(u, e.c) || e.c) : 'Sin materia', t: e.t })));
  return {
    names,
    proximas: ev.filter(e => e.t >= now).sort((a, b) => a.t - b.t).slice(0, 40).map(e => ({
      n: e.n, t: e.t, c: e.c ? (nameFor(u, e.c) || e.c) : '', url: e.url && e.url.startsWith(MOODLE.url) ? e.url : ''
    }))
  };
}

app.post('/api/me/ical', auth, async (req, res) => {
  if (!LMS) return res.status(501).json({ error: 'UAO Virtual no está configurado.' });
  const v = String(req.body.url || '').trim();
  if (!icalOk(v)) return bad(res, 'Ese enlace no es el del calendario de UAO Virtual.');
  try {
    req.me.ical = enc(v);
    const r = await readIcal(req.me);
    delete req.me.demo;
    persist();
    res.json({ ok: 1, cursos: r.names });
  } catch {
    delete req.me.ical;
    res.status(502).json({ error: 'UAO Virtual no aceptó ese enlace. Revisa que sea el del calendario.' });
  }
});

app.delete('/api/me/moodle', auth, (req, res) => {
  delete req.me.mt; delete req.me.mid; delete req.me.ical; delete req.me.rawc;
  setSync(req.me, 'moodle', []);
  rebuildCourses(req.me);
  persist();
  res.json({ ok: 1 });
});

app.post('/api/me/sync', auth, async (req, res) => {
  if (!LMS) return res.status(501).json({ error: 'La conexión con UAO Virtual no está configurada.' });
  try {
    if (req.me.ical && !req.me.mt) { await readIcal(req.me); persist(); return res.json({ ok: 1, cursos: req.me.cursos }); }
    if (!(await syncCourses(req.me))) return res.status(409).json({ error: 'Primero conecta tu cuenta de UAO Virtual (pega el enlace del calendario).' });
    persist();
    res.json({ ok: 1, cursos: req.me.cursos });
  } catch { res.status(502).json({ error: 'No pudimos leer tus cursos de UAO Virtual.' }); }
});

// Sincronización de demostración (sin credenciales reales)
app.post('/api/me/demo/:k', auth, (req, res) => {
  if (!DEMO) return res.status(501).json({ error: 'El modo demostración está desactivado en este servidor.' });
  const u = req.me, k = req.params.k, now = Date.now();
  if (!['moodle', 'classroom', 'portal'].includes(k)) return nf(res);
  if (!u.demo && !(u.mt || u.ical || u.gc)) {
    u.demo = true;
    if (!u.cursos || !u.cursos.length || u.cursos.length === CAT().length) u.cursos = [...INSCRITAS];
  }
  if (k === 'moodle') u.syncM = now;
  if (k === 'classroom') u.syncC = now;
  if (k === 'portal') {
    if (!u.notas || !u.notas.length) u.notas = demoNotas().filter(x => (u.cursos || []).includes(x.m));
    if (!u.notas.length) u.notas = demoNotas();
    u.portalSync = now;
  }
  demoRefresh(u);
  persist();
  res.json({ ok: 1, msg: { moodle: 'UAO Virtual sincronizado (demo).', classroom: 'Google Classroom sincronizado (demo).', portal: 'Notas del Portal sincronizadas (demo).' }[k] });
});

const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : null; };

app.get('/api/me/virtual', auth, async (req, res) => {
  const u = req.me;
  if (LMS && u.ical && !u.mt) {
    try {
      const r = await readIcal(u);
      persist();
      return res.json({ connected: true, mode: 'ical', cursos: rebuildCourses(u).map(e => ({ ...e, progreso: null, total: null, items: [] })), proximas: r.proximas, sync: u.synced });
    } catch { return res.status(502).json({ error: 'No pudimos leer tu calendario de UAO Virtual.' }); }
  }
  if (!LMS || !u.mt) return res.json({ connected: false });
  try {
    const t = dec(u.mt);
    const cs = await moodle('core_enrol_get_users_courses', { userid: u.mid }, t);
    const notas = await Promise.all(cs.map(async c => {
      let items = [], total = null;
      try {
        const g = await moodle('gradereport_user_get_grade_items', { courseid: c.id, userid: u.mid }, t), ug = (g.usergrades || [])[0];
        if (ug) ug.gradeitems.forEach(i => {
          if (i.itemtype === 'course') total = i.gradeformatted;
          else if (i.itemname) items.push({ n: clean(i.itemname, 100), g: String(i.gradeformatted ?? '-').replace(/<[^>]*>/g, ''), p: num(i.percentageformatted) });
        });
      } catch {}
      return { id: c.id, n: clean(c.fullname, 100), progreso: c.progress == null ? null : Math.round(c.progress), total: total == null ? null : String(total).replace(/<[^>]*>/g, ''), items };
    }));
    let ev = [];
    try {
      const e = await moodle('core_calendar_get_action_events_by_timesort', { timesortfrom: Math.floor(Date.now() / 1000), limitnum: 12 }, t);
      ev = (e.events || []).map(x => ({ n: clean(x.name, 120), t: x.timesort, c: clean(x.course && x.course.fullname, 100), url: x.url && String(x.url).startsWith(MOODLE.url) ? x.url : '' }));
    } catch {}
    res.json({ connected: true, cursos: notas, proximas: ev, sync: u.synced || 0 });
  } catch { res.status(502).json({ error: 'No pudimos leer UAO Virtual.' }); }
});

// ---------- Nombres de materias, notas del portal (manuales) y Google Classroom ----------
app.put('/api/me/alias', auth, (req, res) => {
  const k = clean(req.body.k, 60), name = clean(req.body.name, 80);
  if (!rebuildCourses(req.me).some(e => e.k === k)) return bad(res, 'Esa materia no existe en tu lista.');
  req.me.alias = req.me.alias || {};
  if (name) req.me.alias[k] = name; else delete req.me.alias[k];
  rebuildCourses(req.me);
  persist();
  res.json({ ok: 1 });
});
app.post('/api/me/courses/add', auth, (req, res) => {
  const code = clean(req.body.code, 40), name = clean(req.body.name, 80);
  if (!code || !name) return bad(res, 'Escribe el código y el nombre de la materia.');
  if (!req.me.ical) return bad(res, 'Primero conecta tu calendario de UAO Virtual.');
  req.me.manual = (req.me.manual || []).filter(m => m.k !== codeOf(code)).slice(-29);
  req.me.manual.push({ k: codeOf(code), n: name });
  rebuildCourses(req.me);
  persist();
  res.json({ ok: 1 });
});
app.post('/api/me/courses/remove', auth, (req, res) => {
  req.me.manual = (req.me.manual || []).filter(m => m.k !== clean(req.body.k, 60));
  rebuildCourses(req.me);
  persist();
  res.json({ ok: 1 });
});
// Notas manuales: items [{ m, c, n }] o [{ m, c, cortes: [c1, c2, c3] }]
app.put('/api/me/notas', auth, (req, res) => {
  const okN = x => Number.isFinite(x) && x >= 0 && x <= 5;
  const items = (Array.isArray(req.body.items) ? req.body.items : []).slice(0, 30).map(i => {
    const cortes = Array.isArray(i.cortes) && i.cortes.length === 3 ? i.cortes.map(v => r2(num(v))) : null;
    return { m: clean(i.m, 60), c: Math.round(parseFloat(i.c)), cortes: cortes || undefined, n: cortes ? defOf(cortes) : r2(num(i.n)) };
  });
  if (items.some(i => !i.m || !(i.c >= 1 && i.c <= 12) || !okN(i.n) || (i.cortes && !i.cortes.every(okN)))) return bad(res, 'Revisa los datos: materia, créditos (1 a 12) y notas (0 a 5).');
  req.me.notas = items;
  persist();
  res.json({ ok: 1 });
});

const CR_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/classroom.courses.readonly', 'https://www.googleapis.com/auth/classroom.coursework.me.readonly', 'https://www.googleapis.com/auth/classroom.student-submissions.me.readonly'].join(' ');
const CR_API = process.env.GOOGLE_CLASSROOM_URL || 'https://classroom.googleapis.com/v1';
app.post('/api/me/classroom/start', auth, (req, res) => {
  if (!SSO) return res.status(501).json({ error: 'El ingreso con Google no está configurado en este servidor.' });
  sweep(pend);
  const state = b64(crypto.randomBytes(16)), nonce = b64(crypto.randomBytes(16)), ver = b64(crypto.randomBytes(32));
  const redirect = redirectFor(req);
  pend[state] = { kind: 'classroom', uid: req.me.id, nonce, ver, redirect, exp: Date.now() + 6e5 };
  const q = new URLSearchParams({ client_id: G.client, response_type: 'code', redirect_uri: redirect, scope: CR_SCOPES, state, nonce, code_challenge: b64(crypto.createHash('sha256').update(ver).digest()), code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent', login_hint: req.me.email, hd: DOMAIN });
  res.json({ url: `${G.auth}?${q}` });
});
async function classroomCb(req, res, p) {
  const back = ok => res.redirect(ok ? '/#cursos' : '/?classroom=error#cursos');
  try {
    if (req.query.error) return back(false);
    const r = await fetch(G.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: G.client, client_secret: G.secret, grant_type: 'authorization_code', code: String(req.query.code || ''), redirect_uri: p.redirect, code_verifier: p.ver }) });
    const t = await r.json().catch(() => ({}));
    const u = D.users.find(x => x.id === p.uid);
    if (!r.ok || !t.refresh_token || !t.id_token || !u) return back(false);
    const c = JSON.parse(Buffer.from(t.id_token.split('.')[1], 'base64url'));
    if (c.aud !== G.client || c.nonce !== p.nonce || c.exp * 1000 < Date.now() || c.email_verified !== true || String(c.email || '').toLowerCase() !== u.email) return back(false);
    if (t.scope && !String(t.scope).includes('classroom.courses.readonly')) return back(false);
    u.gc = enc(t.refresh_token);
    delete u.demo;
    persist();
    back(true);
  } catch (e) { console.log('[Classroom]', e.message); back(false); }
}
async function crToken(u) {
  const r = await fetch(G.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: G.client, client_secret: G.secret, grant_type: 'refresh_token', refresh_token: dec(u.gc) }) });
  const t = await r.json().catch(() => ({}));
  if (!r.ok || !t.access_token) { const e = new Error(t.error || 'token'); e.revoked = t.error === 'invalid_grant'; throw e; }
  return t.access_token;
}
async function crGet(p, tok) {
  const r = await fetch(CR_API + p, { headers: { Authorization: 'Bearer ' + tok } });
  if (!r.ok) { const e = new Error('http ' + r.status); e.status = r.status; throw e; }
  return r.json();
}
const crDue = w => w.dueDate ? Date.UTC(w.dueDate.year, w.dueDate.month - 1, w.dueDate.day, (w.dueTime && w.dueTime.hours) || 23, (w.dueTime && w.dueTime.minutes) || 59) / 1000 : null;
app.get('/api/me/classroom', auth, async (req, res) => {
  const u = req.me;
  if (!u.gc) return res.json({ connected: false });
  try {
    const tok = await crToken(u);
    const cs = (await crGet('/courses?studentId=me&courseStates=ACTIVE&pageSize=40', tok)).courses || [];
    const now = Date.now() / 1000, prox = [];
    const cursos = await Promise.all(cs.map(async c => {
      const [w, s] = await Promise.all([
        crGet(`/courses/${encodeURIComponent(c.id)}/courseWork?pageSize=40`, tok).catch(() => ({})),
        crGet(`/courses/${encodeURIComponent(c.id)}/courseWork/-/studentSubmissions?userId=me&pageSize=60`, tok).catch(() => ({}))
      ]);
      const sub = Object.fromEntries((s.studentSubmissions || []).map(x => [x.courseWorkId, x]));
      const items = [];
      (w.courseWork || []).forEach(cw => {
        const sb = sub[cw.id] || {}, due = crDue(cw), done = sb.state === 'TURNED_IN' || sb.state === 'RETURNED';
        items.push({ n: clean(cw.title, 100), g: sb.assignedGrade ?? null, max: cw.maxPoints ?? null, due, done });
        if (due && due >= now && !done) prox.push({ n: clean(cw.title, 120), t: due, c: clean(c.name, 100), url: String(cw.alternateLink || '').startsWith('https://classroom.google.com/') ? cw.alternateLink : '' });
      });
      const gr = items.filter(i => i.g != null && i.max);
      const total = gr.length ? Math.round(gr.reduce((a, i) => a + i.g / i.max, 0) / gr.length * 1000) / 10 : null;
      return { id: c.id, n: clean(c.name, 100), sec: clean(c.section, 60), items, total };
    }));
    u.gcn = cursos.map(c => c.n);
    setSync(u, 'classroom', prox.map(p => ({ k: p.n + p.t + p.c, n: p.n, s: p.c, t: p.t })));
    rebuildCourses(u);
    persist();
    res.json({ connected: true, cursos, proximas: prox.sort((a, b) => a.t - b.t).slice(0, 40) });
  } catch (e) {
    if (e.revoked) { delete u.gc; delete u.gcn; rebuildCourses(u); persist(); return res.status(409).json({ error: 'Google pidió que vuelvas a conectar Classroom.' }); }
    res.status(502).json({ error: e.status === 403 ? 'Classroom no está habilitado en tu proyecto de Google Cloud o la UAO lo bloquea.' : 'No pudimos leer Google Classroom. Inténtalo más tarde.' });
  }
});
app.delete('/api/me/classroom', auth, async (req, res) => {
  const u = req.me;
  if (u.gc) { try { await fetch((process.env.GOOGLE_REVOKE_URL || 'https://oauth2.googleapis.com/revoke') + '?token=' + encodeURIComponent(dec(u.gc)), { method: 'POST' }); } catch {} }
  delete u.gc; delete u.gcn;
  setSync(u, 'classroom', []);
  rebuildCourses(u);
  persist();
  res.json({ ok: 1 });
});

app.put('/api/me/courses', auth, (req, res) => {
  if (LMS && (req.me.mt || req.me.ical)) return res.status(403).json({ error: 'Tus asignaturas vienen de UAO Virtual.' });
  const c = (Array.isArray(req.body.cursos) ? req.body.cursos : []).filter(x => CAT().includes(x));
  if (!c.length) return bad(res, 'Elige al menos una asignatura.');
  req.me.cursos = c;
  persist();
  res.json({ ok: 1 });
});

app.get('/api/bootstrap', auth, (req, res) => { demoRefresh(req.me); res.json(view(req.me)); });

// ---------- Foro de dudas ----------
app.post('/api/questions', auth, (req, res) => {
  const b = req.body || {}, t = clean(b.t, 150), d = clean(b.d, 2000);
  if (!t || !d) return bad(res, 'Escribe el título y la descripción.');
  const q = { id: nid('q'), t, s: CAT().includes(b.s) ? b.s : (CAT()[0] || 'General'), d, f: today(), st: 'Sin respuesta', au: b.anon ? 'Anónimo' : req.me.n, tags: [clean(b.tema, 40) || 'general'], a: [], uid: req.me.id };
  D.q.push(q);
  persist();
  res.json({ id: q.id });
});
app.post('/api/questions/:id/answers', auth, (req, res) => {
  const q = Q(req.params.id), x = clean(req.body.x, 2000);
  if (!q) return nf(res);
  if (!x) return bad(res, 'Escribe tu respuesta.');
  q.a.push({ by: req.me.rol, n: req.me.n, x, v: [], uid: req.me.id });
  if (q.st === 'Sin respuesta') q.st = 'En discusión';
  if (q.uid !== req.me.id) notify(q.uid, 'Alguien respondió tu duda.', 'dudas/' + q.id);
  persist();
  res.json({ ok: 1 });
});
app.post('/api/questions/:id/answers/:i/useful', auth, (req, res) => {
  const q = Q(req.params.id), a = q && q.a[+req.params.i];
  if (!a) return nf(res);
  a.v = a.v || [];
  const i = a.v.indexOf(req.me.id);
  i < 0 ? a.v.push(req.me.id) : a.v.splice(i, 1);
  persist();
  res.json({ ok: 1 });
});
app.post('/api/questions/:id/solution', auth, (req, res) => {
  const q = Q(req.params.id), a = q && q.a[+req.body.i];
  if (!a) return nf(res);
  if (!canMod(q, req.me)) return res.status(403).json({ error: 'No tienes permiso.' });
  q.a.forEach(x => x.sol = 0);
  if (req.body.off) { if (q.st === 'Resuelta') q.st = 'En discusión'; }
  else { a.sol = 1; q.st = 'Resuelta'; notify(a.uid, 'Tu respuesta fue marcada como solución.', 'dudas/' + q.id); }
  persist();
  res.json({ ok: 1 });
});
app.patch('/api/questions/:id', auth, (req, res) => {
  const q = Q(req.params.id);
  if (!q) return nf(res);
  if (!canMod(q, req.me)) return res.status(403).json({ error: 'No tienes permiso.' });
  if (!['Sin respuesta', 'En discusión', 'Resuelta'].includes(req.body.st)) return bad(res, 'Estado no válido.');
  q.st = req.body.st;
  if (q.st !== 'Resuelta') q.a.forEach(x => x.sol = 0);
  persist();
  res.json({ ok: 1 });
});

// ---------- Asesorías ----------
app.post('/api/advisories', auth, need('Estudiante'), (req, res) => {
  const p = D.users.find(u => u.id === +req.body.p && u.rol !== 'Estudiante'), tema = clean(req.body.tema, 100), msg = clean(req.body.msg, 1000);
  if (!p) return bad(res, 'Elige a un docente o monitor.');
  if (!tema || !msg) return bad(res, 'Escribe el tema y el mensaje.');
  D.A.push({ id: nid('a'), p: p.id, pn: p.n, uid: req.me.id, by: req.me.n, tema, msg, mod: clean(req.body.mod, 20), hor: clean(req.body.hor, 60), f: today(), st: 'Pendiente' });
  notify(p.id, 'Nueva solicitud de asesoría de ' + req.me.n + '.', 'rutas');
  persist();
  res.json({ ok: 1 });
});
app.patch('/api/advisories/:id', auth, need('Docente', 'Monitor'), (req, res) => {
  const a = D.A.find(x => x.id === +req.params.id && x.p === req.me.id);
  if (!a) return nf(res);
  if (!['Aceptada', 'Rechazada', 'Completada'].includes(req.body.st)) return bad(res, 'Estado no válido.');
  a.st = req.body.st;
  notify(a.uid, 'Tu solicitud de asesoría fue ' + a.st.toLowerCase() + '.', 'rutas');
  persist();
  res.json({ ok: 1 });
});

// ---------- Recursos (con archivo opcional de hasta 3 MB) ----------
const RTYPES = ['Guía', 'Documento', 'Apunte', 'Enlace', 'Material de estudio', 'Taller', 'Otro'];
app.post('/api/resources', auth, need('Docente', 'Monitor'), (req, res) => {
  const b = req.body || {}, n = clean(b.n, 120);
  if (!n) return bad(res, 'Escribe el nombre del recurso.');
  const id = nid('r');
  let file;
  if (b.data) {
    const m = String(b.data).match(/^data:([\w.+\/-]*)?(;base64)?,(.*)$/s);
    if (!m || !m[2]) return bad(res, 'El archivo no es válido.');
    const buf = Buffer.from(m[3], 'base64');
    if (buf.length > 3e6) return bad(res, 'El archivo supera 3 MB.');
    try {
      fs.mkdirSync(UPLOADS, { recursive: true });
      const key = 'r' + id + '-' + crypto.randomBytes(6).toString('hex');
      fs.writeFileSync(path.join(UPLOADS, key), buf);
      file = { name: clean(b.fname, 120).replace(/[\\/:*?"<>|]+/g, '_') || 'archivo', size: buf.length, type: m[1] || 'application/octet-stream', key };
    } catch (e) { console.log('[recursos]', e.message); return res.status(500).json({ error: 'No se pudo guardar el archivo.' }); }
  }
  D.R.push({ id, n, s: CAT().includes(b.s) ? b.s : (CAT()[0] || 'General'), ty: RTYPES.includes(b.ty) ? b.ty : 'Documento', d: clean(b.d, 400) || 'Sin descripción', f: today(), au: req.me.n, ...(file ? { file } : {}) });
  persist();
  res.json({ ok: 1 });
});
app.get('/api/resources/:id/download', auth, (req, res) => {
  const r = D.R.find(x => x.id === +req.params.id);
  if (!r) return nf(res);
  if (r.file && r.file.key) {
    const p = path.join(UPLOADS, path.basename(r.file.key));
    if (fs.existsSync(p)) { res.type(r.file.type || 'application/octet-stream'); return res.download(p, r.file.name); }
  }
  // Recurso sin archivo (o archivo perdido tras reinicio en Render): ficha en texto
  const base = (r.n.normalize('NFD').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'recurso') + '.txt';
  const txt = [r.n, '', 'Asignatura: ' + r.s, 'Tipo: ' + r.ty, 'Publicado: ' + r.f + (r.au ? ' por ' + r.au : ''), '', r.d, r.url ? '\nEnlace: ' + r.url : '', '', '— UAO Conecta (recurso de demostración)'].join('\n');
  res.set({ 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="${base}"` });
  res.send(txt);
});

// ---------- Grupos, tareas, acuerdos, guardados, entregas ----------
app.post('/api/groups', auth, (req, res) => {
  const n = clean(req.body.n, 80);
  if (!n) return bad(res, 'Escribe el nombre de la comunidad.');
  D.G.push({ id: nid('g'), n, s: CAT().includes(req.body.s) ? req.body.s : (CAT()[0] || 'General'), m: [req.me.id], o: [] });
  persist();
  res.json({ ok: 1 });
});
const tog = (arr, v) => { const i = arr.indexOf(v); i < 0 ? arr.push(v) : arr.splice(i, 1); };
app.post('/api/groups/:id/join', auth, (req, res) => {
  const g = D.G.find(x => x.id === +req.params.id);
  if (!g) return nf(res);
  tog(g.m, req.me.id);
  persist();
  res.json({ ok: 1 });
});
app.post('/api/groups/:id/orient', auth, need('Monitor'), (req, res) => {
  const g = D.G.find(x => x.id === +req.params.id);
  if (!g) return nf(res);
  tog(g.o, req.me.id);
  persist();
  res.json({ ok: 1 });
});
app.post('/api/tasks', auth, (req, res) => {
  const n = clean(req.body.n, 120);
  if (!n) return bad(res, 'Escribe el nombre de la tarea.');
  D.T.push({ id: nid('t'), n, w: clean(req.body.w, 80) || req.me.n, d: clean(req.body.d, 30) || 'Sin fecha', st: 'Pendiente' });
  persist();
  res.json({ ok: 1 });
});
app.patch('/api/tasks/:id', auth, (req, res) => {
  const t = D.T.find(x => x.id === +req.params.id);
  if (!t) return nf(res);
  if (!['Pendiente', 'En proceso', 'Completada'].includes(req.body.st)) return bad(res, 'Estado no válido.');
  t.st = req.body.st;
  persist();
  res.json({ ok: 1 });
});
app.post('/api/files', auth, (req, res) => {
  const n = clean(req.body.n, 120);
  if (!n) return bad(res, 'Escribe el acuerdo.');
  D.F.unshift({ id: nid('f'), n: 'Acuerdo: ' + n, au: req.me.n, f: today(), ty: 'Acuerdo' });
  persist();
  res.json({ ok: 1 });
});
app.post('/api/saved', auth, (req, res) => {
  const k = String(req.body.k || '');
  if (!/^[qrp]\d{1,6}$/.test(k)) return bad(res, 'Elemento no válido.');
  const i = D.sv.findIndex(s => s.uid === req.me.id && s.k === k);
  i < 0 ? D.sv.push({ uid: req.me.id, k }) : D.sv.splice(i, 1);
  persist();
  res.json({ on: i < 0 });
});
app.post('/api/deliveries', auth, (req, res) => {
  const n = clean(req.body.n, 120), due = String(req.body.due || '');
  if (!n || !/^\d{4}-\d\d-\d\d$/.test(due)) return bad(res, 'Escribe el nombre y la fecha límite.');
  (req.me.ent = req.me.ent || []).push({ id: nid('e'), n, s: clean(req.body.s, 100) || 'General', due: due + 'T23:59:00', st: 'Pendiente' });
  persist();
  res.json({ ok: 1 });
});
app.post('/api/deliveries/:id/toggle', auth, (req, res) => {
  const id = +req.params.id, e = (req.me.ent || []).find(x => x.id === id);
  if (e) e.st = e.st === 'Entregada' ? 'Pendiente' : 'Entregada';
  else if ((req.me.sy || []).some(x => x.id === id)) tog(req.me.done = req.me.done || [], id);
  else return nf(res);
  persist();
  res.json({ ok: 1 });
});
app.post('/api/notifications/read', auth, (req, res) => {
  D.N.forEach(n => { if (n.uid === req.me.id) n.r = 1; });
  persist();
  res.json({ ok: 1 });
});

// ---------- 404 de API, errores y fallback del frontend ----------
app.use('/api', (req, res) => nf(res));
app.use((e, req, res, next) => {
  if (e && e.type === 'entity.too.large') return res.status(413).json({ error: 'La solicitud es demasiado grande (máx. 3 MB por archivo).' });
  if (e && e.type === 'entity.parse.failed') return res.status(400).json({ error: 'Solicitud no válida.' });
  console.log('[error]', e && e.message);
  res.status(500).json({ error: 'Error interno del servidor.' });
});
app.get('*', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html'), err => { if (err) res.status(404).send('Falta public/index.html'); }));

app.listen(PORT, '0.0.0.0', () => {
  console.log('UAO Conecta v' + VERSION + ' escuchando en el puerto ' + PORT);
  console.log('  Cuenta de ejemplo: ' + EJEMPLO.email + ' / ' + EJEMPLO.password);
  console.log('  Modo demostración: ' + (DEMO ? 'ACTIVO (cuentas *@demo.uao, clave ' + DEMO_PW + ')' : 'desactivado'));
  console.log(SSO ? '  Ingreso con Google (@' + DOMAIN + '): ACTIVO · callback: ' + (G.redirect || process.env.RENDER_EXTERNAL_URL && process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '') + CB_PATH || 'según el host de la petición') : '  Ingreso con Google: faltan GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET');
  console.log('  UAO Virtual: ' + MOODLE.url);
  if (!fs.existsSync(path.join(PUBLIC_DIR, 'index.html'))) console.log('  ⚠ No se encontró public/index.html (revisa mayúsculas/minúsculas de la carpeta).');
});
process.on('SIGTERM', () => { persist(); process.exit(0); });