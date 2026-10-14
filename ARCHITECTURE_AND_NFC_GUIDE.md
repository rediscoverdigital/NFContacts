# NFC Keychain Contact & Bank Account Transfer System
## Complete Systems Architecture & Hardware Programming Blueprint

---

## 1. Executive Architectural Summary: The iOS vs. Android NFC Reality

When designing a physical NFC keychain that transfers **Name, Phone Number, Email, and Bank Account Details** directly into a client's Contacts app across **both iOS and Android** without requiring the client to install an app, there is one critical operating system constraint you must engineer around:

| Feature | Android (OS-Level NFC Reader) | iOS (iPhone Background NFC Reader) |
| :--- | :--- | :--- |
| **Raw `text/vcard` NDEF MIME Record** | ✅ Supported natively offline | ❌ **Ignored** by iOS Background Tag Reader (requires a 3rd-party app open) |
| **`https://` NDEF URI Record** | ✅ Supported natively (Lock/Home screen) | ✅ **Supported natively** on iPhone XS & newer (iOS 14+) |
| **HTTP `Content-Type: text/vcard` Response** | ✅ Launches native Android Contacts import | ✅ **Slides up native iOS "Add to Contacts" sheet** |

### Why Our Hybrid NDEF URI -> Instant `text/vcard` Architecture Wins
Instead of writing a raw `text/vcard` MIME record onto the NFC chip (which fails silently when tapped against an iPhone), we program the NFC keychain with a **single NDEF URI Record (`https://your-domain/tap`)**:

1. **Client taps the keychain** against the top-back of their iPhone or center-back of their Android phone.
2. **OS Native Notification** pops up immediately (zero apps required).
3. **Immediate "Add to Contacts" Sheet (`/tap` -> `/contact.vcf`)**:
   - Within `180ms` of opening `/tap`, the page automatically triggers `/contact.vcf` (`Content-Type: text/vcard; charset=utf-8`, `Content-Disposition: inline; filename="Contact.vcf"`).
   - **On iOS (Safari)**: iOS immediately slides up the native Apple Contacts modal sheet pre-populated with **Full Name, Phone, Email, Labeled Bank Account field, and Bank Details inside Notes**—with a single **"Save"** button.
   - **On Android (Chrome / Samsung Internet)**: Android immediately prompts to save the `.vcf` into Phone / Google Contacts.
4. **Fallback Interactive Card Underneath**:
   - Once the client saves the contact (or if they want to pay immediately via mobile banking), the fallback screen remains open underneath with a **one-tap "Copy Account Number"** button so they don't even have to open their Contacts app to copy the bank account number into their banking app.
5. **Dynamic Updates Without Reprogramming Hardware**:
   - Because the keychain points to `/tap` (only ~30 bytes, fitting easily on the cheapest **NTAG213** chip), you can update your phone number, email, or bank account number anytime in the Studio without ever rewriting the physical keychain.

---

## 2. RFC 2426 vCard 3.0 Schema for Contact + Bank Account Storage

Neither Apple Contacts nor Google Contacts has a dedicated native `BANK:` vCard property in their standard UI. If you invent a non-standard tag like `X-BANK:12345`, both iOS and Android will silently discard or hide it.

To guarantee **100% visibility and copyability** on both iOS and Android, our engine embeds the banking details in **two complementary places** inside the `.vcf` payload:

1. **Universal `NOTE` Property**: Rendered prominently at the bottom of the contact card on every iPhone and Android device.
2. **Apple/Android Custom Labeled Property (`item1.X-ABICQ` + `item1.X-ABLabel`)**: Creates a dedicated, one-tap copyable row labeled `Bank (<Bank Name>)` right below the email address.

