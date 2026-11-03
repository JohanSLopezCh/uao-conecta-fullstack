// UAO Conecta · backend de demostración e integración real (Express + persistencia en data.json)
const express = require('express'),
      crypto = require('crypto'),
      fs = require('fs'),
      path = require('path');

// Carga .env sin dependencias (las variables ya definidas en el entorno tienen prioridad)
try {
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8')
    .split(/\r?\n/)
    .forEach(l => {
      const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !l.trim().startsWith('#') && !(m[1] in process.env)) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    });
} catch {}

const PORT = process.env.PORT || 3000;
const FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const SUBJ = ['Cálculo I', 'Programación', 'Física I', 'Matemáticas'];
const DOMAIN = (process.env.ALLOWED_DOMAIN || 'uao.edu.co').toLowerCase();
const STAFF = Object.fromEntries(
  (process.env.STAFF_EMAILS || '')
    .split(',')
    .map(x => x.trim().toLowerCase().split(':'))
    .filter(a => a[0] && ['docente', 'monitor'].includes(a[1]))
    .map(a => [a[0], a[1][0].toUpperCase() + a[1].slice(1)])
);
const DEMO = process.env.DEMO_MODE === '1';

const G = {
  client: process.env.GOOGLE_CLIENT_ID || '',
  secret: process.env.GOOGLE_CLIENT_SECRET || '',
  redirect: process.env.GOOGLE_REDIRECT_URI || '',
  auth: process.env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth',
  token: process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token'
};
const SSO = !!(G.client && G.secret && G.redirect);

const MOODLE = {
  url: (process.env.MOODLE_URL || 'https://campus.uaovirtual.edu.co').replace(/\/$/, ''),
  token: process.env.MOODLE_TOKEN || ''
};
const LMS = !!MOODLE.url;

let mail = null;
try {
  if (process.env.SMTP_URL) mail = require('nodemailer').createTransport(process.env.SMTP_URL);
} catch {}

async function sendCode(to, code) {
  if (mail) {
    await mail.sendMail({
      from: process.env.MAIL_FROM || 'UAO Conecta <no-reply@uao-conecta.local>',
      to,
      subject: 'Tu código de verificación de UAO Conecta',
      text: `Tu código es ${code}. Vence en 15 minutos. Si no fuiste tú, ignora este mensaje.`
    });
  } else {
    console.log(`[modo demostración] Código para ${to}: ${code}`);
  }
}

