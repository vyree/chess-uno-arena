# Ludo MABAR.io — Spesifikasi Aturan Skill (TERKUNCI, BELUM DIBANGUN)

> Status: rangkuman aturan yang dikunci Sensei pada sesi pagi 27 Okt 2026.
> **Belum dibangun apa pun.** Dokumen ini hanya simpanan siap-pakai untuk saat
> Sensei bilang lanjut. Jangan deploy, jangan mulai coding dari dokumen ini
> tanpa perintah Sensei.
>
> Design acuan: `docs/ludo-board-design.jpg` — tema gelap, Kamu (merah,
> pojok kiri atas) vs 3 Komputer (hijau, biru, kuning), token pion, dadu di
> tengah papan, petak bintang = petak aman, panah arah jalan di tiap sisi.

## 1. Dadu 6 (diubah dari klasik)

- Dapat 6 = jalan dulu pakai 6 itu, lalu kocok lagi.
- Maksimal 3x dapat 6 dalam satu giliran; kocokan ke-4 tidak pernah 6.
- **Aturan ini TERSEMBUNYI — jangan tampilkan di UI maupun teks aturan.**

## 2. Block skill

- **4 buah**, 1 di tengah-tengah tiap sisi papan, **jauh dari petak bintang**.
- **BUKAN petak aman** — token di block skill bisa dimakan lawan dan bisa
  diserang kartu attack.
- Kartu hanya didapat kalau token **mendarat tepat** di block (bukan lewat).
- Kartu yang sudah didapat **tidak hilang** kalau tokennya dimakan.
- Visual block harus jelas berbeda dari bintang (misal ikon kartu).

## 3. Deck: 64 kartu (tiap jenis 4 copy)

| Kelompok | Jenis | Copy | Total |
|---|---|---|---|
| Attack (hitam) | 4 | 4 | 16 |
| Defense (putih) | 4 | 4 | 16 |
| Netral (ungu) | 8 | 4 | 32 |

### 3a. Attack (hitam) — TIDAK bisa disimpan

- Begitu didapat dari block, **harus dipakai saat itu juga atau hangus**.
- Tidak ada tangan attack, tidak bisa ditabung untuk endgame.
- Tidak bisa menyerang token di base, petak aman, jalur home, atau rumah.

| Kartu | Efek |
|---|---|
| **Sniper** | 1 bidak musuh di jalur utama pulang ke base. |
| **Bom Petak** | Pilih 1 petak jalur utama, **semua** bidak di petak itu pulang ke base — **kena bidak sendiri juga** (friendly fire), kecuali petak aman. Sekali pakai, instan, **bukan ranjau** yang ditanam. |
| **Rantai Seret** | Tarik 1 bidak musuh mundur 10 petak di jalur utama. |
| **Es Beku** | 1 bidak musuh tidak bisa digerakkan pada giliran pemiliknya berikutnya (1 putaran). |

### 3b. Defense (putih) — disimpan, trigger hanya saat diserang

| Kartu | Efek |
|---|---|
| **Perisai Baja** | Batalkan 1 serangan terhadap 1 bidak. |
| **Cermin Pantul** | Pantulkan serangan target-tunggal (Sniper, Rantai Seret, Es Beku) ke 1 bidak penyerang. **Tidak berlaku untuk Bom Petak.** |
| **Teleport Darurat** | Bidak pindah ke petak aman terdekat di depan (searah jalan); kalau tidak ada, ke petak start warnanya. |
| **Kulit Batu** | Serangan yang seharusnya membunuh diubah jadi mundur 6 petak saja. |

### 3c. Netral (ungu) — buff/booster dadu, disimpan

- **Hanya untuk diri sendiri**, tidak bisa dipakai untuk lawan.
- **Hanya mengubah jumlah langkah.** Dadu asli yang menentukan keluar base
  dan kocok lagi; kartu tidak bisa menciptakan atau menghapus hak itu.
- Dipakai setelah kocok, sebelum token jalan, **maks 1 kartu per kocokan**.

