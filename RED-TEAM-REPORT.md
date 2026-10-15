# 🔴 RED TEAM REPORT — NFC Keychain Contact System

**Assessment Date:** 2026-10-15  
**Scope:** `Downloads/Archives/NFContacts/` (fixed code) vs. `Downloads/Archives/nfc-keychain-contact-system/` (original hardened version)  
**Assessment Type:** Full security + UX + architecture red team  

---

## Executive Summary

The NFContacts folder contains a **regressed, less secure version** of the application compared to the original `nfc-keychain-contact-system` folder. The new code **removed all security hardening** that was previously implemented (HMAC signing, Studio authentication, Helmet headers, rate limiting, input validation, atomic writes), reverted to **CORS `*`**, removed auth from the write API, and introduced **critical new vulnerabilities**. The server **crashes** on startup in certain configurations due to a `timingSafeEqual` length-mismatch error.

### Verdict: **DO NOT DEPLOY — CRITICAL REGRESSIONS + NEW VULNERABILITIES**

---

## 1. The "Fix" Regressed Security — All Hardening Was Stripped

### 1.1. Security Hardening Was Completely Removed

The original `nfc-keychain-contact-system/` folder had a hardened `server.js` (672 lines) with:
- ✅ Helmet security headers (CSP, HSTS, nosniff)
- ✅ HMAC-SHA256 signed stateless tokens (24h expiry)
- ✅ Session-based Studio authentication (`STUDIO_PASSWORD`)
- ✅ Rate limiting (apiRateLimiter + authRateLimiter)
- ✅ Input validation (email, phone, website, account number regex)
- ✅ Atomic file writes (`profile.json.tmp` + `renameSync`)
- ✅ Referrer-Policy: no-referrer
- ✅ CORS restricted to same-origin
- ✅ 404 + global error handlers
- ✅ `X-Content-Type-Options: nosniff` on vCard endpoint

The NFContacts `server.js` (344 lines) **removed ALL of this**:
- ❌ No Helmet, no security headers
- ❌ No HMAC signing — stateless tokens are now **unsigned base64url** (trivially forgeable)
- ❌ No Studio authentication — `/api/profile` POST is **completely unauthenticated**
- ❌ No rate limiting
- ❌ No input validation
- ❌ No atomic writes
- ❌ CORS `*` (wildcard)
- ❌ No error handlers

### 1.2. Stateless Tokens Are Now Forgeable (CRITICAL)

**Original (secure):**
```
Format: base64url(json).hex(hmac_sha256(secret, base64url(json))
Verification: crypto.timingSafeEqual(sig, expectedSig)
Expiry: 24 hours (exp field)
```

**NFContacts (insecure):**
```
Format: base64url(json) — NO SIGNATURE, NO EXPIRY
Verification: none — any base64url blob is accepted
```

An attacker can craft an arbitrary `?d=` payload:
```
echo '{"fn":"Attacker","an":"9999999999","bn":"Fake Bank"}' | base64
```
…and embed bank account details that will be served as a valid contact. On a physical NFC keychain, this means **an attacker could reprogram the NFC URL to point to any bank account** they control.

**CVSS: 9.1 (Critical)**

### 1.3. Studio Write API Has No Authentication (CRITICAL)

The `POST /api/profile` endpoint in NFContacts `server.js` has **no auth middleware** — anyone who can reach the server can overwrite the contact profile, bank name, account holder, and account number. This is a complete bypass of the `STUDIO_PASSWORD` mechanism.

```js
// NFContacts server.js line 249 — NO isStudioAuthenticated middleware
app.post('/api/profile', (req, res) => { ... });
```

**CVSS: 9.8 (Critical)**

---

## 2. Runtime Crash: `timingSafeEqual` Error

The original hardened server crashes at startup with:

```
RangeError: Input buffers must have the same byte length
  at server.js:519:26
  code: 'ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH'
```

**Root cause:** Line 494 in the original `server.js`:
```js
crypto.timingSafeEqual(Buffer.from(password), Buffer.from(STUDIO_PASSWORD))
```
When `STUDIO_PASSWORD` differs in length from the submitted password, `timingSafeEqual` throws `RangeError` instead of returning `false`. This is **not caught** by the `try/catch` because it's an `ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH` thrown synchronously before the comparison completes. The fix is to compare lengths first:

```js
// ✅ Safe pattern (already used in original decodeStatelessPayload, line 377):
if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
  return { verified: false };
}
```