const hash = (p, s = crypto.randomBytes(16).toString('hex')) => s + ':' + crypto.scryptSync(String(p), s, 32).toString('hex');
const same = (p, h) => {
  const a = Buffer.from(hash(p, h.split(':')[0]));
  const b = Buffer.from(h);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

function seed() {
  const U = (id, n, email, rol, x = {}) => ({
    id, n, email, rol, pw: hash('demo1234'), prog: 'Ingeniería (demo)', cursos: [...SUBJ], verified: true, ...x
  });
  return {
    secret: crypto.randomBytes(32).toString('hex'),
    seq: { u: 5, q: 3, r: 3, g: 3, t: 3, f: 3, a: 0 },
    users: !DEMO ? [] : [
      U(1, 'Estudiante Demo', 'estudiante@demo.uao', 'Estudiante'),
      U(2, 'Prof. Marta Ospina (demo)', 'docente@demo.uao', 'Docente', { s: 'Cálculo I', disp: 'Lun y mié 2–4 p. m.', mod: 'Presencial', info: 'Orientación en límites y derivadas.' }),
      U(3, 'Andrés Mejía (demo)', 'monitor@demo.uao', 'Monitor', { s: 'Cálculo I', disp: 'Mar 3–4 p. m.', mod: 'Presencial', info: 'Apoyo en límites y derivadas.' }),
      U(4, 'Prof. Ricardo Vélez (demo)', 'docente2@demo.uao', 'Docente', { s: 'Programación', disp: 'Jue 10 a. m.–12 m.', mod: 'Virtual', info: 'Orientación en estructuras de datos.' }),
      U(5, 'Valeria Cruz (demo)', 'monitor2@demo.uao', 'Monitor', { s: 'Programación', disp: 'Mié 10–11 a. m.', mod: 'Virtual', info: 'Apoyo en Python y pilas/colas.' })
    ],
    q: [
      { id: 1, t: "¿Cómo resuelvo este límite con L'Hôpital?", s: 'Cálculo I', d: 'Aparece 0/0 y no sé cuándo derivar.', f: '28 sep', st: 'Resuelta', au: 'Camila R.', tags: ['límites'], uid: 0, a: [{ by: 'Monitor', n: 'Andrés Mejía (demo)', x: 'Deriva numerador y denominador por separado; solo aplica si queda 0/0 o ∞/∞.', v: [-1, -2, -3], sol: 1, uid: 3 }] },
      { id: 2, t: '¿Diferencia entre pila y cola?', s: 'Programación', d: 'Me confundo con LIFO y FIFO.', f: '27 sep', st: 'En discusión', au: 'Anónimo', tags: ['estructuras'], uid: 0, a: [{ by: 'Estudiante', n: 'Laura P.', x: 'Pila: el último en entrar sale primero. Cola: el primero en entrar sale primero.', v: [-1], uid: 0 }] },
      { id: 3, t: '¿Cómo se descompone un vector en componentes?', s: 'Física I', d: 'No entiendo cuándo usar seno o coseno.', f: '26 sep', st: 'Sin respuesta', au: 'Anónimo', tags: ['vectores'], uid: 0, a: [] }
    ],
    R: [
      { id: 1, n: 'Guía de límites', s: 'Cálculo I', ty: 'Guía', d: 'Ejercicios resueltos paso a paso.', f: '20 sep' },
      { id: 2, n: 'Apuntes de estructuras de datos', s: 'Programación', ty: 'Apunte', d: 'Pilas, colas y listas.', f: '18 sep' },
      { id: 3, n: 'Formulario de vectores', s: 'Física I', ty: 'Documento', d: 'Resumen de fórmulas.', f: '15 sep' }
    ],
    G: [
      { id: 1, n: 'Grupo de Cálculo', s: 'Cálculo I', m: [1, -2, -3], o: [] },
      { id: 2, n: 'Grupo de Programación', s: 'Programación', m: [-1, -2, -3, -4, -5], o: [] },
      { id: 3, n: 'Física para primeros semestres', s: 'Física I', m: [-1, -2, -3, -4], o: [] }
    ],
    T: [
      { id: 1, n: 'Resolver ejercicios 1–5', w: 'Camila R.', d: '2 oct', st: 'En proceso' },
      { id: 2, n: 'Armar presentación', w: 'Laura P.', d: '4 oct', st: 'Pendiente' },
      { id: 3, n: 'Revisar informe', w: 'Estudiante Demo', d: '30 sep', st: 'Completada' }
    ],
    F: [
      { id: 1, n: 'Acuerdo: reunirse martes', au: 'Estudiante Demo', f: '27 sep', ty: 'Acuerdo' },
      { id: 2, n: 'Apuntes de clase 5', au: 'Camila R.', f: '26 sep', ty: 'Apunte' },
      { id: 3, n: 'Enlace a hoja compartida', au: 'Laura P.', f: '25 sep', ty: 'Enlace' }
    ],
    A: [], N: [], sv: [], cat: [...SUBJ]
  };
}

const fresh = !fs.existsSync(FILE);
let D = fresh ? seed() : JSON.parse(fs.readFileSync(FILE, 'utf8'));
D.cat = D.cat || [...SUBJ];
D.seq.u = D.seq.u || 0;
const persist = () => fs.writeFileSync(FILE, JSON.stringify(D, null, 1));
if (fresh) persist();

const nid = k => (D.seq[k] = (D.seq[k] || 0) + 1);
const clean = (s, n = 500) => String(s ?? '').trim().slice(0, n);
const today = () => new Date().toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }).replace('.', '');
const bad = (res, m) => res.status(400).json({ error: m });
const nf = res => res.status(404).json({ error: 'No encontrado.' });
const notify = (uid, x, h) => { if (uid > 0) D.N.push({ uid, x, r: 0, h }); };

const sign = u => {
  const b = Buffer.from(JSON.stringify({ u, e: Date.now() + 7 * 864e5 })).toString('base64url');
  return b + '.' + crypto.createHmac('sha256', D.secret).update(b).digest('base64url');
};
const unsign = t => {
  const [b, s] = String(t || '').split('.');
  if (!b || !s || crypto.createHmac('sha256', D.secret).update(b).digest('base64url') !== s) return;
  try {
    const p = JSON.parse(Buffer.from(b, 'base64url'));
    return p.e > Date.now() ? p.u : undefined;
  } catch { }
};

