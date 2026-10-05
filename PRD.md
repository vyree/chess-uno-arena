# PRD.md — Product Requirements Document

> Chess + UNO Arena: website game multiplayer (catur & UNO) via room, tanpa login.

## 1. Product Summary

| Item | Content |
|---|---|
| Product name | Chess + UNO Arena |
| Problem solved | Teman-teman Sensei butuh tempat main catur & UNO bareng secara online yang simpel — tanpa install aplikasi, tanpa daftar akun. |
| Target users | Teman-teman Noir Sensei; siapa pun yang punya link (tanpa login, cukup nickname). |
| Platform | Web (Node.js + WebSocket server; frontend HTML/CSS/JS vanilla, mobile-first). |

## 2. Goals & Boundaries

- Main goal: "Done" = server jalan lokal; 2 pemain bisa menyelesaikan 1 permainan catur penuh (aturan standar) dan 2–6 pemain bisa menyelesaikan 1 ronde UNO; room terkola dengan baik; tidak crash saat disconnect / kode room salah.
- Out of scope (DO NOT build): akun/login/registrasi, database persisten, matchmaking otomatis/rating, chat suara/video, AI/bot lawan komputer, deploy publik/VPS, pembayaran.
- Assumptions: dijalankan di localhost (belum ada VPS); satu proses Node.js cukup untuk 20–100 pemain (turn-based, ringan); client modern dengan WebSocket.

## 3. User Stories

1. US-01: **As a** pemain, **I want** masuk hanya dengan nickname (tanpa daftar), **so that** bisa langsung main.
   - Acceptance criteria: landing page meminta nickname (1–16 karakter); tidak ada password; nickname disanitasi.
2. US-02: **As a** pemain, **I want** membuat room catur/UNO dan mendapat kode 6 karakter, **so that** bisa mengundang teman.
   - Acceptance criteria: kode unik, mudah dibaca (tanpa 0/O/1/I/L); room muncul di daftar room menunggu.
3. US-03: **As a** pemain, **I want** gabung room via kode, **so that** bisa main bareng teman.
   - Acceptance criteria: kode salah → pesan error ramah (Bahasa Indonesia); room penuh → ditolak dengan jelas.
4. US-04: **As a** pemain catur, **I want** aturan catur standar ditegakkan server, **so that** permainan adil.
   - Acceptance criteria: rokade, en passant, promosi, skak/skakmat, stalemate, 50 langkah, repetisi 3x — semua divalidasi server; langkah ilegal ditolak.
5. US-05: **As a** pemain UNO, **I want** aturan UNO standar (disederhanakan seperlunya), **so that** seru seperti main kartu asli.
   - Acceptance criteria: 108 kartu; skip/reverse/+2/wild/wild+4; penalti lupa "UNO!"; pemenang ronde = kartu habis duluan; skor kumulatif.
6. US-06: **As a** pemain, **I want** permainan tetap adil saat lawan disconnect, **so that** tidak digantung.
   - Acceptance criteria: tenggang reconnect 60 detik; lewat itu = kalah/keluar; server tidak crash.

## 4. Feature Flow

1. Buka landing → isi nickname → pilih Catur / UNO.
2. Klik "Buat Room" (dapat kode) atau "Gabung" (isi kode) → masuk lobby.
3. Lobby: daftar pemain; host/pemain pertama menekan "Mulai".
4. Main: state tersinkron via WebSocket; giliran + timer 60 detik.
5. Game over: hasil + skor; pilihan "Main Lagi" atau "Keluar".
6. Room kosong → otomatis dihapus.

## 5. Business Rules

- Satu room = satu game (catur: 2 pemain; UNO: 2–6 pemain).
- Semua aksi game divalidasi di SERVER; client tidak dipercaya.
- Timer giliran 60 detik: catur → kalah waktu; UNO → otomatis ambil kartu & lewat.
- Disconnect: tenggang 60 detik untuk reconnect; lewat itu = forfeit (catur: lawan menang; UNO: pemain dikeluarkan, kartunya dikocok ulang ke deck).
- UNO: deklarasi "UNO!" wajib via flag saat memainkan kartu hingga sisa 1; lupa = penalti ambil 2. Tanpa challenge wild+4, tanpa stacking +2/+4 (disederhanakan — lihat laporan).
- Rate limit: maks ~20 pesan/detik per socket; chat 1 pesan / 2 detik.
- Nickname: 1–16 karakter, disanitasi (strip tag HTML).

## 6. Priorities

| Feature | Priority | Phase |
|---|---|---|
| Room (buat/gabung/lobby/kode) | Must | 1 |
| Catur full-rules + validasi server | Must | 2 |
| UNO standar + skor ronde | Must | 3 |
| Timer giliran + disconnect handling | Must | 4 |
| UI rapi, responsif HP, Bahasa Indonesia | Must | 5 |
| Daftar room menunggu | Should | 1 |
| Chat lobby | Should | 5 |
| Suara/animasi mewah | Nice | — |
| Bot lawan komputer | Nice (out of scope) | — |

> AI: work in priority order. DO NOT touch "Nice" features until all
> "Must" items are done and the user approves.
