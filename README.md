# NFC Keychain Contact & Bank Account Transfer System

A full-stack Node.js/Express web application and RFC 2426 **vCard 3.0** generator that allows a professional to share their **Full Name, Phone Name, Email Address, and Bank Account Details** directly into a client's phone contacts with a single **NFC Keychain Tap** — 100% natively on **both iOS (iPhone) and Android** without requiring any third-party app on the client's phone.

---

## Security Features

- **Admin Token authentication** — single-editor model, all write operations protected
- **HMAC-SHA256 signed stateless tokens** — 24h expiry, signature verified before serving
- **Helmet security headers** — CSP, X-Frame-Options: DENY, HSTS, nosniff, Referrer-Policy: no-referrer
- **Rate limiting** — 100 req/15min API, 10 login attempts/15min
- **Input validation** — email, phone, account number format checks; 120-char field caps
- **RFC 2426 line folding** — all vCard lines ≤ 75 octets
- **Atomic file writes** — tmp file + renameSync (no corruption on crash)
- **Fail-closed profile loading** — 503 error instead of serving demo data
- **CORS restricted** — same-origin only (blocks CSRF from external sites)

---

## Features

- **Universal iOS + Android Tap Compatibility**: NDEF URI record triggers native Contacts sheet/importer
- **Dual-Field Bank Account Storage**: Bank Name, Account Holder, Account Number in vCard `NOTE` field + `X-ABLabel` custom field
- **NFC Keychain Studio (`/`)**:
  - Live profile & bank details editor with admin token auth
  - iPhone/Android/Fallback simulators
  - NTAG213/215/216 byte-capacity checker
  - Web NFC Hardware Writer (`NDEFReader`) for Chrome Android + QR code for NFC Tools
- **Stateless Self-Contained URLs** (`/tap?d=<signed-token>`) — works on GitHub Pages & everywhere
- **Server-Stored Dynamic URLs** (`/tap`) — auto-triggers native Contacts sheet via `text/vcard` headers

---

## Project Structure

```text
├── server.js                      # Express server & RFC 2426 vCard 3.0 engine
├── package.json                   # Project dependencies & start script
├── data/
│   └── profile.json               # Saved professional & bank account profile
├── public/
│   ├── index.html                 # NFC Keychain Studio, Simulator & Web NFC Writer
│   └── tap.html                   # Client NFC Tap Experience (Auto-prompt + Fallback Card)
└── ARCHITECTURE_AND_NFC_GUIDE.md  # Full hardware & NFC tag programming blueprint
```

---

## Quick Start (Local Development)

```bash
# Install dependencies
npm install

# Set required environment variables
export ADMIN_TOKEN=$(openssl rand -base64 32)
export SIGNING_SECRET=$(openssl rand -base64 32)

# Start the server
npm start
```

The server starts at `http://localhost:3000`:
- **Studio & NFC Programmer**: `http://localhost:3000/`
- **Client NFC Tap URL**: `http://localhost:3000/tap`
- **Direct vCard Stream**: `http://localhost:3000/contact.vcf`

---

## Deploying to Production

### Render.com / Railway.app / Fly.io

1. **Connect your GitHub repository.**
2. **Build Command**: `npm install`
3. **Start Command**: `npm start`
4. **Set Environment Variables** (required):

| Variable | Required | Generation |
|----------|----------|------------|
| `ADMIN_TOKEN` | ✅ Yes (32+ chars) | `openssl rand -base64 32` |
| `SIGNING_SECRET` | ✅ Yes (32+ chars) | `openssl rand -base64 32` |

5. **Program your NFC tag** with: `https://your-app-name.onrender.com/tap`

### Important: Data Persistence

Render's free tier spins down after 15 minutes of inactivity. **Local file storage (`data/profile.json`) will be lost on spin-down.** For production use, migrate to a managed database (Render Postgres, Neon, or Supabase). See `RED-TEAM-REPORT.md` Section 11 for the multi-tenant architecture plan.

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ADMIN_TOKEN` | ✅ Yes | — | Admin authentication token (32+ chars). Server runs read-only without it. |
| `SIGNING_SECRET` | ✅ Yes | — | HMAC signing key for stateless URL tokens. |
| `PORT` | No | `3000` | Server port |
