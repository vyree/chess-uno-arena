# DESIGN.md — The UI/UX Core

> Design tokens and styling rules. AI-built UI MUST stay consistent
> with these tokens. FORBIDDEN to hardcode colors/fonts in components.

## 1. Design Tokens

### Colors

| Token | Value | Used for |
|---|---|---|
| `--color-primary` | #7a68d6 | tombol utama, link aktif (ungu pastel, tema Sensei 2026-10-21) |
| `--color-primary-deep` | #6553c2 | teks/tombol di atas latar lavender |
| `--color-secondary` | #9d8ae8 | aksen sekunder |
| `--color-success` | #3fae6a | status menang / valid |
| `--color-warning` | #e0a34e | timer < 15 detik, peringatan |
| `--color-danger` | #e05c5c | error, kalah, tombol bahaya |
| `--color-bg` | #f4f1fd | background utama (lavender sangat muda) |
| `--color-surface` | #ffffff | kartu, panel |
| `--color-text` | #38304f | teks utama (plum gelap) |
| `--color-text-muted` | #7e74a3 | teks sekunder (ungu keabuan) |
| `--color-lav` | #ece5fc | isian lavender (badge, bingkai) |
| `--color-lav-2` | #d9ccf9 | garis tepi lavender |
| `--color-plum` | #3d2b63 | plum gelap (toast, teks di lavender) |
| `--color-felt` | #543f8f | panel meja UNO (radial, tengah) |
| `--color-felt-edge` | #3a2a66 | panel meja UNO (tepi) |
| `--color-board-light` | #efe9fc | petak catur terang (ungu pastel) |
| `--color-board-dark` | #b3a1e0 | petak catur gelap (ungu pastel) |
| `--color-uno-red` | #d92323 | kartu UNO merah (klasik) |
| `--color-uno-yellow` | #e69c00 | kartu UNO kuning (klasik) |
| `--color-uno-green` | #159947 | kartu UNO hijau (klasik) |
| `--color-uno-blue` | #2266b8 | kartu UNO biru (klasik) |

### Typography

| Token | Value |
|---|---|
| Primary font | system-ui, 'Segoe UI', sans-serif |
| Heading font | sama |
| Scale | 12 / 14 / 16 / 20 / 24 / 32 |

### Spacing & Radius

- Base unit: 4px
- Border radius: sm=6px, md=12px, lg=20px, full=999px

## 2. Styling Rules

- Tanpa framework CSS; semua token sebagai CSS variables di `:root` (style.css).
- FORBIDDEN inline `style=""` kecuali nilai dinamis dari JS (posisi, dsb).
- FORBIDDEN hardcode warna/font di luar tokens.
- Dark mode: tidak didukung (fase ini).

## 3. UI Components

- Komponen custom di satu file (belum ada `components/` — proyek kecil satu halaman).
- FORBIDDEN duplikasi: satu fungsi render per layar (`renderLanding`, `renderLobby`, `renderChess`, `renderUno`).

## 4. UX Principles

- Setiap aksi async (buat/gabung room): tampilkan loading/disabled state.
- Aksi penting (keluar room saat game berjalan): konfirmasi dulu.
- Error selalu pesan manusia Bahasa Indonesia, bukan stack trace.
- Form: nickname wajib 1–16 karakter, pesan error di bawah field.
- Menu dua tingkat (2026-10-21): menu utama hanya berisi pemilih game +
  pill progres + tombol Settings (⚙️). Klik game membuka menu game
  (Vs Bot khusus UNO, Buat Room, Gabung, room menunggu per game).
  Nickname adalah gerbang: belum tersimpan -> message box dulu, lalu
  tersimpan di localStorage; ganti nickname & suara (on/off) lewat Settings.
  Tema ungu pastel berlaku di semua layar; arena UNO memakai panel meja
  plum gelap agar kartu klasik tetap terbaca.
- Mobile-first: papan catur & kartu UNO muat di layar HP (lebar 360px); tombol cukup besar untuk jempol.
- Bidak catur memakai karakter Unicode (♔♕♖♗♘♙) — tanpa aset gambar.