### Example Generated `.vcf` Payload
```vcard
BEGIN:VCARD
VERSION:3.0
N;CHARSET=UTF-8:Morel;Jean-Luc;;;
FN;CHARSET=UTF-8:Jean-Luc Morel
ORG;CHARSET=UTF-8:Morel Advisory Partners
TITLE;CHARSET=UTF-8:Senior Consultant & Principal Advisor
TEL;TYPE=CELL,VOICE,PREF:+230 5728 9400
EMAIL;TYPE=PREF,INTERNET:jl.morel@moreladvisory.com
NOTE;CHARSET=UTF-8:=== BANK ACCOUNT DETAILS ===\nBank Name: Mauritius Commercial Bank (MCB)\nAccount Holder: Jean-Luc Morel\nAccount Number: 000448291038
item1.X-ABICQ;CHARSET=UTF-8:000448291038
item1.X-ABLabel;CHARSET=UTF-8:Bank (Mauritius Commercial Bank (MCB))
REV:2026-10-14T10:00:00.000Z
END:VCARD
```

---

## 3. NFC Hardware Selection Guide (Keychain Engineering)

To ensure reliable scanning on both iPhones and Android phones, use **NFC Forum Type 2 Tags** operating at **13.56 MHz (ISO/IEC 14443 Type A)** from the NXP **NTAG21x** family:

| Chip Model | Usable NDEF Memory | Best Use Case | Compatible with `/tap` URL? | Compatible with Stateless URL (`?d=...`)? |
| :--- | :--- | :--- | :--- | :--- |
| **NTAG213** | **144 Bytes** | Standard URL keychains (cheapest, widely available in epoxy/leather keychains) | ✅ Yes (~35–60 bytes) | ❌ Too small for full encoded payload |
| **NTAG215** | **504 Bytes** | Mid-size tags; supports both hosted URLs and self-contained stateless URLs | ✅ Yes | ✅ Yes (~260–340 bytes) |
| **NTAG216** | **888 Bytes** | High-capacity tags | ✅ Yes | ✅ Yes |

### Crucial Physical Keychain Design Tips
1. **Avoid Unshielded Metal Keychains**: Metal detunes the 13.56 MHz magnetic field and prevents iPhones/Androids from reading the tag.
   - Choose **PVC, Epoxy, Acrylic, Wood, or Leather** keychains, **OR** ensure your NFC sticker/inlay includes a **ferrite anti-metal shield layer** ("On-Metal NTAG213/215").
2. **Optimal Antenna Size**: Use a keychain inlay with at least a **25mm–30mm circular coil antenna**. Tiny 8mm–12mm tags require pinpoint alignment with the iPhone's top edge.
3. **Where to Tap on Client Phones**:
   - **iPhone (XS, 11, 12, 13, 14, 15, 16, 17+)**: Tap the keychain right against the **top-back edge** of the iPhone (next to the camera bump). The screen must be awake (lock screen or home screen works; no app needed).
   - **Android (Samsung, Pixel, Xiaomi, etc.)**: Tap against the **center-back** of the phone (phone unlocked).

---

## 4. How to Program & Lock Your Physical NFC Keychain

### Method A: Direct Browser Programming (Android Chrome via Web NFC)
1. Open the **NFC Keychain Contact Studio** (`/`) in Chrome on an Android phone.
2. Edit your Name, Phone, Email, and Bank Account details and click **Save Profile & Update NFC Payload**.
3. Click **"Write to NFC Keychain Now (Web NFC)"** and hold your NFC keychain against the back of the phone for 1 second.

### Method B: Programming on iPhone or Android using "NFC Tools" (Free App)
1. Install **NFC Tools** (by Wakdev) from the iOS App Store or Google Play Store.
2. In our web app, click **Copy NFC URL** (e.g., `https://your-host/tap`).
3. Open **NFC Tools** -> tap **Write** -> **Add a record** -> **URL / URI**.
4. Paste the copied URL (ensure `https://` is selected as the prefix) and tap **OK**.
5. Tap **Write / XX Bytes** and hold your NFC keychain to the top of your iPhone (or back of your Android).
6. **Protect Against Accidental Overwriting**:
   - In NFC Tools, go to the **Other** tab -> **Set Password** (recommended over "Lock Tag", as password protection prevents clients from overwriting your keychain while still allowing you to unlock and repurpose the keychain in the future).
