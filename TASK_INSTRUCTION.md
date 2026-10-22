# TASK_INSTRUCTION.md — The Step-by-Step Prompt

> Worksheet Raphael. Satu fase dalam satu waktu. JANGAN loncat fase.

## Keputusan / Asumsi Tercatat (AGENTS.md: don't guess)

1. **`ws` disetujui eksplisit oleh misi** ("pakai `ws`, ringan") — ini approval user via Arona, override aturan "no new packages". Versi di-pin di package.json.
2. **Plain JavaScript (bukan TypeScript)** — adaptasi template; tanpa build step agar Sensei mudah menjalankan.
3. **Tanpa database** — room in-memory, auto-hapus saat kosong (sesuai PRD).
4. **Tanpa ESLint** — diganti `node --check` + gaya kode hati-hati (proyek kecil, zero-config untuk Sensei).
5. **Tanpa Zod/Yup** — validasi terpusat di `game/validate.js` + engine (lihat SECURITY.md §2).
6. **Komentar kode English; UI Bahasa Indonesia** (misi).
7. **Simplifikasi UNO** (dicatat di laporan): tanpa challenge wild+4, tanpa stacking +2/+4, deklarasi UNO via flag `saidUno` (lupa = penalti ambil 2).
8. **Timer**: catur 60 dtk habis = kalah waktu; UNO 60 dtk = auto ambil + lewat.
9. **Disconnect**: tenggang 60 dtk untuk reconnect (pakai playerId + kode room); lewat itu = forfeit.

---

## Phase 1: Foundation

- [x] 8 file template disalin & placeholder diisi
- [x] `package.json` (`ws` pinned), `.env.example`, README
- [x] Struktur folder per `ARCHITECTURE.md`
- [x] `node --check` bersih

## Phase 2: Engine Catur (`game/chess.js`)

- [x] Representasi papan + generate langkah semua bidak
- [x] Rokade, en passant, promosi
- [x] Skak / skakmat / stalemate
- [x] 50 langkah + repetisi 3x
- [x] Unit tests `test/chess.test.js` hijau

## Phase 3: Engine UNO (`game/uno.js`)

- [x] Deck 108 + kocok + deal 7
- [x] Validasi play (warna/angka/simbol/wild)
- [x] Aksi: skip, reverse, +2, wild, wild+4
- [x] Penalti UNO + skoring ronde
- [x] Unit tests `test/uno.test.js` hijau

## Phase 4: Room + Server (`game/rooms.js`, `game/validate.js`, `server.js`)

- [x] RoomManager: kode 6 karakter, buat/gabung/keluar, auto-hapus
- [x] validate.js: skema pesan + sanitasi nickname/chat
- [x] server.js: HTTP static, WS routing, timer giliran, disconnect 60 dtk, rate limit
- [x] Protokol pesan sesuai ARCHITECTURE (terdokumentasi di README)

## Phase 5: Frontend (`public/`)

- [x] Landing (nickname) → pilih game → buat/gabung room → lobby
- [x] Papan catur interaktif (klik/ tap, highlight langkah legal dari server)
- [x] Meja UNO (kartu tangan, discard, tombol UNO!, pilih warna wild)
- [x] Bahasa Indonesia, responsif HP, token DESIGN.md

## Phase 6: Testing & Laporan

- [x] `npm test` hijau
- [x] `test/simulate.js`: catur sampai skakmat + UNO sampai ronde selesai + disconnect + kode salah
- [x] Hasil dicatat di TESTING.md (bagian 6 di bawah) & laporan ke Arona
- [ ] Verifikasi manual oleh Sensei (di luar kendali Raphael)

---

## Ground Rules

- Satu checklist item = satu potong kerja kecil yang terverifikasi.
- FORBIDDEN menandai `[x]` untuk yang belum diverifikasi.
- Laporan tiap fase: file diubah, test dijalankan, sisa kerja.

---

# MISI 2 — UNO Overhaul (2026-10-21, perintah Sensei)

Keputusan terkunci (Sensei, 21 Okt 2026 02:54 WIB):

1. **Jalur B**: engine sendiri dipertahankan; yang diadopsi adalah TEKNIK animasi
   kartu terbang (FLIP) ala letsuno/uno-online, diimplementasikan vanilla
   (Web Animations API) — tanpa framework, tanpa dependensi baru.