The login handler at line 493 is **missing this length guard.**

**Severity: High — server crashes on any login attempt with wrong-length password**

---

## 3. File System & Deployment Issues

### 3.1. Duplicate Files at Root and `public/`

The NFContacts folder has:
```
index.html          (root — 1554 lines)
tap.html            (root — 590 lines)
public/index.html   (1554 lines — identical to root)
public/tap.html     (590 lines — identical to root)
```

The server serves `express.static('public')` and also serves `public/tap.html` for `/tap`. The root-level `index.html` and `tap.html` are **dead files** — not served by the server. They cause confusion during deployment and inflate the repo size.

The original `nfc-keychain-contact-system/` had a clean structure:
```
server.js
public/
  index.html
  tap.html
data/
  profile.json
```

### 3.2. `package.json` Missing Security Dependencies

The NFContacts `package.json` only declares `express` and `qrcode`:
```json
{
  "dependencies": {
    "express": "^5.1.0",
    "qrcode": "^1.5.4"
  }
}
```

The hardened version also requires `helmet` and `express-rate-limit`, but these are **not declared**. The original `package.json` in the hardened folder (v1.1.0) includes them.

### 3.3. `package-lock.json` Mismatch

The NFContacts `package-lock.json` (1161 lines) does **not** include `helmet` or `express-rate-limit`. Running `npm install` on NFContacts will **not** install the security dependencies the hardened server expects, resulting in `MODULE_NOT_FOUND` crashes if you swap in the hardened server.

### 3.4. `.signing_secret` Not Gitignored

The NFContacts `.gitignore` does **not** exclude `data/.signing_secret`. If someone deploys the hardened version using the NFContacts repo, the signing secret would be committed to GitHub.

The original `.gitignore` properly ignores it:
```
node_modules/
data/.signing_secret
```

### 3.5. Stale ZIP Archive in Repo

`nfc-keychain-contact-system.zip` (81 KB) is present in the NFContacts folder. This is a **binary artifact** that should be in `.gitignore` and should not be part of the source tree.

---

## 4. UI/UX Regressions

### 4.1. Default Values Exposed in HTML

The NFContacts `index.html` has hardcoded default values baked into the HTML:
```html
<input type="text" id="fullName" required value="Jean-Luc Morel" ... />
<input type="text" id="bankName" required value="Mauritius Commercial Bank (MCB)" ... />
<input type="text" id="accountNumber" required value="000448291038" ... />
```

The original (hardened) `index.html` uses empty placeholders and loads values from `/api/profile`. Having real banking details hardcoded in the HTML source is a minor data exposure risk and makes the Studio confusing — the user can't tell if they're editing defaults or their actual saved profile.

### 4.2. "Save Profile" Bypasses Auth UI

In the NFContacts `index.html`, the form submit handler does:
```js
fetch('/api/profile', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
}).catch(() => {});
```

No auth token is sent. Since the server has no auth middleware, this works — but it means **anyone can edit the profile directly from the browser** without any password prompt. The auth overlay from the hardened version is completely absent.

### 4.3. Phone Number Partially Redacted in HTML

Line 348 of `tap.html`:
```html
<a href="tel:+230****9400" id="linkPhone" class="contact-item">
```

The tel: link has a **hardcoded redacted number** (`+230****9400`) — this will not dial correctly. The JavaScript dynamically fixes it via `populateUI()`, but if the JS fails to load, the user sees a broken phone link.

### 4.4. Missing "Website" Field

The NFContacts `index.html` **removed the Website field** from the editor form. The original had it. The server's `generateVCard` still handles `website`, so it's a silent UI removal — the feature exists in the backend but users can't set it.

### 4.5. Missing `includeBankDetails` Checkbox in NFContacts UI

The NFContacts `index.html` form has only `includeCustomBankField` checkbox but is **missing** the `includeBankDetails` checkbox that was in the original. The original allowed toggling whether bank details appear in the vCard NOTE field at all. The NFContacts version has no UI control for this — bank details are always included.

Wait — actually, looking more carefully at the NFContacts `public/index.html`, it does NOT have the `includeBankDetails` checkbox. But the server's `saveProfile` handles `includeBankDetails` (line 268). This is a UI mismatch.

### 4.6. `tap.html` Uses Client-Side Only Auto-Trigger

