# NFC Keychain Contact & Bank Account Transfer System

A full-stack Node.js/Express web application and RFC 2426 **vCard 3.0** generator that allows a professional to share their **Full Name, Phone Number, Email Address, and Bank Account Details** directly into a client's phone contacts with a single **NFC Keychain Tap** — 100% natively on **both iOS (iPhone) and Android** without requiring any third-party app on the client's phone.

---

## Features

- **Universal iOS + Android Tap Compatibility**: Uses an NDEF URI record (`/tap` or `/contact.vcf`) that triggers the native iOS Safari Contacts sheet and Android Contacts importer immediately on tap.
- **Dual-Field Bank Account Storage in Contacts**: Embeds **Bank Name**, **Account Holder Name**, and **Bank Account Number** inside the universal vCard `NOTE` field *and* as a custom labeled `Bank (...)` contact row (`X-ABLabel`).
- **Immediate "Add to Contacts" Auto-Prompt + Fallback Card (`/tap`)**: Automatically pops up the native "Add to Contacts" sheet on load while showing a fallback card underneath with a one-tap **"Copy Account #"** button for instant bank transfers.
- **NFC Keychain Studio (`/`)**:
  - Live profile & bank details editor.
  - Interactive **iPhone (iOS Sheet)**, **Android Prompt**, and **Fallback Card** simulator.
  - Real-time **NTAG213 (144B) / NTAG215 (504B) / NTAG216 (888B)** byte-capacity checker.
  - Built-in **Web NFC Hardware Writer (`NDEFReader`)** for Chrome on Android + QR code & guide for **NFC Tools** on iOS/Android.
  - Supports both **Server-Stored Dynamic URLs** (`/tap`) and **Stateless Self-Contained URLs** (`/tap?d=<base64url>`).

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
npm install
npm start
```

The server starts at `http://localhost:3000`:
- **Studio & NFC Programmer**: `http://localhost:3000/`
- **Client NFC Tap URL**: `http://localhost:3000/tap`
- **Direct vCard Stream**: `http://localhost:3000/contact.vcf`

---

## Deploying to Production (For Your Physical NFC Keychain)

Once pushed to GitHub, you can deploy this repository for free in 1–2 minutes on any Node.js hosting provider:

1. **Render.com / Railway.app / Fly.io**:
   - Connect your GitHub repository.
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
2. Once deployed, open your live `https://your-app-name.onrender.com` URL, save your profile details, and program `https://your-app-name.onrender.com/tap` onto your **NTAG213 / NTAG215 / NTAG216** keychain.