2. **Catur tidak disentuh sama sekali** di semua fase misi ini.
3. UNO **2–8 pemain** (naik dari 2–6).
4. **Mode bot**: angka pilihan 2/4/6/8 = TOTAL kursi di meja, SUDAH termasuk
   pemain manusia (Sensei + sisanya bot). Bot hidup di server.
5. **Stacking KETAT**: +2 hanya bisa ditumpuk +2, +4 hanya bisa ditumpuk +4
   (warna bebas). Total akumulasi diambil pemain pertama yang tidak bisa
   menumpuk.
6. **Mode Ekstrim (toggle)**: bila AKTIF, +4 TIDAK bisa ditumpuk sama sekali
   (kena +4 = langsung ambil, tanpa perlawanan); hanya +2 yang bisa stack.
   [Asumsi tertulis Arona dari kalimat Sensei "+4 aktif, aku mati" —
   dibaca: di mode ekstrim +4 itu mematikan/tidak bisa dilawan.]
7. **Urutan duduk diacak** saat game mulai DAN diacak lagi tiap game baru.
8. **Suara**: efek kartu (main/ambil/kocok) + teriakan "Uno!" saat pemain
   sisa 1 kartu. Client-side Web Audio, ada mute.
9. **Login Google (1x klik) adalah gerbang SEMUA game.** TAPI identitas
   in-game adalah **nickname buatan pemain sendiri** — DILARANG menampilkan
   data akun Google apa pun di dalam game (nama asli, email, FOTO).
   Nickname tersimpan per akun di Firestore, bisa diedit di menu setting.
10. **Firestore** = profil/nickname/statistik/riwayat. State live permainan
    tetap di memory server (bukan Firestore).
11. **Deploy Firebase** = Hosting (client) + Cloud Run (server WebSocket)
    + Firebase Auth + Firestore, satu project.

## Fase 1 — Engine UNO v2 (stacking, 8 pemain, seat shuffle, event suara)

- [x] `game/uno.js`: cap 2–8; strict stacking via `pendingKind`; mode ekstrim
- [x] `game/uno.js`: hasil play/draw membawa `events` (play/draw/uno/stack)
- [x] `game/rooms.js`: MAX_PLAYERS.uno = 8; `shuffleSeats(room, rand)`
- [x] `server.js`: shuffle seat saat start & ronde baru (UNO saja);
      teruskan flag ekstrim dari payload start_game host
- [x] Tests: stacking ketat, cross-stack ditolak, ekstrim +4 mati,
      8 pemain, shuffle seat; regresi catur & UNO lama tetap hijau
      (44/44 unit test + simulasi integrasi WebSocket semua skenario LOLOS,
      21 Okt 2026)

## Fase 2 — Bot AI + mode bot 2/4/6/8

- [x] `game/bot.js`: AI server-side (playable → aksi → stack sadar konteks)
- [x] Room bot: host membuat meja bot, kursi sisa diisi bot, bot auto-turn
- Catatan Fase 2 (21 Okt 2026): bug ditemukan & diperbaiki — validator `start_game` dulu membuang payload sehingga flag Ekstrim tidak pernah sampai ke server; sekarang diloloskan sebagai boolean. Tes: 52/52 unit (8 baru di test/bot.test.js) + integrasi WS bot room penuh sampai game_over + simulasi regresi lama semua lolos.

## Fase 3 — Client: animasi + urutan + suara

- [x] Animasi kartu terbang (FLIP + Web Animations API, nol dependensi)
- [x] Ring urutan pemain + indikator arah + highlight giliran
- [x] Mesin suara Web Audio (kartu + "Uno!") + tombol mute
- [x] Toggle Mode Ekstrim di lobby (host)
- Catatan Fase 3 (21 Okt 2026): semua FX digerakkan event server (uno_events) agar sinkron di semua client; suara disintesis Web Audio + teriakan "Uno!" via SpeechSynthesis (nol aset audio); snapshot server kini mengekspos isBot untuk badge 🤖. Terverifikasi: 52/52 unit + regresi simulate lolos + uji visual Chromium headless (CDP) — ring 4 pemain render benar, badge arah terbukti berbalik saat reverse dimainkan, nol error console; dua cacat layout ditemukan dari screenshot (chip kepotong tepi layar, lalu chip menimpa meja) dan diperbaiki (radius ring 40% + chip/meja dirampingkan).