const auth = (req, res, next) => {
  const u = D.users.find(x => x.id === unsign((req.headers.authorization || '').slice(7)));
  if (!u) return res.status(401).json({ error: 'Inicia sesión para continuar.' });
  req.me = u;
  next();
};

const need = (...r) => (req, res, next) => r.includes(req.me.rol) ? next() : res.status(403).json({ error: 'Tu rol no permite esta acción.' });
const CAT = () => D.cat;
// Diccionario opcional código -> nombre (materias.json) y nombres propios de cada estudiante
let MAT = {};
try { MAT = JSON.parse(fs.readFileSync(process.env.MATERIAS_FILE || path.join(__dirname, 'materias.json'), 'utf8')); } catch {}
const codeOf = s => { const m = String(s).match(/^\s*(\d{3,})/); return m ? m[1] : String(s).trim(); };
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

// ---- Datos derivados para el frontend: fuentes, notas (portal) y entregas ----
const iso = s => new Date(s * 1000).toISOString();
const sid = k => 1e9 + parseInt(crypto.createHash('sha1').update(k).digest('hex').slice(0, 7), 16);
const setSync = (u, src, items) => {
  u.sy = (u.sy || []).filter(e => e.src !== src).concat(items.slice(0, 80).map(i => ({ id: sid(src + i.k), n: i.n, s: i.s, due: iso(i.t), src })));
};
const srcOf = u => {
  const lms = !!(u.mt || u.ical), names = u.cursos || [], gc = u.gcn || [];
  return {
    moodle: { conectado: lms, cursos: lms ? names.filter(n => !gc.includes(n)).map(n => ({ n })) : [], sync: u.synced ? new Date(u.synced).toLocaleString('es-CO') : '' },
    classroom: { conectado: !!u.gc, cursos: gc.map(n => ({ n })) },
    manual: lms || u.gc ? [] : names.map(n => ({ n }))
  };
};
const portalOf = u => {
  const n = u.notas || [];
  if (!n.length) return null;
  const cr = n.reduce((a, i) => a + i.c, 0), prom = n.reduce((a, i) => a + i.c * i.n, 0) / cr;
  return { notas: n.map(i => ({ s: i.m, cod: '', cr: i.c, n: [], def: i.n })), sem: prom, prom, cred: n.filter(i => i.n >= 3).reduce((a, i) => a + i.c, 0), credTot: cr, sync: 'manualmente' };
};
const entregasOf = u => [
  ...(u.ent || []).map(e => ({ ...e, src: 'manual' })),
  ...(u.sy || []).map(e => ({ ...e, st: (u.done || []).includes(e.id) ? 'Entregada' : 'Pendiente' }))
];

const view = me => ({
  me: {
    id: me.id,
    n: me.n,
    prog: me.prog,
    rol: me.rol,
    cursos: DEMO ? (me.cursos && me.cursos.length ? me.cursos : [...CAT()]) : (me.cursos || []),
    cat: CAT(),
    managed: !!(me.mt || me.ical),
    mc: !!(me.mt || me.ical),
    gc: !!me.gc,
    notas: me.notas || [],
    email: me.email,
    fuentes: srcOf(me),
    portal: portalOf(me)
  },
  q: D.q.map(q => ({
    id: q.id, t: q.t, s: q.s, d: q.d, f: q.f, st: q.st, au: q.au, tags: q.tags, mine: q.uid === me.id, can: canMod(q, me),
    a: q.a.map((a, i) => ({ id: i, by: a.by, n: a.n, x: a.x, u: (a.v || []).length, vm: (a.v || []).includes(me.id), sol: a.sol }))
  })),
  R: D.R,
  G: D.G.map(g => ({ id: g.id, n: g.n, s: g.s, m: g.m.length, j: +g.m.includes(me.id), o: me.rol === 'Monitor' ? +g.o.includes(me.id) : +(g.o.length > 0) })),
  A: D.A.filter(a => me.rol === 'Estudiante' ? a.uid === me.id : a.p === me.id).map(a => ({ id: a.id, p: a.p, by: a.by, pn: a.pn, tema: a.tema, msg: a.msg, st: a.st, mod: a.mod, hor: a.hor, f: a.f })),
  T: D.T,
  E: entregasOf(me),
  F: D.F,
  N: D.N.filter(n => n.uid === me.id).map(({ x, r, h }) => ({ x, r, h })).reverse(),
  sv: D.sv.filter(s => s.uid === me.id).map(s => s.k),
  P: D.users.filter(u => u.rol !== 'Estudiante' && u.verified !== false).map(u => ({ id: u.id, n: u.n, r: u.rol, s: u.s || 'General', disp: u.disp || 'Por definir', mod: u.mod || 'Por definir', info: u.info || '' }))
});

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const tries = {};
const ssoOnly = (req, res, next) => SSO && !DEMO ? res.status(400).json({ error: 'Entra con tu cuenta institucional de Google.' }) : next();
['login', 'register', 'resend', 'verify'].forEach(a => app.post('/api/auth/' + a, ssoOnly));

