# ♟️ Chess + UNO Arena 🃏

Website game multiplayer **Catur** dan **UNO** — main online **tanpa login**, cukup nickname + kode room 6 karakter.

## ✨ Fitur

- **Tanpa login/registrasi** — isi nickname, langsung main
- **Catur 2 pemain**: aturan standar lengkap (rokade, en passant, promosi, skak/skakmat, remis: stalemate, 50 langkah, repetisi 3x). Semua langkah divalidasi server
- **UNO 2–6 pemain**: 108 kartu standar, skip/reverse/+2/wild/wild+4, tombol **UNO!** (lupa = penalti ambil 2), skor antar ronde
- **Real-time** via WebSocket: timer giliran 60 detik, chat room, daftar room menunggu pemain
- **Tahan disconnect**: tenggang reconnect 60 detik, lalu forfeit/keluar otomatis
- **Responsif untuk HP**, UI Bahasa Indonesia

## 🚀 Cara Menjalankan

Butuh **Node.js 18+**.

```bash
cd ~/workspace/chess-uno-arena
npm install     # hanya satu dependensi: ws
npm start       # server jalan di http://localhost:3000
```

Lalu buka **http://localhost:3000** di browser (HP/laptop satu WiFi juga bisa, pakai IP komputer).

### Cara main (untuk Sensei coba)
1. Buka `http://localhost:3000` → isi **nickname** → klik **Masuk**
2. Pilih **♟️ Catur** atau **🃏 UNO**
3. **Buat Room** (dapat kode 6 karakter, mis. `KX7Q2M`) atau **Gabung** pakai kode dari teman
4. Di lobby: untuk catur butuh 2 pemain, UNO 2–6 pemain → klik **Mulai Game**
5. Main! Untuk coba sendiri, buka dua tab/browser berbeda dengan nickname berbeda lalu gabung ke room yang sama

## 🧪 Testing

```bash
npm run check     # cek sintaks semua file JS (pengganti linter)
npm test          # 32 unit tests (catur, UNO, rooms) — node:test
npm run simulate  # simulasi integrasi: catur sampai skakmat, UNO satu ronde,
                  # disconnect + rejoin, kode salah & spam — semua via WebSocket asli
```

Hasil terakhir (2026-10-05): **32/32 unit tests hijau**, **4/4 skenario simulasi hijau**. Detail: [TESTING.md](TESTING.md).

## 📁 Struktur

```
├── server.js          # server HTTP + WebSocket, logika room/lobby/timer
├── game/
│   ├── chess.js       # engine catur (aturan lengkap + validasi)
│   ├── uno.js         # engine UNO (108 kartu, penalti, skor)
│   ├── rooms.js       # manajemen room (kode unik, hapus saat kosong)
│   └── validate.js    # validasi & sanitasi semua pesan client
├── public/
│   ├── index.html     # landing + lobby + papan catur + meja UNO
│   ├── app.js         # client WebSocket + UI
│   └── style.css      # tampilan playful, responsif HP
└── test/
    ├── chess.test.js  # 13 tests
    ├── uno.test.js    # 13 tests
    ├── rooms.test.js  # 6 tests
    └── simulate.js    # simulasi end-to-end kedua game
```

Dokumen desain: [PRD.md](PRD.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [DESIGN.md](DESIGN.md) · [SECURITY.md](SECURITY.md) · [DEPLOYMENT.md](DEPLOYMENT.md) · [TASK_INSTRUCTION.md](TASK_INSTRUCTION.md)

## ⚠️ Catatan

- Data game tersimpan **in-memory** — restart server = semua room hilang (sengaja, sesuai desain untuk skala kecil)
- **Jangan deploy ke publik** sebelum ada VPS + review keamanan (lihat [DEPLOYMENT.md](DEPLOYMENT.md) & [SECURITY.md](SECURITY.md))
- Aturan UNO yang disederhanakan: wild+4 **tanpa challenge**, tidak ada stacking +2/+4