## Fase 4 — Firebase (Auth + Firestore + deploy)

- [x] Baca SECURITY.md dulu (aturan proyek: wajib sebelum sentuh auth)
- [x] Firebase Auth Google 1x klik sebagai gerbang; token diverifikasi server
- [x] Nickname per akun di Realtime Database (menggantikan Firestore —
  keputusan Sensei 21 Okt 2026) + halaman setting edit nickname
- [x] Statistik per akun ke Realtime Database (riwayat match: statistik agregat)
- [x] Deploy: Hosting + server; uji end-to-end di URL publik
  — SELESAI via RAILWAY (keputusan Sensei 21 Okt 2026, menggantikan
  Cloud Run yang terkunci billing): Hosting LIVE
  https://fir-pro2-d77c3.web.app; server LIVE di
  https://chess-uno-arena-production.up.railway.app (auto-deploy GitHub,
  commit 18c5e95); terverifikasi halaman baru di kedua URL, upgrade
  WebSocket → 101, rules RTDB menolak akses anonim. Env
  FIREBASE_PROJECT_ID SUDAH diisi Sensei di dashboard Railway
  (21 Okt 2026, service redeploy otomatis) — server kini mode AUTH
  penuh; perilaku penolakan token sudah terverifikasi pada kode yang
  sama di uji lokal Fase 4 (3/3 PASS).

### Asumsi & desain Fase 4 (ditulis sebelum implementasi — AGENTS.md §1)

- SECURITY.md/ARCHITECTURE.md masih scope lama (tanpa auth/DB/deploy publik);
  11 keputusan Misi 2 Sensei adalah override eksplisit. Kedua dokumen
  diperbarui setelah fase ini selesai agar konsisten.
- **Kuota project GCP akun Sensei HABIS** (terverifikasi dari log
  cloudresourcemanager 21 Okt 2026: "exceeded your allotted project quota")
  → project baru TIDAK bisa dibuat; arena memakai salah satu project yang
  sudah ada (keputusan Sensei). Project ID hanya masuk lewat konfigurasi:
  env `FIREBASE_PROJECT_ID` (server), `public/firebase-config.js` (client),
  `.firebaserc` — tidak ada yang di-hardcode di logika.
- **Verifikasi token TANPA dependensi baru**: `game/auth.js` memverifikasi
  ID token Firebase secara manual (RS256 terhadap sertifikat publik Google
  x509, cek iss/aud/exp, cache sertifikat) memakai `crypto` bawaan Node.
  `firebase-admin` TIDAK dipasang (AGENTS.md §2: dependensi baru butuh
  persetujuan; jalur nol-dep ini cukup dan teruji polanya).
- **Server tidak menyentuh Firestore.** Profil/statistik ditulis client
  langsung ke Firestore dengan Security Rules ketat (`users/{uid}` hanya
  bisa dibaca/ditulis pemiliknya). Server menerima nickname dari client
  bersama ID token (format tetap divalidasi `validate.js`), dan mengikat
  sesi ke `uid` hasil verifikasi token.
- **Gerbang auth aktif hanya bila `FIREBASE_PROJECT_ID` terisi** (produksi).
  Tanpa env itu server berjalan mode dev terbuka (agar tes lokal & simulasi
  tetap hijau) dan mencetak peringatan di log server.
- Client memuat Firebase SDK (app/auth/firestore, versi ter-pin 10.12.2)
  dari CDN resmi gstatic sebagai ES module via dynamic import — sesuai
  spek Firebase dari Sensei. (Koreksi saat implementasi: build compat
  diganti modular karena compat tidak mendukung named database.)
  Identitas Google (nama/email/foto) TIDAK PERNAH dirender di UI game;
  nickname selalu buatan user sendiri (sesuai keputusan Sensei).
- Koneksi WS produksi: client di Hosting terhubung ke URL Cloud Run
  (konstanta `WS_ENDPOINT` di `public/firebase-config.js`, diisi setelah
  Cloud Run deploy); lokal tetap `location.host`.