app.post('/api/auth/login', (req, res, next) => {
  const t = Date.now(), k = req.ip;
  tries[k] = (tries[k] || []).filter(x => t - x < 6e5);
  if (tries[k].length >= 10) return res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos.' });
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
  u.code = hash(code);
  u.exp = Date.now() + 9e5;
  u.tries = 0;
  u.sent = Date.now();
  persist();
  try {
    await sendCode(u.email, code);
  } catch {
    return res.status(502).json({ error: 'No pudimos enviar el código al correo. Inténtalo de nuevo más tarde.' });
  }
  res.json({ pending: true, email: u.email, ...dev(code) });
}

app.post('/api/auth/register', async (req, res) => {
  const b = req.body || {}, e = clean(b.email, 120).toLowerCase(), n = clean(b.n, 80);
  if (!n || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || String(b.password || '').length < 8) return bad(res, 'Escribe tu nombre, tu correo institucional y una contraseña de al menos 8 caracteres.');
  if (!e.endsWith('@' + DOMAIN)) return bad(res, 'Usa tu correo institucional (@' + DOMAIN + ').');
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
  if (!same(String(req.body.code || '').trim(), u.code)) {
    persist();
    return bad(res, 'El código no es correcto.');
  }
  u.verified = true;
  delete u.code;
  delete u.exp;
  delete u.tries;
  persist();
  res.json({ token: sign(u.id) });
});

// ---------- Integración institucional: Google Workspace UAO (ingreso) + UAO Virtual / Moodle ----------
app.get('/api/config', (req, res) => res.json({ sso: SSO, lms: LMS, demo: DEMO, domain: DOMAIN, portalUrl: process.env.PORTAL_URL || '', moodleUrl: MOODLE.url }));

const pend = {}, codes = {}, b64 = b => b.toString('base64url');
const sweep = o => { const t = Date.now(); for (const k in o) if (o[k].exp < t) delete o[k]; };

app.get('/api/auth/google', (req, res) => {
  if (!SSO) return res.status(501).send('El ingreso con Google no está configurado en este servidor.');
  sweep(pend);
  const state = b64(crypto.randomBytes(16)), nonce = b64(crypto.randomBytes(16)), ver = b64(crypto.randomBytes(32));
  pend[state] = { nonce, ver, popup: req.query.popup === '1', exp: Date.now() + 6e5 };
  const q = new URLSearchParams({
    client_id: G.client, response_type: 'code', redirect_uri: G.redirect, scope: 'openid email profile', state, nonce,
    code_challenge: b64(crypto.createHash('sha256').update(ver).digest()), code_challenge_method: 'S256', hd: DOMAIN, prompt: 'select_account'
  });
  res.redirect(`${G.auth}?${q}`);
});

const ssoFail = (res, m) => res.redirect('/#ssoerror=' + encodeURIComponent(m) + (res.locals.popup ? '&popup=1' : ''));

app.get('/api/auth/google/callback', async (req, res) => {
  try {
    const p = pend[String(req.query.state || '')];
    delete pend[String(req.query.state || '')];
    res.locals.popup = !!(p && p.popup);
    if (!p || p.exp < Date.now()) return ssoFail(res, 'La sesión de inicio expiró. Inténtalo de nuevo.');
    if (p.kind === 'classroom') return classroomCb(req, res, p);
    if (req.query.error) return ssoFail(res, 'Google no autorizó el ingreso.');
    const r = await fetch(G.token, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: G.client, client_secret: G.secret, grant_type: 'authorization_code', code: String(req.query.code || ''), redirect_uri: G.redirect, code_verifier: p.ver })
    });
    const t = await r.json().catch(() => ({}));
    if (!r.ok || !t.id_token) return ssoFail(res, 'No pudimos validar tu ingreso con Google.');
    const c = JSON.parse(Buffer.from(t.id_token.split('.')[1], 'base64url'));
    if (c.aud !== G.client || c.nonce !== p.nonce || c.exp * 1000 < Date.now() || !/^(https:\/\/)?accounts\.google\.com$/.test(c.iss || '')) return ssoFail(res, 'La respuesta de Google no es válida.');
    const email = String(c.email || '').toLowerCase();
    if (c.email_verified !== true || c.hd !== DOMAIN || !email.endsWith('@' + DOMAIN)) return ssoFail(res, 'Solo se permiten cuentas institucionales (@' + DOMAIN + ').');
    let u = D.users.find(x => x.email === email);
    if (!u) D.users.push(u = { id: nid('u'), n: clean(c.name, 80) || email.split('@')[0], email, rol: 'Estudiante', pw: hash(crypto.randomBytes(24).toString('hex')), prog: 'UAO', cursos: [], verified: true });
    u.verified = true;
    u.rol = STAFF[email] || 'Estudiante';
    delete u.code;
    if (MOODLE.token) await syncCourses(u).catch(e => console.log('[Moodle] Error al sincronizar cursos:', e.message));
    persist();
    sweep(codes);
    const code = b64(crypto.randomBytes(24));
    codes[code] = { uid: u.id, exp: Date.now() + 6e4 };
    res.redirect('/#sso=' + code + (p.popup ? '&popup=1' : ''));
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
  if (u.mt) {
    const t = dec(u.mt);
    cs = await moodle('core_enrol_get_users_courses', { userid: u.mid }, t);
  } else if (MOODLE.token) {
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
    req.me.mt = enc(t);
    req.me.mid = i.userid;
    await syncCourses(req.me);
    persist();
    res.json({ ok: 1, cursos: req.me.cursos });
  } catch (e) {
    res.status(502).json({ error: 'UAO Virtual no aceptó esa llave.' });
  }
});

