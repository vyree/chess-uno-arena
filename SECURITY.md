# SECURITY.md — Protection Protocols

> Security rules the AI must NEVER violate under any circumstance.
> Scope diperbarui oleh Misi 2 (keputusan Sensei, 2026-10-21): login
> Google + database profil + deploy publik kini IN scope.

## 1. Credentials & Secrets

- **STRICTLY FORBIDDEN**: API key/password/token di kode, komentar, atau file commit.
- Proyek ini tetap TIDAK punya secret server-side. Env var: `PORT` dan
  `FIREBASE_PROJECT_ID` (pengenal project publik, bukan secret — mengaktifkan
  verifikasi token login di server).
- `public/firebase-config.js` berisi konfigurasi web Firebase (apiKey web
  adalah identifier publik bawaan Firebase, BUKAN secret) — keamanan data
  dijaga oleh rules database, bukan dengan menyembunyikan config ini.
- FORBIDDEN me-log isi pesan sensitif; log hanya event (bukan isi chat penuh bila tidak perlu).

## 2. Input Validation

- ALL input user (nickname, kode room, langkah catur, kartu UNO, chat) WAJIB divalidasi server-side.
- Deviasi tercatat dari template: tanpa Zod/Yup (menambah dependensi butuh approval; misi menetapkan dependensi minimal `ws` saja). Sebagai gantinya: **`game/validate.js` sebagai satu pintu validasi** — semua pesan WS melewati fungsi terpusat ini, bukan `if` tersebar. Aturan main divalidasi ulang oleh engine (`chess.js`/`uno.js`) — defense in depth.
- Sanitasi: nickname & chat di-strip dari tag HTML (`<`, `>`, `&` di-escape) sebelum disimpan/disiarkan (cegah XSS via innerHTML).

## 3. Authentication & Authorization

> STATUS (2026-10-21): **LOGIN DIPARKIR atas perintah Sensei.** Gerbang
> Google di bawah ini NONAKTIF — server berjalan mode nickname terbuka
> (verifikasi token hanya menyala bila FIREBASE_PROJECT_ID terisi DAN
> REQUIRE_AUTH=1), client tidak memuat Firebase sama sekali, dan progres
> pemain disimpan lokal di perangkat masing-masing (localStorage).
> Bagian ini dipertahankan sebagai desain bila login dihidupkan lagi.

- **Login Google wajib** (Firebase Auth) sebagai gerbang semua game.
  Server memverifikasi ID token Firebase secara kriptografis
  (`game/auth.js`: tanda tangan RS256 vs sertifikat x509 Google, cek
  issuer/audience/expiry) — aktif bila env `FIREBASE_PROJECT_ID` terisi;
  tanpa env server berjalan mode dev TERBUKA (khusus lokal) + peringatan log.
- **Identitas in-game HANYA nickname buatan sendiri.** Nama, email, dan
  foto Google DILARANG ditampilkan/dikirim ke pemain lain dalam bentuk
  apa pun. Server mengikat nickname dari klaim token terverifikasi.
- Rejoin kursi di mode auth wajib membuktikan uid yang sama dengan pemilik kursi.
- Otorisasi aksi berbasis `playerId` (UUID server-side) + kepemilikan room:
  - Pemain hanya bisa aksi di room-nya sendiri.
  - Hanya giliran pemain yang bersangkutan yang diterima (cek `state.turn`).
  - Aksi host (mulai game) hanya dari pembuat room.
- Rate limit: maks 20 pesan/detik per socket (lebih → disconnect paksa); chat 1 pesan/2 detik.

## 4. Error Handling

- Semua handler WS dibungkus try-catch; error tak terduga → kirim `{type:'error', message:'Terjadi kesalahan, coba lagi.'}` (ramah, Bahasa Indonesia).
- Stack trace hanya ke `console.error` server, TIDAK PERNAH ke client.
- Pesan error validasi: spesifik tapi aman (mis. "Kode room tidak ditemukan", "Bukan giliranmu").

## 5. Database & Queries

- **Realtime Database** (Firebase) hanya menyimpan profil: `users/{uid}`
  (nickname + statistik). State permainan live TIDAK disimpan di database —
  tetap di memori server.
- Server TIDAK PERNAH menyentuh database. Client menulis profilnya sendiri
  di bawah `database.rules.json`: cabang `users/{uid}` hanya bisa dibaca &
  ditulis pemilik uid tersebut; nickname terverifikasi string 1–16 karakter;
  statistik angka non-negatif; semua akses lain ditolak (terverifikasi:
  akses anonim → "Permission denied").

## 6. Pre-Merge Checklist

- [x] No secrets in the diff (tidak ada secret di proyek ini)
- [x] Semua aksi game cek kepemilikan room + giliran
- [x] Input divalidasi via `validate.js` + engine
- [x] Error tidak membocorkan info internal
- [x] Dependensi: hanya `ws` (disetujui eksplisit oleh misi/Arona)