- Risiko terbuka: Cloud Run butuh billing aktif (Blaze) di project tujuan
  dan gcloud SDK tidak terpasang di sandbox (akan dipasang di ~/workspace
  dengan access token dari sesi firebase CLI bila jalur itu diperlukan).

### Hasil provisioning (21 Okt 2026, project pilihan Sensei: fir-pro2-d77c3)

- Web app "Chess UNO Arena" dibuat; `public/firebase-config.js` terisi.
- Provider Google: config lama sudah ada (clientId/secret terisi) tapi
  nonaktif → diaktifkan via Identity Toolkit API, terverifikasi enabled.
- Database `(default)` project ini **Datastore Mode** (warisan app lama
  "Penguin Eats") — tidak bisa dipakai client Firestore dan tidak boleh
  diubah → profil/statistik memakai named database **`arena`**
  (FIRESTORE_NATIVE, asia-southeast2/Jakarta).
- **PENGHALANG: billing belum aktif di fir-pro2-d77c3.** Pembuatan
  database Firestore baru ditolak API (403 "requires billing"), Cloud Run
  juga mensyaratkannya. Menunggu Sensei mengaktifkan billing (link resmi:
  console.developers.google.com/billing/enable?project=fir-pro2-d77c3).
  Setelah itu: buat DB arena → deploy rules → deploy Hosting → pasang
  gcloud → deploy Cloud Run → isi CUA_WS_ENDPOINT → uji e2e publik.
- **KEPUTUSAN SENSEI (21 Okt 2026): profil/statistik pindah ke Realtime
  Database** menggantikan Firestore (billing belum aktif; RTDB gratis di
  Spark dan sama-sama NoSQL). Instance RTDB project yang sempat DISABLED
  sudah diaktifkan kembali (state ACTIVE). Client memakai firebase-database
  modular; `database.rules.json` = cabang users/{uid} hanya pemiliknya.
  `firestore.rules` diparkir untuk migrasi Firestore di masa depan.
  Cloud Run (server game) tetap menunggu billing — tidak ada jalan lain.
- Kode selesai & terverifikasi lokal: gerbang server (57/57 unit termasuk
  5 tes kriptografi auth; hello tanpa/dengan token palsu ditolak saat
  mode auth aktif), client modular + gerbang login tampil benar di
  Chromium (kontrol terkunci, nick-block tersembunyi, nol exception JS).
  Yang belum bisa dibuktikan dari sandbox: login Google + Firestore
  sungguhan (egress browser sandbox memblokir gstatic; DB belum ada).

## Update pasca-rilis (21 Okt 2026, permintaan Sensei)

- [x] Bug Keluar stuck: jalur leave_room saat status 'playing' (forfeit)
  tidak pernah mengirim left_room — direstrukturasi: SEMUA jalur keluar
  kini membersihkan pemain & selalu membalas left_room; client juga
  menyembunyikan modal saat left_room tiba. Terverifikasi skrip repro
  (bot room ✓, room teman tengah main: false → true).
- [x] Hand UNO: kartu ditumpuk menyamping RATA kiri→kanan (overlap -24px,
  tanpa miring/melingkar), hover terangkat; bisa scroll menyamping.
- [x] Desain kartu gaya klasik (referensi Sensei): oval putih miring di
  tengah + angka besar sewarna kartu, angka kecil pojok kiri-atas &
  kanan-bawah (terbalik), wild hitam bermotif 4 warna, palet warna klasik.
- [x] LOGIN DIPARKIR (perintah Sensei 21 Okt 2026): gerbang Google
  dicabut dari client (kotak login dihapus, SDK Firebase tidak dimuat),
  pemain kembali nickname-only; progres (main/menang/poin) disimpan
  LOKAL per perangkat (localStorage 'cua-stats', nickname 'cua-nick').
  Server: verifikasi token kini opt-in (FIREBASE_PROJECT_ID +
  REQUIRE_AUTH=1) — kode verifier & rules RTDB tetap tersimpan rapi
  untuk dihidupkan lagi kapan pun. Terverifikasi: hello tanpa token
  diterima dengan env persis Railway; landing tanpa auth-box; bot game
  langsung mulai.

# MISI 3 — Truth or Truth (RANCANGAN, 21 Okt 2026)

