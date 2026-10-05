# DESIGN.md — The UI/UX Core

> Design tokens and styling rules. AI-built UI MUST stay consistent
> with these tokens. FORBIDDEN to hardcode colors/fonts in components.

## 1. Design Tokens

### Colors

| Token | Value | Used for |
|---|---|---|
| `--color-primary` | #5b8def | tombol utama, link aktif |
| `--color-secondary` | #9a7ede | aksen sekunder (UNO) |
| `--color-success` | #3fae6a | status menang / valid |
| `--color-warning` | #e0a34e | timer < 15 detik, peringatan |
| `--color-danger` | #e05c5c | error, kalah, tombol bahaya |
| `--color-bg` | #f4f6fb | background utama |
| `--color-surface` | #ffffff | kartu, panel |
| `--color-text` | #2b3a4a | teks utama |
| `--color-text-muted` | #6b7c93 | teks sekunder |
| `--color-board-light` | #f0d9b5 | petak catur terang |
| `--color-board-dark` | #b58863 | petak catur gelap |
| `--color-uno-red` | #e05c5c | kartu UNO merah |
| `--color-uno-yellow` | #f2c14e | kartu UNO kuning |
| `--color-uno-green` | #3fae6a | kartu UNO hijau |
| `--color-uno-blue` | #5b8def | kartu UNO biru |

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
- Mobile-first: papan catur & kartu UNO muat di layar HP (lebar 360px); tombol cukup besar untuk jempol.
- Bidak catur memakai karakter Unicode (♔♕♖♗♘♙) — tanpa aset gambar.