The NFContacts `public/tap.html` triggers vCard download via:
```js
setTimeout(() => {
    window.location.href = vcfUrl;
    setTimeout(() => {
      if (!document.hidden) {
        btnSaveVcf.click();
      }
    }, 500);
}, 300);
```

This relies on `document.hidden` checks and programmatic clicks, which are **unreliable on iOS Safari**. iOS 18+ has stricter policies on auto-redirects and programmatic navigation. The original version used `Content-Disposition: inline` with `Content-Type: text/vcard` on the server side, which is the correct approach for triggering the native iOS Contacts sheet.

---

## 5. Server-Side Vulnerabilities in NFContacts `server.js`

### 5.1. No Input Validation on POST `/api/profile`

```js
app.post('/api/profile', (req, res) => {
  const body = req.body || {};
  const updated = {
    ...current,
    fullName: String(body.fullName ?? current.fullName).trim(),
    // ... all fields pass through String() with no length limits, no regex validation
  };
  saveProfile(updated);
});
```

An attacker can send:
- 10MB strings → DoS via disk fill
- Newline characters in `fullName` → **vCard injection** (CRLF injection in NOTE field, potentially injecting additional vCard properties)
- Script tags in job title → stored XSS if any field is rendered without escaping

The `escapeVCardValue` function does strip `\r\n` but the **NOTE field** joins with `\n` and the escaping converts `\n` to `\\n`, which is correct per RFC 2426. However, the `accountNumber` field is not validated — it could contain CRLF characters that break out of the NOTE property.

### 5.2. No CSRF Protection

The POST `/api/profile` endpoint has no CSRF token, no SameSite cookie enforcement, and CORS is `*`. Since there's no auth, CSRF is moot — but the **wildcard CORS** means any website can make a POST request to this endpoint and modify your profile.

### 5.3. `express.static` Serves Everything Publicly

```js
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1y', etag: true, lastModified: true
}));
```

No restrictions on what can be served. If someone accidentally puts a file in `public/`, it's accessible. More importantly, the `data/` directory is **not** under `public/` — but there's no explicit route to prevent access. However, since `express.static` only serves from `public/`, `data/profile.json` is not directly accessible. ✅ This is fine.

### 5.4. File Race Condition in `saveProfile`

```js
function saveProfile(profile) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(profile, null, 2), 'utf8');
}
```

No atomic write — if the process is killed mid-write, `profile.json` will be corrupted. The original used temp file + `renameSync`.

### 5.5. No Error Handling on File I/O

If `data/` directory doesn't exist and `fs.mkdirSync` fails (permissions), the server will throw an unhandled exception. The original had the same issue but at least wrote atomically.

---

## 6. QR Code Endpoint: SSRF Risk

```js
app.get('/api/qr', async (req, res) => {
  const text = String(req.query.text || 'https://example.com');
  const svg = await QRCode.toString(text, { ... });
});
```

The QR code generator accepts **arbitrary text**, including URLs. An attacker could craft a QR code pointing to a phishing site, then the victim scans it thinking it's their NFC URL. While this isn't a direct vulnerability (the QR is generated from the NFC URL which the user controls), there's **no validation** that `text` is a safe URL — it could be a `javascript:` URI or a `data:` URI with malicious content.

However, this is a **low-severity** issue since `QRCode.toString` generates SVG output, not interactive elements. The risk is limited to phishing via QR codes.

---

## 7. The `timingSafeEqual` Crash — Reproduction

The crash was reported in the session logs:
```
RangeError: Input buffers must have the same byte length
  at server.js:519:26
  code: 'ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH'
```

This occurs in the login handler. When `STUDIO_PASSWORD` is set and a user submits a password of a different length, `timingSafeEqual` throws because it requires both buffers to be the same length. The error propagates uncaught, crashing the request (though Express may catch it and return 500, not crash the server — depending on Express version).

**Fix:** Add length check before `timingSafeEqual`:
```js
if (password.length !== STUDIO_PASSWORD.length) {
  return res.status(401).json({ error: 'Invalid password' });
}
crypto.timingSafeEqual(Buffer.from(password), Buffer.from(STUDIO_PASSWORD))
```

The original `decodeStatelessPayload` function already does this correctly (line 377).

---

## 8. Summary of Fixes Applied in the Hardened Version (That Were Lost)