> Status: BARU RANCANGAN tertulis atas persetujuan Sensei — BELUM
> dieksekusi. Menunggu kata "gas" per fase seperti pola Misi 2.
> Konteks: game party sosial untuk arena (di luar catur & UNO); tetap
> nickname-only (login diparkir), progres lokal per perangkat.

## Konsep

- Room **2–8 pemain** (keputusan Sensei, 22 Okt 2026: minimal 2, maksimal
  8), kode room seperti game lain. **TIDAK ADA pilihan
  paket/kategori di awal game** (keputusan Sensei, 22 Okt 2026): semua
  200 soal digabung jadi SATU tumpukan dan diacak. Empat nuansa soal
  (Santai, Nostalgia, Mendalam — tetap sopan, Campuran) hanya keragaman
  rasa saat menulis bank soal, bukan pilihan pemain.
- Inti permainan = bank soal + roda giliran + reaksi. Tidak ada engine
  aturan rumit; kualitas ditentukan kurasi soal.

## Sistem permainan (desain Sensei–Arona, 21 Okt 2026)

1. **Giliran**: sistem memutar roda nama (acak, tanpa mengulang sampai
   semua pemain kena satu putaran) → pemain terpilih menerima **kartu
   pertanyaan acak** dari paket terpilih.
2. **Menjawab**: lewat chat/teks di room; **timer jawaban 2 menit** —
   waktu habis = dianggap pass.
3. **Reaksi & poin**: pemain lain memberi reaksi pada jawaban
   (🔥 greget, 😂 ngakak, 🥺 deep, 👏 apresiasi) → reaksi = poin bagi
   penjawab. Tombol **"Kurang greget!"** = pengurang poin (definisi final
   di bagian Sistem Reaksi & Penghargaan di bawah).
4. **Jatah PASS**: tiap pemain 1x per game melewati pertanyaan tanpa
   hukuman (jaga kenyamanan; soal dikurasi sopan, tidak vulgar).
5. **Akhir game**: 2 putaran penuh (atau setting host) → podium gelar
   seru-seruan: Paling Greget, Paling Ngakak, Paling Deep (berdasarkan
   reaksi terbanyak per jenis). Statistik (main + gelar) masuk progres
   lokal localStorage.
6. **Bot**: TIDAK ikut menjawab. Bot hanya jadi MC (putar roda, bacakan
   soal, hitung poin) bila manusia < 3.

## Bank soal

- Format data: daftar soal per paket (file data terpisah, mudah ditambah).
- Target: **200 soal total** — ditulis sebagai 4 nuansa × 50 soal, lalu
  DIGABUNG jadi satu tumpukan (keputusan Sensei, 22 Okt 2026). Semua
  soal lolos kurasi: aman, sopan, tidak menyinggung SARA pribadi.
  Indikator sisa soal di layar: mulai **200/200**.

## Arsitektur (mengikuti pola arena)

- Engine state machine giliran di `game/truth.js`; pesan WS baru awalan
  `truth_`; validasi terpusat di `game/validate.js`; state live in-memory
  server (room/lobby/chat/timer/reconnect 60 dtk dipakai ulang apa adanya).
- UI: layar baru `screen-truth` (roda nama, kartu soal, tombol reaksi,
  podium), gaya visual mengikuti design system yang ada.

## Fase pengerjaan (checklist — belum dimulai)

- [x] Fase 1 — Engine `game/truth.js` + bank soal inti (200 soal
      gabungan) + validasi + tes unit — SELESAI 22 Okt 2026:
      engine + `game/questions.js` (4 nuansa × 50) + validator truth di
      `game/validate.js`; tes total 68/68 hijau (57 lama + 9 engine +
      2 bank)
- [ ] Fase 2 — Integrasi server: room tipe truth, alur giliran/reaksi/
      poin/gelar, MC bot, simulasi WS end-to-end
- [ ] Fase 3 — UI: layar truth, animasi roda nama, kartu soal, reaksi,
      podium gelar, efek suara
- [ ] Fase 4 — Deploy (Railway + Hosting) + uji publik

## Asumsi terbuka (boleh dikoreksi Sensei kapan pun)

- Timer jawaban 2 menit; 1 game = 2 putaran; reaksi 4 jenis;
  jatah PASS 1x per pemain per game; gelar dihitung dari reaksi.

