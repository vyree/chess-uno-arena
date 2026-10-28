# Ludo Jahat — Rencana Animasi (PARKIR, dikerjakan bertahap)

Status: **disimpan 28 Okt 2026 atas perintah Sensei; BELUM dikerjakan.**
Alasan: Sensei menilai game terasa kaku — belum ada animasi di setiap aksi
(dadu diputar, bidak jalan, dan lain-lain). Peta ini dibuat dari inspeksi
kode 28 Okt 2026 (renderLudo di public/app.js, gaya di public/style.css,
snapshot di game/ludo.js + server.js). Implementasi dilakukan bertahap
atas perintah Sensei berikutnya; jangan dikerjakan sekaligus tanpa kata Sensei.

## Kondisi sekarang (hasil inspeksi 28 Okt 2026)

Yang sudah beranimasi, hanya 3 hal:
- Pion yang bisa diklik berdenyut (`.ludo-token-wrap.clickable`,
  keyframes `ludo-pulse`).
- Banner pengumuman bergetar khusus Sniper/Bom (`.fx-sniper`, `.fx-bom`,
  keyframes `ludo-shake`); jenis kartu lain hanya ganti warna latar banner.
- Dadu redup saat idle (`.ludo-dice-idle`).

Sisanya instan:
- Muka dadu langsung ganti (`diceImg.src = ...` di renderLudo).
- Pion teleport: renderLudo menghapus SEMUA node pion
  (`.ludo-token-wrap, .ludo-skill-target`) lalu membuat ulang tiap sync,
  sehingga transisi CSS left/top tidak bisa bekerja apa adanya.
- Kartu muncul tiba-tiba; pion dimakan langsung hilang ke base;
  banner pengumuman cuma muncul (tanpa slide-in).

## Peta pergerakan yang dibutuhkan

### 1. Dadu
- Kocok: muka dadu berputar/acak cepat ±0,6–0,8 detik lalu berhenti di
  hasil — berlaku untuk giliran manusia MAUPUN Komputer, bukan cuma manusia.
- Dapat 6 / extra roll: dadu menyala + penanda "kocok lagi" berdenyut.
- Tombol kocok ditekan: efek tekan (mengecil sesaat).

### 2. Bidak jalan (paling terasa kaku)
- Jalan per petak: pion melompat petak demi petak (±120–150 ms per petak),
  bukan teleport — termasuk saat kena kartu −/+ langkah.
- Keluar base (dadu 6): pion melompat dari slot base ke petak start.
- Masuk jalur home & masuk home: lompatan terakhir + rumah menyala/pulse.
- Pion dipilih: terangkat sedikit sebelum jalan (denyut yang ada dipertahankan).
- Giliran pindah: yard pemain yang giliran menyala + badge giliran bergeser.

### 3. Makan & interaksi papan
- Dimakan: pion korban terbang/memudar kembali ke slot base-nya, petak
  penyerang menghentak.
- Mendarat di block skill: block menyala + kartu terbang dari block ke
  tangan + kartu muncul pop.
- Mendarat di petak aman (bintang): bintang berkelip kecil.
- Pion beku: kilau es; kalau diklik, pion bergoyang (tidak jalan).

### 4. Kartu (efeknya sudah ada di aturan, belum hidup di papan)
- Sniper: lingkaran bidik di target + "DOR!" + korban pulang ke base.
- Bom Petak: petak berkedip merah + ledakan + papan bergetar + semua pion
  di petak itu pulang ke base.
- Rantai Seret: pion diseret mundur petak demi petak.
- Es Beku: pion terselimuti es + salju.
- Perisai Baja: gelembung + percikan + retak.
- Cermin Pantul: serangan memantul balik ke penyerang.
- Teleport Darurat: berkilau hilang lalu muncul di petak aman.
- Kulit Batu: pion jadi abu-abu batu lalu mundur 6.
- Kartu netral: angka melayang di atas dadu/pion saat langkah berubah.
- Dapat kartu simpanan: kartu meluncur ke tangan.
- Tukar kartu: kartu lama keluar, kartu baru masuk.
- Kartu hangus: kartu memudar kembali ke arah deck + angka deck berkurang.

### 5. Pengumuman & akhir game
- Banner pengumuman: meluncur masuk (sekarang cuma muncul), tetap hilang
  sendiri ±3 detik, tidak memblokir giliran.
- Menang: yard pemenang confetti/pulse + banner trofi membesar.
- Opsional: timer 60 detik menyusut, berdenyut saat <10 detik.

## Prasyarat teknis (menentukan bentuk kerja)

1. Pion harus dibuat TETAP HIDUP antar update (tidak dihapus-dibuat ulang
   tiap sync), dan klien harus membandingkan snapshot lama vs baru untuk
   menyimpulkan "pion ini jalan dari petak A ke B" — karena server sekarang
   cuma mengirim snapshot (toClient) + teks ludo_announce, bukan event per
   langkah. Alternatif: server mengirim event gerakan, tapi itu mengubah
   protokol WS dan butuh validator + tes baru.
2. Giliran Komputer sekarang selesai dalam hitungan milidetik — butuh
   antrean animasi + pacing supaya gerakan Komputer tetap kebaca tapi tidak
   membuat game terasa lambat. Kecepatan pacing dikunci bareng Sensei saat
   implementasi (belum diputuskan).
3. Prinsip yang tetap berlaku: animasi CSS transform/opacity saja, tanpa
   library baru, game tetap ringan (prioritas Sensei sejak Fase 1).
   Pertimbangkan `prefers-reduced-motion` → animasi dimatikan (instan).

## Tahapan yang diusulkan (belum diputuskan Sensei)

- Tahap inti dulu (ditawarkan 28 Okt 2026): dadu + jalan + makan.
- Tahap berikutnya: kartu (attack/defense/netral) + dapat/tukar/hangus.
- Tahap akhir: pengumuman, menang, timer, polish.
- Keputusan cakupan menunggu kata Sensei; dokumen ini hanya rencana.
