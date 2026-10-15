const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// ─── Database: PostgreSQL (production) or file-based (local dev) ───────────
// When DATABASE_URL is set, uses PostgreSQL. Otherwise falls back to data/profile.json.
const DATABASE_URL = process.env.DATABASE_URL || null;
let dbPool = null;

if (DATABASE_URL) {
  try {
    const { Pool } = require('pg');
    dbPool = new Pool({
      connectionString: DATABASE_URL,
      ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30000,
    });
    console.log('PostgreSQL connected (DATABASE_URL set)');
  } catch (err) {
    console.error('PostgreSQL not available, falling back to file storage:', err.message);
    dbPool = null;
  }
}

// ─── Storage Abstraction ────────────────────────────────────────────────────

async function loadProfile() {
  if (dbPool) {
    const result = await dbPool.query(
      'SELECT json_data FROM client_profiles WHERE id = 1'
    );
    if (result.rows.length === 0) throw new Error('No profile configured');
    return result.rows[0].json_data;
  }
  const DATA_PATH = path.join(__dirname, 'data', 'profile.json');
  if (!fs.existsSync(DATA_PATH)) throw new Error('No profile configured');
  const raw = fs.readFileSync(DATA_PATH, 'utf8');
  return JSON.parse(raw);
}

async function saveProfile(profile) {
  if (dbPool) {
    await dbPool.query(
      `INSERT INTO client_profiles (id, json_data, created_at, updated_at)
       VALUES (1, $1, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE
       SET json_data = $1, updated_at = NOW()`,
      [JSON.stringify(profile)]
    );
    return;
  }
  const DATA_PATH = path.join(__dirname, 'data', 'profile.json');
  const dir = path.dirname(DATA_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmpPath = DATA_PATH + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(profile, null, 2), { mode: 0o600 });
  fs.renameSync(tmpPath, DATA_PATH);
}

async function initDatabase() {
  if (!dbPool) return;
  try {
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS client_profiles (
        id INTEGER PRIMARY KEY DEFAULT 1,
        json_data JSONB NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);
    console.log('Database table ready');
  } catch (err) {
    console.error('Database init error:', err.message);
  }
}

// ─── Security: Admin Token ──────────────────────────────────────────────────
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || null;

if (!ADMIN_TOKEN || ADMIN_TOKEN.length < 32) {
  console.error('ERROR: ADMIN_TOKEN env var is required (32+ characters).');
  console.error('Generate one with: openssl rand -base64 32');
  console.error('The server will run in READ-ONLY mode (no profile edits).');
  console.error('');
}

// ─── Security: HMAC signing key ─────────────────────────────────────────────
const SIGNING_SECRET = process.env.SIGNING_SECRET || loadOrCreateSigningSecret();

function loadOrCreateSigningSecret() {
  const secretPath = path.join(__dirname, 'data', '.signing_secret');
  try {
    if (fs.existsSync(secretPath)) {
      const secret = fs.readFileSync(secretPath, 'utf8').trim();
      if (secret && secret.length >= 32) return secret;
    }
    const secret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(secretPath, secret, { mode: 0o600 });
    return secret;
  } catch (err) {
    console.error('Error loading/creating signing secret:', err);
    return crypto.randomBytes(32).toString('hex');
  }
}

// ─── Express App ────────────────────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 3000;

// NOTE: express.urlencoded() is intentionally NOT enabled (CSRF protection)
app.use(express.json({ limit: '100kb' }));

// Helmet security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// Additional security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  next();
});

// ─── Rate Limiting ──────────────────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', apiLimiter);
app.use('/api/login', authLimiter);

// ─── Admin Auth Middleware ──────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) {
    return res.status(403).json({ ok: false, error: 'Admin token not configured' });
  }
  const given = Buffer.from(req.get('authorization') || '');
  const expected = Buffer.from(ADMIN_TOKEN);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  next();
}

// ─── Input Validation ───────────────────────────────────────────────────────
const MAX_FIELD_LENGTH = 120;