## Mekanik ASK + Notifikasi (keputusan Sensei, 22 Okt 2026 — dari sketsa UI Sensei)

- **ASK = pertanyaan bebas dari pemain**, tanpa kartu soal: pemain yang
  menekan ASK berhak mengajukan pertanyaan buatannya sendiri kepada
  pemain yang sedang kena giliran.
- **Jatah ASK: 2x per pemain per game** (sejajar jatah PASS 1x).
- **Eksklusif per giliran (siapa cepat, dia dapat)**: begitu satu pemain
  menekan ASK, tombol ASK pemain lain TERKUNCI untuk giliran itu — hanya
  boleh ada 1 penanya per giliran.
- **Kartu terkunci saat ASK aktif**: pada giliran yang diklaim ASK,
  tombol buka kartu pertanyaan terkunci — pertanyaan 100% berasal dari
  penanya, bukan dari tumpukan kartu.
- Alur giliran jadinya: roda memilih penjawab → jendela singkat: ada yang
  klaim ASK? → bila tidak ada, kartu dibuka seperti biasa → penjawab
  menjawab (timer jalan) → fase reaksi.
- **Ritme waktu per giliran (keputusan Sensei, 22 Okt 2026):**
  1. Roda berputar dengan animasi **±10 detik** sebelum berhenti di
     pemain terpilih (membangun ketegangan; hasil tetap ditentukan
     server, animasi hanya tampilan).
  2. Setelah pemain terpilih, **jeda 10 detik** = jendela klaim ASK.
     Bila dalam 10 detik tidak ada yang menekan ASK, **kartu pertanyaan
     terbuka OTOMATIS** dan giliran berjalan normal.

## Sistem Reaksi & Penghargaan (keputusan Sensei, 22 Okt 2026 — MENGGANTIKAN set reaksi & gelar rancangan awal)

- **4 reaksi resmi**: 😆 Lucu, 😭 Nangis, 🥰 Lovely, 😤 Marah.
  (Wajah ke-4 di sketsa Sensei = 😤 Marah — misteri terjawab.)
- **Batas: tiap pemain hanya boleh memberi MAKSIMAL 2 reaksi per
  jawaban** (boleh 2 jenis berbeda atau 2x jenis yang sama — asumsi
  Arona, koreksi bila salah). Pemain tidak mereaksi jawabannya sendiri.
- **Poin untuk penjawab**: 😆 Lucu = **+10**, 😭 Nangis = **+15**,
  🥰 Lovely = **+10**, 😤 Marah = **+15**. Poin diakumulasi per pemain
  sepanjang game.
- **"Kurang Greget!" (pengurang poin)**: tiap pemain LAIN boleh menekan
  1x per pertanyaan/jawaban → **−5 poin** untuk penjawab. Terpisah dari
  jatah 2 reaksi. MENGGANTIKAN versi rancangan awal (mayoritas → soal
  susulan) — tidak ada lagi pertanyaan susulan dari tombol ini.
- **Penghargaan akhir game** (ditampilkan di layar penutup):
  - Pemain dengan total poin terbanyak (juara umum).
  - Per JAWABAN/cerita: **Paling Lucu** (😆 terbanyak), **Paling Sedih**
    (😭 terbanyak), **Paling Lovely** (🥰 terbanyak), **Paling
    Emosional** (😤 terbanyak).
- **Notifikasi pop-up di layar WAJIB** untuk setiap peristiwa penting,
  agar semua pemain selalu sadar keadaan game. Contoh resmi dari Sensei:
  "Putaran ke 2", "Player 1 bertanya", "Player 2 skip!!". Berlaku juga
  untuk: giliran siapa, kartu dibuka, ASK diklaim, waktu habis, gelar di
  podium. (Pola toast/banner mengikuti sistem notifikasi arena.)
- Elemen sketsa Sensei yang dibaca Arona (22 Okt): indikator "PUTARAN KE
  1/16" = giliran berjalan dari total (jumlah pemain × putaran); pemain
  divisualkan duduk melingkar + jarum penunjuk di tengah; tumpukan kartu
  menampilkan sisa soal (100/100); panel reaksi 4 wajah ekspresi.