// Parsers para Calendario (iCal)
const icalOk = v => {
  try {
    const u = new URL(v), m = new URL(MOODLE.url);
    return u.hostname === m.hostname && u.pathname.includes('/calendar/export_execute.php') && u.searchParams.has('userid') && u.searchParams.has('authtoken');
  } catch {
    return false;
  }
};

const icsText = x => x.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();
function parseIcs(t) {
  const L = t.replace(/\r?\n[ \t]/g, '').split(/\r?\n/), ev = [];
  let c = null;
  for (const l of L) {
    if (l === 'BEGIN:VEVENT') c = {};
    else if (l === 'END:VEVENT') {
      if (c && c.n && c.t) ev.push(c);
      c = null;
    } else if (c) {
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
    persist();
    res.json({ ok: 1, cursos: r.names });
  } catch (e) {
    delete req.me.ical;
    res.status(502).json({ error: 'UAO Virtual no aceptó ese enlace. Revisa que sea el del calendario.' });
  }
});

app.delete('/api/me/moodle', auth, (req, res) => {
  delete req.me.mt;
  delete req.me.mid;
  delete req.me.ical;
  delete req.me.rawc;
  setSync(req.me, 'moodle', []);
  rebuildCourses(req.me);
  persist();
  res.json({ ok: 1 });
});

app.post('/api/me/sync', auth, async (req, res) => {
  if (!LMS) return res.status(501).json({ error: 'La conexión con UAO Virtual no está configurada.' });
  try {
    if (req.me.ical && !req.me.mt) {
      await readIcal(req.me);
      persist();
      return res.json({ ok: 1, cursos: req.me.cursos });
    }
    if (!(await syncCourses(req.me))) return res.status(409).json({ error: 'Primero conecta tu cuenta de UAO Virtual.' });
    persist();
    res.json({ ok: 1, cursos: req.me.cursos });
  } catch (e) {
    res.status(502).json({ error: 'No pudimos leer tus cursos de UAO Virtual.' });
  }
});

const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : null; };