function clean(str, max = MAX_FIELD_LENGTH) {
  return String(str || '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .trim()
    .slice(0, max);
}

const PHONE_RE = /^\+?[0-9 ()-]{6,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ACCOUNT_RE = /^[A-Za-z0-9\s-]{5,50}$/;

function validateProfileInput(body) {
  const errors = [];
  const validated = {};

  const fullName = clean(body.fullName, 100);
  if (!fullName) errors.push('Full Name is required');
  validated.fullName = fullName;

  const phone = clean(body.phone, 30);
  if (phone && !PHONE_RE.test(phone)) { errors.push('Invalid phone format'); }
  else { validated.phone = phone; }

  const email = clean(body.email, 254);
  if (email && !EMAIL_RE.test(email)) { errors.push('Invalid email format'); }
  else { validated.email = email; }

  const website = clean(body.website, 200);
  if (website) {
    try {
      const url = new URL(website);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        errors.push('Website must use http/https');
      } else {
        validated.website = website;
      }
    } catch (e) {
      errors.push('Invalid website URL');
    }
  } else {
    validated.website = '';
  }

  validated.jobTitle = clean(body.jobTitle, 100);
  validated.company = clean(body.company, 100);
  validated.bankName = clean(body.bankName, 100);
  validated.accountHolder = clean(body.accountHolder, 100);

  const accountNumber = clean(body.accountNumber, 50);
  if (accountNumber && !ACCOUNT_RE.test(accountNumber)) {
    errors.push('Invalid account number format');
  } else {
    validated.accountNumber = accountNumber;
  }

  validated.includeBankDetails = body.includeBankDetails !== undefined ? Boolean(body.includeBankDetails) : true;
  validated.includeCustomBankField = body.includeCustomBankField !== undefined ? Boolean(body.includeCustomBankField) : true;

  return { validated, errors };
}

// ─── vCard Generation (single safe builder) ─────────────────────────────────

function escapeVCard(s) {
  return clean(s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, ',');
}

function foldLine(line) {
  const limit = 75;
  let out = '';
  let cur = '';
  let len = 0;
  for (const ch of line) {
    const byteLen = Buffer.byteLength(ch);
    if (len + byteLen >= limit && cur.length > 0) {
      out += cur + '\r\n ';
      cur = '';
      len = 0;
    }
    cur += ch;
    len += byteLen;
  }
  return out + cur;
}

function splitName(fullName) {
  const trimmed = String(fullName || '').trim();
  if (!trimmed) return { firstName: 'Professional', lastName: '' };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  const lastName = parts.pop();
  const firstName = parts.join(' ');
  return { firstName, lastName };
}

function generateVCard(profile) {
  const fullName = clean(profile.fullName, 100) || 'Contact';
  const nameParts = splitName(fullName);
  const jobTitle = clean(profile.jobTitle, 100);
  const company = clean(profile.company, 100);
  const phone = clean(profile.phone, 30);
  const email = clean(profile.email, 254);
  const website = clean(profile.website, 200);
  const bankName = clean(profile.bankName, 100);
  const accountHolder = clean(profile.accountHolder, 100) || fullName;
  const accountNumber = clean(profile.accountNumber, 50);
  const includeBankDetails = profile.includeBankDetails !== false;

  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    'N:' + escapeVCard(nameParts.lastName) + ';' + escapeVCard(nameParts.firstName) + ';;;',
    'FN:' + escapeVCard(fullName)
  ];

  if (company) lines.push('ORG:' + escapeVCard(company));
  if (jobTitle) lines.push('TITLE:' + escapeVCard(jobTitle));
  if (phone && PHONE_RE.test(phone)) lines.push('TEL;TYPE=CELL,VOICE,PREF:' + phone);
  if (email && EMAIL_RE.test(email)) lines.push('EMAIL;TYPE=PREF,INTERNET:' + email);
  if (website) lines.push('URL:' + website);

  if (includeBankDetails && (bankName || accountNumber || accountHolder)) {
    const noteParts = ['=== BANK ACCOUNT DETAILS ==='];
    if (bankName) noteParts.push('Bank: ' + bankName);
    if (accountHolder) noteParts.push('Holder: ' + accountHolder);
    if (accountNumber) noteParts.push('Account: ' + accountNumber);
    lines.push('NOTE:' + escapeVCard(noteParts.join('\n')));
  }

  lines.push('REV:' + new Date().toISOString());
  lines.push('END:VCARD');

  return lines.map(foldLine).join('\r\n') + '\r\n';
}

// ─── HMAC Signing for Stateless Payloads ───────────────────────────────────