| Kartu | Efek |
|---|---|
| **×2** | Langkah = 2 × dadu (pilih 6 langkah pun tidak keluar base / kocok lagi). |
| **+1 / +2 / +3** | Tambah langkah saja; tidak bisa dipakai untuk kocok lagi maupun keluar base. |
| **−1 / −2 / −3** | Kurangi langkah sendiri (alat presisi, misal pas masuk home). |
| **Bebas pilih** | Pilih jumlah langkah 1–6, bukan angka dadu; pilih 6 langkah pun tidak keluar base / kocok lagi. |

## 4. Simpanan (gabungan, maks 3 per pemain)

- Defense + netral digabung, **maks 3 kartu per pemain**.
- Kalau tangan sudah 3 dan dapat kartu simpanan baru, pemain **boleh buang
  1 kartu lama untuk menukar** dengan kartu baru. Kalau tidak mau tukar,
  kartu baru yang hangus.

## 5. Kartu hangus vs terpakai vs deck habis

- **Hangus → kembali ke deck dan dikocok lagi.** Berlaku untuk kartu yang
  didapat tapi tidak dipakai/ditolak/dibuang saat tukar, karena efeknya
  tidak terjadi.
- **Terpakai → hilang permanen.** Kartu yang efeknya sudah terjadi tidak
  kembali ke deck.
- **Deck habis (0 kartu) → tidak ada restore/reshuffle.** Block tidak
  memberi kartu lagi selamanya di game itu; game lanjut dengan simpanan
  yang masih dipegang sampai habis.

## 6. Animasi efek (simple, di bawah 1 detik, CSS/emoji saja)

- **Sniper:** lingkaran bidik merah mengecil di atas target, kilat + "DOR!",
  lalu bidak pulang ke base.
- **Bom Petak:** petak berkedip merah, ledakan oranye-kuning + getar papan
  sebentar, bidak-bidak mental pulang.
- **Rantai Seret:** rantai muncul, bidak ditarik mundur petak demi petak
  sampai 10 langkah.
- **Es Beku:** bidak terselimuti bongkahan es biru muda transparan +
  serpihan salju sampai giliran berikutnya selesai.
- **Perisai Baja:** gelembung perisai, serangan jadi percikan, perisai
  retak-hilang.
- **Cermin Pantul:** cermin muncul, serangan memantul balik ke penyerang.
- **Teleport Darurat:** bidak berkilau-hilang, muncul lagi di petak aman.
- **Kulit Batu:** bidak abu-abu batu sebentar, serangan jadi serpihan batu,
  lalu mundur 6 petak.
- **Netral:** angka ("+3", "×2", "−2") melayang di atas dadu/token, lalu
  token jalan sesuai langkah baru; bebas pilih menampilkan angka yang
  dipilih membesar-berkilau.

## 7. Yang DIBATALKAN / diganti (jangan dipakai lagi)

- Block skill sebagai petak aman — **dibatalkan**; block skill bukan aman.
- Tangan attack maks 2 — **dibatalkan**; attack tidak bisa disimpan sama
  sekali.
- Reshuffle tumpukan buang saat deck habis — **dibatalkan**; gantinya
  aturan hangus-balik-deck + deck-habis-tutup di bagian 5.
- Kartu baru otomatis hangus saat tangan penuh — **diganti** aturan tukar
  di bagian 4.
- Kartu netral +/×2/bebas-pilih yang menciptakan hak 6 — **dikoreksi**;
  semua netral hanya pengubah langkah (bagian 3c).

## 8. Masih TERBUKA (belum dikunci — jangan diasumsikan saat build)

- Jumlah pemain / mode (usulan lama: 2–4 pemain, bot + room teman).
- Aturan blokade.
- Berhenti di pemenang pertama vs lanjut sampai peringkat.
- **Cooldown kartu** (masih dibahas).
- Usulan Arona yang belum dikonfirmasi Sensei: block tidur 1 putaran penuh
  setelah memberi kartu; syarat Sniper (penyerang harus punya bidak di
  jalur utama); angka akhir langkah tidak boleh di bawah 1 untuk kartu −;
  posisi petak block yang persis (baru disepakati "tengah sisi, jauh dari
  bintang").
- Nuansa waktu pakai attack: "saat itu juga" vs "sampai akhir giliran itu"
  — Sensei belum menjawab eksplisit; pakai "saat itu juga" sampai
  diklarifikasi.