app.get('/api/me/virtual', auth, async (req, res) => {
  const u = req.me;
  if (LMS && u.ical && !u.mt) {
    try {
      const r = await readIcal(u);
      persist();
      return res.json({ connected: true, mode: 'ical', cursos: rebuildCourses(u).map(e => ({ ...e, progreso: null, total: null, items: [] })), proximas: r.proximas, sync: u.synced });
    } catch {
      return res.status(502).json({ error: 'No pudimos leer tu calendario de UAO Virtual.' });
    }
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
  } catch (e) {
    res.status(502).json({ error: 'No pudimos leer UAO Virtual.' });
  }
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
app.put('/api/me/notas', auth, (req, res) => {
  const items = (Array.isArray(req.body.items) ? req.body.items : []).slice(0, 30).map(i => ({ m: clean(i.m, 60), c: Math.round(parseFloat(i.c)), n: Math.round(parseFloat(String(i.n).replace(',', '.')) * 100) / 100 }));
  if (items.some(i => !i.m || !(i.c >= 1 && i.c <= 12) || !(i.n >= 0 && i.n <= 5))) return bad(res, 'Revisa los datos: materia, créditos (1 a 12) y nota (0 a 5).');
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
  pend[state] = { kind: 'classroom', uid: req.me.id, nonce, ver, exp: Date.now() + 6e5 };
  const q = new URLSearchParams({ client_id: G.client, response_type: 'code', redirect_uri: G.redirect, scope: CR_SCOPES, state, nonce, code_challenge: b64(crypto.createHash('sha256').update(ver).digest()), code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent', login_hint: req.me.email, hd: DOMAIN });
  res.json({ url: `${G.auth}?${q}` });
});
async function classroomCb(req, res, p) {
  const back = ok => res.redirect(ok ? '/#cursos' : '/?classroom=error#cursos');
  try {
    if (req.query.error) return back(false);
    const r = await fetch(G.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: G.client, client_secret: G.secret, grant_type: 'authorization_code', code: String(req.query.code || ''), redirect_uri: G.redirect, code_verifier: p.ver }) });
    const t = await r.json().catch(() => ({}));
    const u = D.users.find(x => x.id === p.uid);
    if (!r.ok || !t.refresh_token || !t.id_token || !u) return back(false);
    const c = JSON.parse(Buffer.from(t.id_token.split('.')[1], 'base64url'));
    if (c.aud !== G.client || c.nonce !== p.nonce || c.exp * 1000 < Date.now() || c.email_verified !== true || String(c.email || '').toLowerCase() !== u.email) return back(false);
    if (t.scope && !String(t.scope).includes('classroom.courses.readonly')) return back(false);
    u.gc = enc(t.refresh_token);
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

app.get('/api/bootstrap', auth, (req, res) => res.json(view(req.me)));

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
  persist();
  res.json({ ok: 1 });
});

app.post('/api/advisories', auth, need('Estudiante'), (req, res) => {
  const p = D.users.find(u => u.id === +req.body.p && u.rol !== 'Estudiante'), tema = clean(req.body.tema, 100), msg = clean(req.body.msg, 1000);
  if (!p) return bad(res, 'Elige a un docente o monitor.');
  if (!tema || !msg) return bad(res, 'Escribe el tema y la descripción.');
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

app.post('/api/resources', auth, need('Docente', 'Monitor'), (req, res) => {
  const b = req.body || {}, n = clean(b.n, 120);
  if (!n) return bad(res, 'Escribe el nombre del recurso.');
  D.R.push({ id: nid('r'), n, s: CAT().includes(b.s) ? b.s : (CAT()[0] || 'General'), ty: ['Guía', 'Documento', 'Apunte', 'Enlace', 'Material de estudio', 'Taller', 'Otro'].includes(b.ty) ? b.ty : 'Documento', d: clean(b.d, 400) || 'Sin descripción', f: today(), au: req.me.n });
  persist();
  res.json({ ok: 1 });
});

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

app.use('/api', (req, res) => nf(res));
app.use((e, req, res, next) => res.status(400).json({ error: 'Solicitud no válida.' }));

app.listen(PORT, () => {
  console.log('UAO Conecta escuchando en http://localhost:' + PORT);
  console.log(SSO ? '  Ingreso con Google (@' + DOMAIN + '): ACTIVO' : '  Ingreso con Google: Faltan credenciales');
  console.log(LMS ? '  UAO Virtual: ACTIVO (' + MOODLE.url + ')' : '  UAO Virtual: Desactivado');
});