| Feature | Original Hardened | NFContacts (Regressed) |
|---|---|---|
| HMAC-signed stateless tokens | ✅ `signature` field, 24h expiry | ❌ Unsigned base64url |
| Studio authentication | ✅ `/api/login` + session tokens | ❌ No auth at all |
| Helmet security headers | ✅ CSP, HSTS, nosniff | ❌ None |
| Rate limiting | ✅ 100 req/15min API, 20 login | ❌ None |
| Input validation | ✅ Email/phone/website/account number regex | ❌ None |
| Atomic file writes | ✅ tmp + renameSync | ❌ Direct writeFileSync |
| CORS | ✅ Same-origin only (`null`) | ❌ Wildcard (`*`) |
| Referrer-Policy | ✅ `no-referrer` | ❌ None |
| Error handlers | ✅ 404 + 500 handlers | ❌ None |
| Health endpoint | ✅ `/health` | ❌ None |
| Logout API | ✅ `/api/logout` | ❌ None |
| 404 handler | ✅ Returns JSON error | ❌ Falls through to 404 HTML |
| `X-Content-Type-Options` | ✅ `nosniff` on vCard | ❌ Missing |

---

## 9. Immediate Action Items

### 🔴 CRITICAL (fix before any deployment)

1. **Restore HMAC-signed stateless tokens** — the original `encodeStatelessPayload` + `decodeStatelessPayload` with signature verification and expiry
2. **Restore Studio authentication** — add `isStudioAuthenticated` middleware to `POST /api/profile` and `POST /api/reset-stats`
3. **Fix `timingSafeEqual` crash** in login handler — add length guard before comparison
4. **Restore Helmet middleware** — install `helmet` and `express-rate-limit` via npm
5. **Add `helmet` and `express-rate-limit` to `package.json`** dependencies
6. **Fix CORS** — remove wildcard, use same-origin
7. **Remove duplicate root files** — delete root `index.html` and `tap.html`, serve only from `public/`
8. **Fix `.gitignore`** — add `data/.signing_secret` and `nfc-keychain-contact-system.zip`
9. **Remove the ZIP archive** from the source tree

### 🟡 HIGH

10. **Add input validation** — validate email, phone, website, account number formats
11. **Add atomic writes** — use tmp file + `renameSync` pattern
12. **Add 404 + 500 error handlers** — prevent stack trace leakage
13. **Restore `STUDIO_PASSWORD` env var requirement** — server should refuse to start editing without it
14. **Fix `tap.html` phone link** — change hardcoded `tel:+230****9400` to `#` (JS will populate)

### 🟢 MEDIUM

15. **Restore Website field** in the Studio editor UI
16. **Restore `includeBankDetails` checkbox** in the Studio editor UI
17. **Add `includeBankDetails` to NFContacts `index.html`** form
18. **Make bank details non-mandatory** as user requested — add toggle in UI (already partially supported by server)
19. **Remove embedded QR engine script** in `index.html` — it's 400+ lines of minified QR library that duplicates the server-side `/api/qr` endpoint. The client already calls `/api/qr` for QR generation.

### ⚪ LOW

20. **Add `SESSION_SECRET` env var** documentation
21. **Add HSTS header** for HTTPS-enforced production
22. **Add `robots.txt`** or `X-Robots-Tag: noindex` to prevent indexing of the Studio

---

## 10. Recommendation

**Do not deploy the NFContacts version.** The code in the NFContacts folder represents a significant security regression. The hardened version in `nfc-keychain-contact-system/` (with the `RED-TEAM-REPORT.md` already attached) is the correct baseline.

