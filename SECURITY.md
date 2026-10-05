# SECURITY.md — Protection Protocols

> Security rules the AI must NEVER violate under any circumstance.
> Disesuaikan untuk proyek ini: tanpa auth/DB/pembayaran (out of scope PRD).

## 1. Credentials & Secrets

- **STRICTLY FORBIDDEN**: API key/password/token di kode, komentar, atau file commit.
- Proyek ini tidak butuh secret sama sekali; satu-satunya env var adalah `PORT`.
- Sediakan `.env.example` (hanya `PORT=3000`).
- FORBIDDEN me-log isi pesan sensitif; log hanya event (bukan isi chat penuh bila tidak perlu).

## 2. Input Validation

- ALL input user (nickname, kode room, langkah catur, kartu UNO, chat) WAJIB divalidasi server-side.
- Deviasi tercatat dari template: tanpa Zod/Yup (menambah dependensi butuh approval; misi menetapkan dependensi minimal `ws` saja). Sebagai gantinya: **`game/validate.js` sebagai satu pintu validasi** — semua pesan WS melewati fungsi terpusat ini, bukan `if` tersebar. Aturan main divalidasi ulang oleh engine (`chess.js`/`uno.js`) — defense in depth.
- Sanitasi: nickname & chat di-strip dari tag HTML (`<`, `>`, `&` di-escape) sebelum disimpan/disiarkan (cegah XSS via innerHTML).

## 3. Authentication & Authorization

- Tanpa login sesuai PRD. Otorisasi berbasis `playerId` (UUID server-side) + kepemilikan room:
  - Pemain hanya bisa aksi di room-nya sendiri.
  - Hanya giliran pemain yang bersangkutan yang diterima (cek `state.turn`).
  - Aksi host (mulai game) hanya dari pembuat room.
- Rate limit: maks 20 pesan/detik per socket (lebih → disconnect paksa); chat 1 pesan/2 detik.

## 4. Error Handling

- Semua handler WS dibungkus try-catch; error tak terduga → kirim `{type:'error', message:'Terjadi kesalahan, coba lagi.'}` (ramah, Bahasa Indonesia).
- Stack trace hanya ke `console.error` server, TIDAK PERNAH ke client.
- Pesan error validasi: spesifik tapi aman (mis. "Kode room tidak ditemukan", "Bukan giliranmu").

## 5. Database & Queries

- Tidak ada database. Tidak ada query string.

## 6. Pre-Merge Checklist

- [x] No secrets in the diff (tidak ada secret di proyek ini)
- [x] Semua aksi game cek kepemilikan room + giliran
- [x] Input divalidasi via `validate.js` + engine
- [x] Error tidak membocorkan info internal
- [x] Dependensi: hanya `ws` (disetujui eksplisit oleh misi/Arona)
