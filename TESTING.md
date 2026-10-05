# TESTING.md — Quality Assurance

> "Done" = code + green tests, bukan sekadar jalan di mesin AI.

## 1. Coverage Standards

- Target: 100% aturan main kritis teruji (engine catur & UNO), semua pesan WS happy+error path teruji via simulasi.
- MUST have tests:
  - `game/chess.js`: jalan semua bidak, rokade (2 sisi × 2 warna), en passant, promosi, skak, skakmat (fool's mate & scholar's mate), stalemate, 50 langkah, repetisi 3x, penolakan langkah ilegal.
  - `game/uno.js`: deck 108, deal 7, kartu aksi (skip/reverse/+2/wild/+4), penalti UNO, skoring, menang ronde.
  - `game/rooms.js` + `server.js`: buat/gabung/keluar room, kode salah, room penuh, disconnect.
- May skip (with reason): styling/CSS murni (verifikasi visual manual), `public/app.js` (diuji via simulasi WS + cek manual).

## 2. Test Types

| Type | When | Tool |
|---|---|---|
| Unit | `game/chess.js`, `game/uno.js`, `game/validate.js` | `node:test` bawaan Node |
| Integration | 2+ client WS main catur & UNO sampai selesai; disconnect; kode salah | `test/simulate.js` (client `ws`) |
| E2E browser | opsional — diganti cek manual oleh Sensei | — |

## 3. Test Writing Rules

- Satu file test memirror satu file source: `game/chess.js` → `test/chess.test.js`.
- Nama deskriptif: `test('menolak rokade saat raja sedang skak')`.
- Independen: tiap test buat state fresh; tanpa urutan ketergantungan.
- FORBIDDEN: test tanpa assertion / test flaky.

## 4. How to Run

```bash
npm install          # hanya ws
node --check server.js && node --check game/*.js   # syntax (pengganti lint; didokumentasikan di AGENTS.md)
npm test             # unit tests (node:test)
node test/simulate.js  # simulasi integrasi kedua game sampai selesai
```

## 5. Per-Task Definition of Done

- [x] Code follows `AGENTS.md` and `ARCHITECTURE.md`
- [x] `node --check` bersih untuk semua file JS
- [x] Unit tests baru ditulis & semua hijau
- [x] `test/simulate.js` hijau (catur selesai + UNO selesai + disconnect + kode salah)
- [x] No `console.log` debugging tersisa (log server seperlunya OK)
- [x] `SECURITY.md` checklist satisfied

## 6. Hasil Pengujian (2026-10-05)

Lingkungan: Node.js v24.20.0, server lokal `http://localhost:3000`.

### Unit tests — 32/32 hijau ✅
`npm test` (`node --test test/chess.test.js test/uno.test.js test/rooms.test.js`)

| File | Jumlah | Cakupan |
|---|---|---|
| `test/chess.test.js` | 13 | fool's mate & scholar's mate, rokade, en passant, promosi, stalemate, 50 langkah, repetisi 3x, tolak langkah ilegal |
| `test/uno.test.js` | 13 | deck 108 kartu, deal 7, skip/reverse/+2/wild/wild+4, penalti lupa UNO, skor, menang ronde |
| `test/rooms.test.js` | 6 | buat/gabung/keluar room, kode unik, kode salah, room penuh, hapus otomatis saat kosong |

### Simulasi integrasi — 4/4 skenario hijau ✅
`node test/simulate.js` (client WebSocket sungguhan, bukan mock)

| # | Skenario | Hasil |
|---|---|---|
| 1 | Catur sampai skakmat (2 client, scholar's mate) | room code 6 karakter ✅, skakmat terjadi ✅, hasil 1-0 ✅, `game_over` diterima client ✅ |
| 2 | UNO satu ronde selesai (3 client, main valid) | ronde selesai ✅, ada pemenang ✅, ronde baru dimulai (round 2) ✅ |
| 3 | Disconnect brutal + rejoin dalam masa tenggang | server tetap responsif ✅, rejoin berhasil ✅, state game terkirim ulang ✅ |
| 4 | Kode room salah & pesan sampah & spam | kode salah ditolak ramah ✅, pesan bukan-JSON ditolak tanpa crash ✅, aksi tanpa room ditolak ✅, server hidup setelah 60 pesan spam ✅ |

### Bug yang ditemukan & diperbaiki saat testing
1. **Kartu yang baru diambil tidak bisa dimainkan** — `server.js` memanggil `uno.playCard` untuk semua langkah; sudah diperbaiki memakai `uno.playDrawnCard` bila `cardId` = kartu yang baru diambil (`drewThisTurn`).
2. **Driver simulasi UNO macet (race antar-client)** — bukan bug server: beberapa waiter `game_state` berebut pesan. Diperbaiki dengan pola polling: tiap 60 ms baca state terbaru tiap client, satu aksi per putaran.
3. **`deadline` timer giliran tidak terkirim ke client** (ditemukan Raphael, 2026-10-05) — `server.js` memanggil `sendGameState(room)` SEBELUM `startTurnTimer(room)` di 7 tempat (start game, tiap langkah catur/UNO, draw, pass, ronde baru, timeout UNO), sehingga `game_state.deadline` selalu `null` dan countdown frontend (`public/app.js` baris 407–408) menampilkan "⏱️ --" sampai ada langkah pertama. Diperbaiki: `startTurnTimer(room)` selalu dipanggil SEBELUM `sendGameState(room)`. Diverifikasi: client menerima `deadline` ≈ 60 detik sejak game dimulai. Timer tetap jalan di server walau client tidak melihatnya (tidak ada game yang macet).

### Verifikasi ulang oleh Raphael (2026-10-05, ~15:10 WIB)
- Server lama dari sesi sebelumnya masih jalan di port 3000 dengan kode basi (EADDRINUSE saat start baru) → dimatikan, server fresh dijalankan dari kode terkini.
- `npm test`: 32/32 hijau ✅
- `node test/simulate.js`: 15/15 check hijau ✅ (catur skakmat, UNO ronde penuh + ronde baru, disconnect/rejoin, kode salah/spam)
- `npm run check` (`node --check` semua file JS): bersih ✅
- Tes khusus timer: `deadline` diterima client ≈ 60 detik setelah `start_game` ✅
- Log server selama semua tes: bersih, tanpa error/crash ✅

### Belum diuji
- Verifikasi visual/manual di browser oleh manusia (ditandai untuk Sensei).
- Beban 20–100 pemain bersamaan (turn-based, ringan; dihitung cukup, belum di-load-test).
- Timeout giliran 60 detik penuh secara real-time (timer terverifikasi ter-arm via `deadline`; pemicunya tidak ditunggu 60 detik penuh dalam tes).