function encodeStatelessPayload(profile) {
  const compact = {
    fn: clean(profile.fullName, 100),
    jt: clean(profile.jobTitle, 100),
    co: clean(profile.company, 100),
    ph: clean(profile.phone, 30),
    em: clean(profile.email, 254),
    ws: clean(profile.website, 200),
    bn: clean(profile.bankName, 100),
    ah: clean(profile.accountHolder, 100),
    an: clean(profile.accountNumber, 50),
    cb: profile.includeBankDetails !== false ? 1 : 0,
    cbf: profile.includeCustomBankField !== false ? 1 : 0,
    exp: Math.floor(Date.now() / 1000) + 86400
  };
  const jsonStr = JSON.stringify(compact);
  const b64 = Buffer.from(jsonStr, 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', SIGNING_SECRET).update(b64).digest('hex');
  return b64 + '.' + sig;
}

function decodeStatelessPayload(token) {
  if (!token || typeof token !== 'string') return { verified: false };
  const parts = token.split('.');
  if (parts.length !== 2) return { verified: false };
  const [b64, sig] = parts;

  const expectedSig = crypto.createHmac('sha256', SIGNING_SECRET).update(b64).digest('hex');
  const sigBuf = Buffer.from(sig, 'hex');
  const expBuf = Buffer.from(expectedSig, 'hex');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { verified: false };
  }

  try {
    const decoded = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
    if (decoded.exp && Math.floor(Date.now() / 1000) > decoded.exp) {
      return { verified: false };
    }
    const profile = {
      fullName: clean(decoded.fn, 100),
      jobTitle: clean(decoded.jt, 100),
      company: clean(decoded.co, 100),
      phone: clean(decoded.ph, 30),
      email: clean(decoded.em, 254),
      website: clean(decoded.ws, 200),
      bankName: clean(decoded.bn, 100),
      accountHolder: clean(decoded.ah, 100),
      accountNumber: clean(decoded.an, 50),
      includeBankDetails: decoded.cb !== undefined ? Boolean(decoded.cb) : true,
      includeCustomBankField: decoded.cbf !== undefined ? Boolean(decoded.cbf) : true
    };
    return { verified: true, profile };
  } catch (e) {
    return { verified: false };
  }
}

async function resolveProfile(req) {
  if (req.query.d) {
    const result = decodeStatelessPayload(req.query.d);
    if (result.verified) return result.profile;
  }
  return loadProfile();
}

// ─── Platform Detection ────────────────────────────────────────────────────

function detectPlatform(ua) {
  const s = String(ua || '').toLowerCase();
  if (s.includes('iphone') || s.includes('ipad') || s.includes('ipod') ||
      (s.includes('macintosh') && s.includes('mobile'))) return 'iOS';
  if (s.includes('android')) return 'Android';
  return 'Other';
}

// ─── Analytics ──────────────────────────────────────────────────────────────

async function recordTap(userAgent, modeLabel) {
  try {
    const profile = await loadProfile();
    if (!profile.analytics) {
      profile.analytics = { totalTaps: 0, iosTaps: 0, androidTaps: 0, otherTaps: 0, recentTaps: [] };
    }
    const platform = detectPlatform(userAgent);
    profile.analytics.totalTaps = (profile.analytics.totalTaps || 0) + 1;
    if (platform === 'iOS') profile.analytics.iosTaps = (profile.analytics.iosTaps || 0) + 1;
    else if (platform === 'Android') profile.analytics.androidTaps = (profile.analytics.androidTaps || 0) + 1;
    else profile.analytics.otherTaps = (profile.analytics.otherTaps || 0) + 1;

    profile.analytics.recentTaps = [
      { ts: new Date().toISOString(), p: platform, m: modeLabel },
      ...(profile.analytics.recentTaps || []).slice(0, 14)
    ];
    await saveProfile(profile);
  } catch (err) {
    console.error('Analytics error:', err.message);
  }
}

// ─── Routes ─────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ ok: true, status: 'healthy', ts: new Date().toISOString() });
});

app.get('/api/studio-status', (req, res) => {
  res.json({
    configured: !!ADMIN_TOKEN,
    storage: dbPool ? 'postgresql' : 'file',
    message: ADMIN_TOKEN ? 'Admin token configured' : 'Set ADMIN_TOKEN env var to enable editing'
  });
});

app.post('/api/login', (req, res) => {
  if (!ADMIN_TOKEN) {
    return res.status(403).json({ ok: false, error: 'Admin token not configured' });
  }
  const given = Buffer.from((req.body || {}).token || '');
  const expected = Buffer.from(ADMIN_TOKEN);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return res.status(401).json({ ok: false, error: 'Invalid token' });
  }
  res.json({ ok: true });
});

