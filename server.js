const express = require('express');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_PATH = path.join(__dirname, 'data', 'profile.json');

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Allow CORS and iframe previewing cleanly
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

function loadProfile() {
  try {
    if (!fs.existsSync(DATA_PATH)) {
      return getDefaultProfile();
    }
    const raw = fs.readFileSync(DATA_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error loading profile:', err);
    return getDefaultProfile();
  }
}

function saveProfile(profile) {
  const dir = path.dirname(DATA_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(DATA_PATH, JSON.stringify(profile, null, 2), 'utf8');
}

function getDefaultProfile() {
  return {
    fullName: 'Jean-Luc Morel',
    firstName: 'Jean-Luc',
    lastName: 'Morel',
    jobTitle: 'Senior Consultant & Principal Advisor',
    company: 'Morel Advisory Partners',
    phone: '+230 5728 9400',
    email: 'jl.morel@moreladvisory.com',
    website: '',
    bankName: 'Mauritius Commercial Bank (MCB)',
    accountHolder: 'Jean-Luc Morel',
    accountNumber: '000448291038',
    tapMode: 'auto_prompt_with_fallback',
    includeCustomBankField: true,
    updatedAt: new Date().toISOString(),
    analytics: {
      totalTaps: 0,
      iosTaps: 0,
      androidTaps: 0,
      otherTaps: 0,
      recentTaps: []
    }
  };
}

// Escape text for vCard 3.0 spec (RFC 2426)
function escapeVCardValue(str = '') {
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

// Split full name into firstName and lastName if not explicitly split
function splitName(fullName = '') {
  const trimmed = String(fullName).trim();
  if (!trimmed) return { firstName: 'Professional', lastName: '' };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '' };
  }
  const lastName = parts.pop();
  const firstName = parts.join(' ');
  return { firstName, lastName };
}

/**
 * Generates an RFC 2426 compliant vCard 3.0 string compatible with both
 * iOS (Apple Contacts) and Android (Google / Samsung Contacts).
 */
function generateVCard(profile) {
  const fullName = (profile.fullName || '').trim() || 'Contact';
  const { firstName, lastName } = splitName(fullName);
  const jobTitle = (profile.jobTitle || '').trim();
  const company = (profile.company || '').trim();
  const phone = (profile.phone || '').trim();
  const email = (profile.email || '').trim();
  const website = (profile.website || '').trim();
  const bankName = (profile.bankName || '').trim();
  const accountHolder = (profile.accountHolder || fullName).trim();
  const accountNumber = (profile.accountNumber || '').trim();

  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N;CHARSET=UTF-8:${escapeVCardValue(lastName)};${escapeVCardValue(firstName)};;;`,
    `FN;CHARSET=UTF-8:${escapeVCardValue(fullName)}`
  ];

  if (company) {
    lines.push(`ORG;CHARSET=UTF-8:${escapeVCardValue(company)}`);
  }
  if (jobTitle) {
    lines.push(`TITLE;CHARSET=UTF-8:${escapeVCardValue(jobTitle)}`);
  }
  if (phone) {
    lines.push(`TEL;TYPE=CELL,VOICE,PREF:${phone}`);
  }
  if (email) {
    lines.push(`EMAIL;TYPE=PREF,INTERNET:${email}`);
  }
  if (website) {
    lines.push(`URL:${website}`);
  }

  // Construct structured Bank Details inside NOTE (universally visible in iOS & Android Contacts)
  const noteParts = [];
  if (bankName || accountNumber || accountHolder) {
    noteParts.push('=== BANK ACCOUNT DETAILS ===');
    if (bankName) noteParts.push(`Bank Name: ${bankName}`);
    if (accountHolder) noteParts.push(`Account Holder: ${accountHolder}`);
    if (accountNumber) noteParts.push(`Account Number: ${accountNumber}`);
  }

  if (noteParts.length > 0) {
    lines.push(`NOTE;CHARSET=UTF-8:${escapeVCardValue(noteParts.join('\n'))}`);
  }

  // Optional custom labeled property for iOS / Android address books that support X-ABLabel
  if (profile.includeCustomBankField !== false && accountNumber) {
    const labelText = bankName ? `Bank (${bankName})` : 'Bank Account No';
    lines.push(`item1.X-ABICQ;CHARSET=UTF-8:${escapeVCardValue(accountNumber)}`);
    lines.push(`item1.X-ABLabel;CHARSET=UTF-8:${escapeVCardValue(labelText)}`);
  }

  lines.push(`REV:${new Date().toISOString()}`);
  lines.push('END:VCARD');

  // vCard 3.0 standard uses CRLF (\r\n) line endings
  return lines.join('\r\n') + '\r\n';
}

// Resolve profile from either stateless query param `?d=base64url` or saved server profile
function resolveProfileFromRequest(req) {
  if (req.query.d) {
    try {
      const jsonStr = Buffer.from(String(req.query.d), 'base64url').toString('utf8');
      const decoded = JSON.parse(jsonStr);
      return {
        fullName: decoded.fn || decoded.fullName || '',
        jobTitle: decoded.jt || decoded.jobTitle || '',
        company: decoded.co || decoded.company || '',
        phone: decoded.ph || decoded.phone || '',
        email: decoded.em || decoded.email || '',
        website: decoded.ws || decoded.website || '',
        bankName: decoded.bn || decoded.bankName || '',
        accountHolder: decoded.ah || decoded.accountHolder || '',
        accountNumber: decoded.an || decoded.accountNumber || '',
        includeCustomBankField: decoded.cb !== undefined ? Boolean(decoded.cb) : true
      };
    } catch (e) {
      // Fallback to stored profile
    }
  }
  return loadProfile();
}

function encodeStatelessPayload(profile) {
  const compact = {
    fn: profile.fullName || '',
    jt: profile.jobTitle || '',
    co: profile.company || '',
    ph: profile.phone || '',
    em: profile.email || '',
    bn: profile.bankName || '',
    ah: profile.accountHolder || '',
    an: profile.accountNumber || '',
    cb: profile.includeCustomBankField !== false ? 1 : 0
  };
  return Buffer.from(JSON.stringify(compact), 'utf8').toString('base64url');
}

function detectPlatform(userAgent = '') {
  const ua = String(userAgent).toLowerCase();
  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod') || (ua.includes('macintosh') && ua.includes('mobile'))) {
    return 'iOS (iPhone)';
  }
  if (ua.includes('android')) {
    return 'Android';
  }
  return 'Desktop / Other';
}

function recordTapEvent(req, modeLabel) {
  try {
    const profile = loadProfile();
    if (!profile.analytics) {
      profile.analytics = { totalTaps: 0, iosTaps: 0, androidTaps: 0, otherTaps: 0, recentTaps: [] };
    }
    const platform = detectPlatform(req.headers['user-agent']);
    profile.analytics.totalTaps = (profile.analytics.totalTaps || 0) + 1;
    if (platform.startsWith('iOS')) {
      profile.analytics.iosTaps = (profile.analytics.iosTaps || 0) + 1;
    } else if (platform === 'Android') {
      profile.analytics.androidTaps = (profile.analytics.androidTaps || 0) + 1;
    } else {
      profile.analytics.otherTaps = (profile.analytics.otherTaps || 0) + 1;
    }
    profile.analytics.recentTaps = [
      {
        timestamp: new Date().toISOString(),
        platform,
        mode: modeLabel
      },
      ...(profile.analytics.recentTaps || []).slice(0, 14)
    ];
    saveProfile(profile);
  } catch (err) {
    console.error('Failed to record tap analytics:', err);
  }
}

// API: Get current profile + vCard + encoded stateless token
app.get('/api/profile', (req, res) => {
  const profile = loadProfile();
  const vcard = generateVCard(profile);
  const statelessToken = encodeStatelessPayload(profile);
  res.json({
    profile,
    vcard,
    statelessToken
  });
});

// API: Save updated profile
app.post('/api/profile', (req, res) => {
  const current = loadProfile();
  const body = req.body || {};
  const { firstName, lastName } = splitName(body.fullName || current.fullName);

  const updated = {
    ...current,
    fullName: String(body.fullName ?? current.fullName).trim(),
    firstName,
    lastName,
    jobTitle: String(body.jobTitle ?? current.jobTitle ?? '').trim(),
    company: String(body.company ?? current.company ?? '').trim(),
    phone: String(body.phone ?? current.phone ?? '').trim(),
    email: String(body.email ?? current.email ?? '').trim(),
    website: String(body.website ?? current.website ?? '').trim(),
    bankName: String(body.bankName ?? current.bankName ?? '').trim(),
    accountHolder: String(body.accountHolder ?? current.accountHolder ?? '').trim(),
    accountNumber: String(body.accountNumber ?? current.accountNumber ?? '').trim(),
    tapMode: body.tapMode || current.tapMode || 'auto_prompt_with_fallback',
    includeCustomBankField: body.includeCustomBankField !== undefined ? Boolean(body.includeCustomBankField) : true,
    updatedAt: new Date().toISOString()
  };

  saveProfile(updated);
  res.json({
    ok: true,
    profile: updated,
    vcard: generateVCard(updated),
    statelessToken: encodeStatelessPayload(updated)
  });
});

// API: Reset tap statistics
app.post('/api/reset-stats', (req, res) => {
  const current = loadProfile();
  current.analytics = {
    totalTaps: 0,
    iosTaps: 0,
    androidTaps: 0,
    otherTaps: 0,
    recentTaps: []
  };
  saveProfile(current);
  res.json({ ok: true, profile: current });
});

// API: Generate SVG QR code for any text/URL
app.get('/api/qr', async (req, res) => {
  try {
    const text = String(req.query.text || 'https://example.com');
    const svg = await QRCode.toString(text, {
      type: 'svg',
      margin: 1,
      width: 220,
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      }
    });
    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(svg);
  } catch (err) {
    res.status(500).send('Error generating QR code');
  }
});

// Direct vCard (.vcf) endpoint — triggers native iOS Contacts sheet & Android Contacts import
app.get(['/contact.vcf', '/api/vcard'], (req, res) => {
  const profile = resolveProfileFromRequest(req);
  const vcard = generateVCard(profile);
  const safeFilename = (profile.fullName || 'Contact')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_');

  if (req.query.preview !== '1') {
    recordTapEvent(req, req.query.source === 'tap_auto' ? 'NFC Tap -> Auto Contact Prompt' : 'Direct .vcf Download');
  }

  // Setting text/vcard; charset=utf-8 triggers native iOS Safari Contacts Sheet & Android Contacts intent
  res.setHeader('Content-Type', 'text/vcard; charset=utf-8');
  res.setHeader('Content-Disposition', `inline; filename="${safeFilename}.vcf"`);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.send(vcard);
});

// Client NFC Tap Route (/tap) — serves the ultra-fast Client Tap Experience
app.get('/tap', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'tap.html'));
});

// Serve static assets from public/
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`NFC Contact & Bank Sharing System running on http://0.0.0.0:${PORT}`);
});