- **Lingkaran roda ADAPTIF (Sensei, 22 Okt)**: tata letak pemain di
  lingkaran menyesuaikan jumlah pemain (2–8) — posisi & jarak antar
  pemain dihitung dari jumlah kursi agar selalu rapi (urusan Fase 3).

---

## MENU UTAMA DUA TINGKAT + TEMA UNGU PASTEL (Sensei, 21 Okt 2026 malam)

Referensi visual dari Sensei: menu aplikasi board-game (kartu game besar
bergambar dalam grid, latar terang bersih). Spesifikasi Sensei:

1. **Menu utama = pilih game dulu.** Grid kartu game besar (Catur, UNO).
   TIDAK ada sapaan ("Hey, ...!" dihilangkan). Ada tombol Settings (cog ⚙️)
   dan pill progres lokal.
2. **Gerbang nickname:** klik kartu game -> kalau nickname belum tersimpan,
   muncul message box isi nickname dulu -> tersimpan (localStorage cua-nick)
   -> lanjut masuk menu game. Kalau sudah ada, langsung masuk.
3. **Menu game (per game):** tombol kembali, judul game, lalu isinya:
   Vs Bot (khusus UNO: ukuran 2/4/6/8 + Mode Ekstrim), Buat Room,
   Gabung kode room, daftar room yang menunggu (khusus game itu).
4. **Settings (cog):** Change Nickname + Sound On/Off (sumber suara tunggal
   localStorage cua-sound, sinkron dengan tombol suara di arena UNO).
5. **Tema UNGU PASTEL** (warna kesukaan Sensei) diterapkan ke SEMUA layar:
   menu utama, menu game, lobby, arena catur (papan ikut ungu pastel), dan
   arena UNO (panel meja ungu plum; kartu UNO tetap 4 warna klasik).

## SERVER CADANGAN FLY.IO (Sensei, 21 Okt 2026 malam)
Railway kena Major Outage (builds paused global) -> Sensei putuskan siapkan
server cadangan di Fly.io; Railway tetap utama, tidak ditinggalkan.
- fly.toml: app "chess-uno-arena", region sin (Singapura), 1 mesin
  shared-cpu-1x 256MB SELALU NYALA (auto_stop_machines=false), Dockerfile repo.
- Client: parameter ?server=fly mengalihkan WebSocket ke
  wss://chess-uno-arena.fly.dev; tanpa parameter tetap Railway.
  Link cadangan pemain: https://fir-pro2-d77c3.web.app/?server=fly
- SELESAI 21 Okt malam: app "chess-uno-arena" LIVE di Fly (org personal
  "Aldika", slug personal; login feiraalchemy@gmail.com via flyctl auth
  login --code). Mesin TUNGGAL e82e962f55d698, region sin, started
  (WAJIB 1 mesin: room stateful di memori — 2 mesin memecah room).
- Jalur deploy as-built: builder Fly (depot & klasik) DAN pull image lokal
  DIBLOKIR proksi egress sandbox (TLS timeout ke *.fly.dev builder &
  CDN registry). Jalan yang berhasil: GitHub Actions
  (.github/workflows/build-image.yml, trigger push main + manual) build
  image -> push registry.fly.io/chess-uno-arena:latest (secret repo
  FLY_API_TOKEN = deploy token app, dibuat Sensei via dashboard Fly) ->
  dari sandbox: flyctl deploy --image registry.fly.io/chess-uno-arena:latest.
- Verifikasi: flyctl status started; log boot server tampil; HTTPS fly.dev
  200 berisi UI baru. Uji WS end-to-end dari sandbox terhalang proksi
  (pola sama seperti Railway dulu) — bukti akhir di perangkat Sensei via
  https://fir-pro2-d77c3.web.app/?server=fly
- PERUBAHAN UTAMA 22 Okt 2026 (perintah Sensei): Fly.io menjadi server
  UTAMA. Default CUA_WS_ENDPOINT sekarang wss://chess-uno-arena.fly.dev;
  Railway turun jadi standby, dipilih eksplisit lewat ?server=railway.
  Konteks: Railway major outage + insiden keamanan env vars (21 Okt,
  diumumkan resmi) — paparan kita nihil (hanya FIREBASE_PROJECT_ID publik).
  Link pemain tidak berubah: https://fir-pro2-d77c3.web.app (default Fly);
  ?server=fly tetap diterima (sama dengan default).