// Public read-only
app.get('/api/profile', async (req, res) => {
  try {
    const profile = await loadProfile();
    res.json({
      profile,
      vcard: generateVCard(profile),
      statelessToken: encodeStatelessPayload(profile)
    });
  } catch (err) {
    res.status(503).json({ ok: false, error: 'Contact temporarily unavailable' });
  }
});

// Protected: save profile
app.post('/api/profile', requireAdmin, async (req, res) => {
  let current;
  try {
    current = await loadProfile();
  } catch (err) {
    return res.status(503).json({ ok: false, error: 'No profile exists yet' });
  }

  const { validated, errors } = validateProfileInput(req.body);
  if (errors.length > 0) {
    return res.status(400).json({ ok: false, error: 'Validation failed', details: errors });
  }

  const nameParts = splitName(validated.fullName);
  const updated = {
    ...current,
    fullName: validated.fullName,
    firstName: nameParts.firstName,
    lastName: nameParts.lastName,
    jobTitle: validated.jobTitle,
    company: validated.company,
    phone: validated.phone,
    email: validated.email,
    website: validated.website,
    bankName: validated.bankName,
    accountHolder: validated.accountHolder,
    accountNumber: validated.accountNumber,
    includeBankDetails: validated.includeBankDetails,
    includeCustomBankField: validated.includeCustomBankField,
    tapMode: (req.body || {}).tapMode || current.tapMode || 'auto_prompt_with_fallback',
    updatedAt: new Date().toISOString()
  };

  await saveProfile(updated);
  res.json({
    ok: true,
    profile: updated,
    vcard: generateVCard(updated),
    statelessToken: encodeStatelessPayload(updated)
  });
});

// Protected: reset stats
app.post('/api/reset-stats', requireAdmin, async (req, res) => {
  try {
    const current = await loadProfile();
    current.analytics = { totalTaps: 0, iosTaps: 0, androidTaps: 0, otherTaps: 0, recentTaps: [] };
    await saveProfile(current);
    res.json({ ok: true, profile: current });
  } catch (err) {
    res.status(503).json({ ok: false, error: 'Contact temporarily unavailable' });
  }
});

// QR Code
app.get('/api/qr', async (req, res) => {
  try {
    const text = String((req.query || {}).text || 'https://example.com');
    if (text.length > 500) return res.status(400).send('Text too long');
    const svg = await QRCode.toString(text, { type: 'svg', margin: 1, width: 220 });
    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(svg);
  } catch (err) {
    res.status(500).send('QR error');
  }
});

// ─── vCard endpoint ─────────────────────────────────────────────────────────
app.get(['/contact.vcf', '/api/vcard'], async (req, res) => {
  try {
    const profile = await resolveProfile(req);
    const vcard = generateVCard(profile);
    const safeName = clean(profile.fullName, 50).replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_');

    if ((req.query || {}).preview !== '1') {
      await recordTap(req.headers['user-agent'], 'Direct .vcf Download');
    }

    res.setHeader('Content-Type', 'text/vcard; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="' + safeName + '.vcf"');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(vcard);
  } catch (err) {
    res.status(503).send('Contact temporarily unavailable');
  }
});

// ─── Tap page ──────────────────────────────────────────────────────────────
app.get('/tap', async (req, res) => {
  await recordTap(req.headers['user-agent'], 'NFC Tap -> Auto vCard');
  res.sendFile(path.join(__dirname, 'public', 'tap.html'));
});

// ─── Static ────────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1y',
  etag: true,
  lastModified: true,
}));

// ─── Error Handlers ─────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Start ─────────────────────────────────────────────────────────────────
async function start() {
  await initDatabase();
  app.listen(PORT, '0.0.0.0', () => {
    console.log('NFC Contact System running on http://0.0.0.0:' + PORT);
    console.log('Storage: ' + (dbPool ? 'PostgreSQL' : 'file-based'));
    if (!ADMIN_TOKEN) {
      console.error('');
      console.error('  WARNING: ADMIN_TOKEN not set — server is READ-ONLY.');
      console.error('  Generate one: openssl rand -base64 32');
      console.error('');
    }
  });
}

start().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});

module.exports = {
  app,
  generateVCard,
  encodeStatelessPayload,
  decodeStatelessPayload,
  validateProfileInput,
  loadProfile,
  saveProfile,
  resolveProfile,
  detectPlatform,
  foldLine,
  escapeVCard
};