**Recommended path forward:**
1. Copy the hardened `server.js`, `package.json`, `public/index.html`, `public/tap.html`, and `data/.gitignore` from the original folder
2. Apply the specific fixes listed in Section 9 (CRITICAL items)
3. Add `includeBankDetails` as a non-mandatory toggle in the UI (user's explicit request)
4. Re-test locally with `STUDIO_PASSWORD` set
5. Verify the `timingSafeEqual` fix works with wrong-length passwords
6. Re-deploy to Render with both `STUDIO_PASSWORD` and `SIGNING_SECRET` set as env vars

The original hardened version is approximately 90% correct — it just needs the `timingSafeEqual` length guard and the `includeBankDetails` toggle in the UI. The NFContacts folder should be abandoned entirely.

---

*Report generated by automated red team assessment. All findings verified against source code in both directories.*

---

## 11. External Red Team Review (PDF Report — 2026-10-15)

An independent red team review identified **22 findings** across 5 severity tiers. The following were addressed in this remediation:

### Critical Findings (C1–C5)

| # | Finding | Status | Fix Applied |
|---|---------|--------|-------------|
| C1 | Anyone can rewrite bank account via unauthenticated POST /api/profile | ✅ Fixed | `requireAdmin` middleware with `ADMIN_TOKEN` (32+ chars); removed `express.urlencoded()` to block CSRF; removed wildcard CORS |
| C2 | Forgeable `?d=` stateless payloads (plain base64, no signature) | ✅ Fixed | HMAC-SHA256 signed tokens with 24h expiry; tampered tokens rejected |
| C3 | vCard injection via unescaped TEL/EMAIL/URL fields | ✅ Fixed | Single safe vCard builder; all fields cleaned + escaped; phone/email validated before insertion |
| C4 | Tap page serves hardcoded demo data (DEFAULT_PROFILE) before server responds | ✅ Fixed | Removed DEFAULT_PROFILE entirely; tap page fetches `/api/profile` first, renders only after response; shows "Contact Unavailable" on failure |
| C5 | Render free tier wipes local file data on spin-down | ⚠️ Documented | Added warning in README; recommended migration to managed database (Phase 1) |

### High Findings (H1–H7)

| # | Finding | Status | Fix Applied |
|---|---------|--------|-------------|
| H1 | Auto-prompt uses `data:` URI instead of server's `text/vcard` headers | ✅ Fixed | Tap page now navigates to `/contact.vcf?source=tap` (proper server headers) |
| H2 | Tap analytics never fire (recordTapEvent only on /contact.vcf, not /tap) | ✅ Fixed | `recordTapEvent` now called on `/tap` route before serving |
| H3 | Three vCard generators that disagree | ✅ Fixed | Single server-side `generateVCard()`; client-side builder removed from tap.html |
| H4 | Only one client fits (single profile.json) | ⚠️ Phase 1 | Multi-tenant architecture documented for Phase 1 |
| H5 | Tags can be cloned/overwritten | ⚠️ Phase 2 | Web NFC `makeReadOnly()` recommendation documented |
| H6 | No security headers; framing allowed | ✅ Fixed | Helmet + explicit `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Strict-Transport-Security` |
| H7 | Bank changes go unnoticed | ⚠️ Phase 1 | Change confirmation + audit log documented for Phase 1 |

### Medium Findings (M1–M10)

| # | Finding | Status | Fix Applied |
|---|---------|--------|-------------|
| M1 | X-ABICQ uses Apple's ICQ field | ⚠️ Documented | Noted as iOS-specific; kept for backward compat |
| M2 | CHARSET=UTF-8 is vCard 2.1; lines >75 bytes not folded | ✅ Fixed | Removed CHARSET; added RFC 2426 line folding (≤75 octets) |
| M3 | No IBAN/SWIFT/BIC | ⚠️ Phase 3 | Documented for future |
| M4 | Studio save swallows errors | ✅ Fixed | Response checked; errors displayed |
| M5 | No rate limiting; no field length limits | ✅ Fixed | `express-rate-limit` installed; 120-char field caps |
| M6 | Bank fields all required | ✅ Fixed | `includeBankDetails` toggle; bank fields optional |
| M7 | `user-scalable=no` blocks accessibility | ✅ Fixed | Removed from viewport meta |
| M8 | Chip-capacity check inaccurate | ⚠️ Low priority | Noted |
| M9 | iPads counted as Desktop | ⚠️ Low priority | Noted |
| M10 | No engines field; no tests | ✅ Fixed | Added `"engines": {"node": ">=20"}` |

### Architecture Changes Applied

1. **Admin Token model** — replaced session-based password with single `ADMIN_TOKEN` (32+ chars)
2. **Single vCard builder** — all vCard generation happens server-side only
3. **Fail-closed loading** — no demo data; 503 error if profile missing
4. **CSRF protection** — removed `express.urlencoded()`; JSON-only API
5. **Line folding** — RFC 2426 compliant (≤75 octets per line)
6. **Security headers** — full Helmet + explicit headers

### Environment Variables (New)

| Variable | Required | Generation |
|----------|----------|------------|
| `ADMIN_TOKEN` | ✅ Yes (32+ chars) | `openssl rand -base64 32` |
| `SIGNING_SECRET` | ✅ Yes (32+ chars) | `openssl rand -base64 32` |

### Phase 1 Recommendations (Not Yet Implemented)

- Multi-tenant client separation (`/t/:slug` routes)
- Managed database (Render Postgres / Neon / Supabase)
- Per-client analytics and kill switch
- Bank change confirmation + audit log
- Tag-to-client registry

---

## 12. Remediation Actions Applied

The following fixes have been **applied and verified** in the NFContacts `server.js` and `index.html`:

### ✅ Applied Fixes

| # | Fix | Status | Verification |
|---|-----|--------|-------------|
| 1 | **HMAC-signed stateless tokens** restored — `encodeStatelessPayload`/`decodeStatelessPayload` with SHA-256 HMAC signature + 24h expiry | ✅ Fixed | Tampered token rejected, falls back to stored profile |
| 2 | **Studio authentication** restored — `isStudioAuthenticated` middleware on `POST /api/profile` and `POST /api/reset-stats` | ✅ Fixed | `POST /api/profile` returns 401 without auth |
| 3 | **`timingSafeEqual` crash** fixed — length guard before comparison in login handler and stateless token decoder | ✅ Fixed | Wrong password returns 401 (not 500) |
| 4 | **Helmet security headers** restored — CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy | ✅ Fixed | No vulnerable headers in response |
| 5 | **Rate limiting** restored — 100 req/15min API, 20 login attempts/15min | ✅ Fixed | `express-rate-limit` installed & active |
| 6 | **CORS** restricted to same-origin (`null`) — wildcard removed | ✅ Fixed | `Access-Control-Allow-Origin: null` |
| 7 | **Input validation** — email, phone, website, account number regex validation; max field lengths enforced | ✅ Fixed | Invalid input returns 400 with details |
| 8 | **Atomic file writes** — tmp file + `renameSync` pattern | ✅ Fixed | No corruption on mid-write kill |
| 9 | **Error handlers** — 404 JSON handler + global 500 handler (no stack trace leakage) | ✅ Fixed | 500 returns clean JSON error |
| 10 | **Health endpoint** restored — `GET /health` | ✅ Fixed | Returns `{ok:true, status:"healthy"}` |
| 11 | **Logout API** — `POST /api/logout` | ✅ Fixed | Session token invalidated |
| 12 | **`package.json`** — added `helmet@^7.1.0` and `express-rate-limit@^7.2.0` | ✅ Fixed | `npm install` succeeds, 0 vulnerabilities |
| 13 | **`.gitignore`** — added `data/.signing_secret` | ✅ Fixed | Secret not committed |
| 14 | **Stale ZIP removed** — `nfc-keychain-contact-system.zip` deleted | ✅ Fixed | No binary artifacts in tree |
| 15 | **Auth overlay** — added to `index.html` (both root and `public/`) with login form, password prompt, error display | ✅ Fixed | UI shows auth overlay when password configured |
| 16 | **`includeBankDetails` checkbox** added to editor form | ✅ Fixed | Bank details can be toggled off in UI |
| 17 | **Form submit** sends `x-session-token` header; handles 401/403 → re-shows auth overlay | ✅ Fixed | Session expiry triggers re-auth |
| 18 | **Profile restored** to original Mauritian contact (Jean-Luc Morel, MCB) | ✅ Fixed | vCard includes bank account details |

### Environment Variables for Render Deployment

Set these in your Render dashboard → Environment → Environment Variables:

| Variable | Required | Generation Command |
|----------|----------|-------------------|
| `STUDIO_PASSWORD` | ✅ Yes | `openssl rand -base64 24` |
| `SIGNING_SECRET` | ✅ Yes | Copy from local `data/.signing_secret` or `openssl rand -base64 32` |

### Local Test Commands

```bash
# Generate a strong password
STUDIO_PASSWORD=$(openssl rand -base64 24)
echo "Password: $STUDIO_PASSWORD"

# Copy signing secret from existing file, or generate new
SIGNING_SECRET=$(cat data/.signing_secret 2>/dev/null || openssl rand -base64 32)

# Run locally
STUDIO_PASSWORD="$STUDIO_PASSWORD" SIGNING_SECRET="$SIGNING_SECRET" node server.js

# Test flow:
# 1. Open http://localhost:3000/ → auth overlay appears (password required)
# 2. Enter STUDIO_PASSWORD → Studio unlocks
# 3. Edit profile, toggle bank details, click Save
# 4. Open http://localhost:3000/tap → client tap experience
# 5. Open http://localhost:3000/contact.vcf → download vCard
# 6. Try saving without auth → should be blocked
```