# ARCHITECTURE.md — The Code Map

> The code map. The AI MUST follow this map.
> FORBIDDEN to create duplicate folders/files or anything outside this
> structure without user approval.

## 1. Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Language | JavaScript (Node.js, CommonJS) | Node 24 |
| Realtime | `ws` (WebSocket) | pinned in package.json |
| Frontend | HTML + CSS + vanilla JS (no framework) | — |
| Database | none (in-memory rooms; auto-delete saat kosong) | — |
| Auth | none (nickname saja, tanpa login — sesuai PRD) | — |
| Hosting | localhost (belum ada VPS — JANGAN deploy publik) | — |
| Test | `node:test` bawaan Node (tanpa dependensi tambahan) | — |

## 2. Folder Structure

```
~/workspace/chess-uno-arena/
├── *.md                  # 8 dokumen template + README.md
├── package.json          # deps: ws (pinned)
├── .env.example          # PORT (default 3000)
├── server.js             # HTTP static + WS server + routing pesan + timer
├── game/
│   ├── chess.js          # engine catur: state, legal moves, validasi, status
│   ├── uno.js            # engine UNO: deck, giliran, aksi, skor
│   ├── rooms.js          # RoomManager: buat/gabung/keluar, kode, cleanup
│   └── validate.js       # validasi skema pesan + sanitasi (satu pintu)
├── public/
│   ├── index.html        # semua layar (landing/lobby/catur/uno)
│   ├── style.css         # design tokens sbg CSS variables
│   └── app.js            # WS client + UI logic (TANPA aturan main!)
└── test/
    ├── chess.test.js     # unit: engine catur (node:test)
    ├── uno.test.js       # unit: engine UNO (node:test)
    └── simulate.js       # integrasi: 2+ client WS main sampai selesai
```

**Import rules:**
- `public/app.js` TIDAK boleh berisi aturan catur/UNO (hanya render + kirim aksi).
- Semua aturan & validasi di `game/` (server-side, otoritatif).
- `server.js` hanya routing pesan, timer, dan broadcast — logika game di `game/`.
- `game/validate.js` adalah satu-satunya pintu validasi pesan masuk.

## 3. Database Schema

Tidak ada database. State in-memory:

| Struktur | Isi | Lifecycle |
|---|---|---|
| `rooms: Map<code, Room>` | id, game, players[], state, timers | dibuat saat create, hapus saat kosong |
| `players: Map<playerId, Player>` | id, nickname, socket, roomCode | hapus saat disconnect permanen |
| Chess state | board 8x8, turn, castling, epSquare, halfmove, history | per room |
| UNO state | deck, discard, hands, turnIdx, direction, scores | per room |

## 4. Naming Conventions

- File: `camelCase.js` untuk util/engine (`chess.js`, `rooms.js`); `server.js` entry point.
- Fungsi: `camelCase` deskriptif (`generateLegalMoves`, `applyUnoPlay`).
- Pesan WS: `snake_case` (`create_room`, `chess_move`, `game_state`).
- Konstanta: `UPPER_SNAKE_CASE` (`MAX_PLAYERS_UNO`, `TURN_TIMEOUT_MS`).
- Komentar kode: English. UI/teks pengguna: Bahasa Indonesia.

## 5. Patterns in Use

- Otoritatif server: client hanya mengirim *niat aksi*; server validasi & siarkan *state*.
- State snapshot penuh tiap update (sederhana, cukup untuk turn-based).
- Satu `validate.js` sebagai choke point validasi semua pesan masuk.
- Timer per giliran via `setTimeout`, dibersihkan saat giliran berpindah/game over.
