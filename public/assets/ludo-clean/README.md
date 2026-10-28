# Ludo Jahat — Assets Bersih (`ludo-clean`)

Aset SVG baru yang digambar ulang, **bukan** potongan JPEG referensi lama.
Bersih: tidak ada figur pion, dadu, kursor, atau label "Kamu"/"Komputer" yang
menempel di papan. Warna dan model meniru referensi (tema gelap, yard
merah/hijau/kuning/biru terang dengan garis diagonal halus, petak bintang krem,
block skill ungu ikon kartu, aksen pink neon `#ff2e93`).

## Daftar file

| File | Isi |
|---|---|
| `board-full.svg` | **Asset utama.** Papan utuh, viewBox `0 0 900 900` (1 sel = 60). Pakai ini untuk game. |
| `yard-red.svg`, `yard-green.svg`, `yard-blue.svg`, `yard-yellow.svg` | Yard per warna, viewBox = region grid-nya (360×360). |
| `track-top.svg`, `track-left.svg`, `track-right.svg`, `track-bottom.svg` | Jalur + kolom home di tiap sisi. |
| `center.svg` | Tengah 3×3: 4 segitiga warna + lingkaran area dadu kosong. |
| `pawn-red.svg`, `pawn-green.svg`, `pawn-yellow.svg`, `pawn-blue.svg` | Pion transparan (background transparan, bukan kotak hitam). |
| `dice-1.svg` … `dice-6.svg` | Dadu bersih, satu file per angka, tanpa kursor. |
| `dice-blank.svg` | Placeholder dadu netral (tanda "?" abu-abu, tanpa pip) — dipakai sebelum hasil kocokan ada, supaya tidak disalahartikan sebagai hasil 6. |
| `demo.html` | Demo: board-full sebagai latar + 16 pion di base + dadu tengah + rakitan per-part 3×3. |

## Cara memanggil dari HTML game

```html
<!-- Latar papan (asset utama) -->
<img src="/assets/ludo-clean/board-full.svg" alt="Papan Ludo Jahat">

<!-- Token di atas latar (posisi persentase, bukan menempel di SVG) -->
<img src="/assets/ludo-clean/pawn-red.svg" alt="Pion merah"
     style="position:absolute; left:16.667%; top:16.667%; width:6.2%; transform:translate(-50%,-50%);">

<!-- Dadu tengah -->
<img src="/assets/ludo-clean/dice-6.svg" alt="Dadu 6">
```

Per-part (hanya kalau benar-benar butuh part, bukan papan utuh):

```html
<img src="/assets/ludo-clean/yard-red.svg" alt="Yard merah">
<img src="/assets/ludo-clean/center.svg" alt="Tengah papan">
```

## Geometri grid yang dipakai (sama persis dengan engine)

- Papan 15×15, sel 60px, total 900×900.
- Yard 6×6: merah kiri atas (r0–5,c0–5), hijau kanan atas (r0–5,c9–14),
  kuning kanan bawah (r9–14,c9–14), biru kiri bawah (r9–14,c0–5).
- Jalur utama 52 petak, urutan searah jarum jam mulai start merah — lihat
  `TRACK` di generator (`/tmp/gen_ludo_clean.py`, bukan bagian game).
- Petak aman (bintang): index jalur 0, 8, 13, 21, 26, 34, 39, 47.
- Block skill: index jalur 5, 18, 31, 44 — ikon kartu ungu, **bukan** petak aman.
- Kolom home: 5 sel grid per warna + sel ke-6 menyatu dengan segitiga tengah
  warna yang sama. Total sel terhitung: 144 yard + 52 jalur + 20 home + 9 tengah = 225.
- Base: 4 slot lingkaran kosong per warna (tanpa figur pion).
- Tengah 3×3 (r6–8,c6–8): segitiga merah kiri, hijau atas, kuning kanan,
  biru bawah, + lingkaran area dadu kosong di tengah.

## Perbaikan kotak base simetris (27 Okt 2026)

Kotak dalam base di `board-full.svg` dan `yard-*.svg` dibuat
**konsentris** dengan kotak luar yard (bukan digeser ke titik tengah
slot engine — pendekatan itu ditolak Sensei karena membuat kotak
dalam tidak sejajar kotak luar).

- Yard 0–360, kotak dalam 60–300 (lebar 240, pusat 180 = pusat yard,
  margin 60 di semua sisi). Per warna dalam koordinat papan 0–900:
  merah (60,60), hijau (600,60), kuning (600,600), biru (60,600).
- Slot tampil base (display-only, lihat TASK_INSTRUCTION.md):
  merah [[120,120],[240,120],[120,240],[240,240]],
  hijau [[660,120],[780,120],[660,240],[780,240]],
  kuning [[660,660],[780,660],[660,780],[780,780]],
  biru [[120,660],[240,660],[120,780],[240,780]].
  Slot = 1/4 dan 3/4 kotak dalam, jarak sama ke semua sisi.
- Demo di folder ini sudah diperbarui ke slot tampil ini (bukan
  lagi pusat sel grid engine 150/270). Token progress -1 di game
  dirender di slot tampil ini; token jalur/home tetap memakai
  pemetaan grid engine yang sudah ada.

## Perbaikan lingkaran slot (27 Okt 2026)

Lingkaran samar r=20 di pusat sel grid engine (150/270 dst.)
sudah DIHAPUS dari `board-full.svg` dan `yard-*.svg` — itulah yang
dulu terlihat sebagai lingkaran kosong bergeser dari pion. Yang
tersisa hanya 4 lingkaran slot r=28 per warna, persis di koordinat
slot tampil di atas, jadi tiap pion (lebar 6,2% papan = diameter
~56 unit) duduk tepat di tengah lingkarannya sendiri.

## Catatan per-part / seam

Part-part memakai koordinat papan yang sama dengan `board-full.svg`
(viewBox = region-nya, bukan dinolkan), dan tidak memakai stroke luar part —
hanya fill + stroke 1px per sel di dalam region. Karena itu, kalau dirakit 3×3
tanpa gap, sambungannya harus menempel tanpa garis ganda. Kalau di screenshot
cek masih terlihat seam, pakai `board-full.svg` sebagai asset utama dan
laporkan seam-nya — jangan klaim seamless kalau tidak.
