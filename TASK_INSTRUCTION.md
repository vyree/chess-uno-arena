# TASK_INSTRUCTION.md — The Step-by-Step Prompt

> Worksheet Raphael. Satu fase dalam satu waktu. JANGAN loncat fase.

> **PEMBATALAN 27 Okt 2026 (perintah Sensei):** semua planning yang belum naik ke prod DIBATALKAN — login Google, Jalur B chat LLM, migrasi Firestore, proposal Keluar Room showModal, sfx khusus Truth, redeploy Railway. Jangan dibangun, jangan ditagih lagi. Prod tetap Fly v9 + Firebase apa adanya.

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
   **[DIGANTIKAN OLEH MISI 5 — 22 Okt 2026: asumsi ini TERBALIK dari
   maksud Sensei. Aturan yang benar ada di bagian MISI 5 di bawah.]**
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

1. **Giliran**: roda berputar **acak murni** tiap giliran — DENGAN dua
   aturan keadilan TERSEMBUNYI (revisi Sensei, 22 Okt 2026, menggantikan
   "roda adil" rancangan awal): (a) pemain yang baru saja menerima
   pertanyaan DIKELUARKAN dari putaran berikutnya (istirahat 1 putaran),
   lalu masuk lagi di putaran setelahnya; (b) satu pemain maksimal
   menerima **5 pertanyaan per sesi** — lewat dari itu ia dikeluarkan
   dari roda otomatis. Kedua aturan ini TIDAK PERNAH ditampilkan di
   game (tidak ada indikator/teks), supaya roda terasa natural.
2. **Menjawab**: lewat chat/teks di room; **timer jawaban 2 menit** —
   waktu habis = dianggap pass.
3. **Reaksi & poin**: pemain lain memberi reaksi pada jawaban
   (🔥 greget, 😂 ngakak, 🥺 deep, 👏 apresiasi) → reaksi = poin bagi
   penjawab. Tombol **"Kurang greget!"** = pengurang poin (definisi final
   di bagian Sistem Reaksi & Penghargaan di bawah).
4. **Jatah PASS**: tiap pemain 1x per game melewati pertanyaan tanpa
   hukuman (jaga kenyamanan; soal dikurasi sopan, tidak vulgar).
5. **Akhir game**: total pertanyaan habis — **10 untuk room 2–5 pemain,
   16 untuk room 6–8 pemain** (keputusan Sensei 22 Okt 2026; BUKAN lagi
   pemain × putaran, host tidak memilih jumlah putaran) → podium gelar
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
- [x] Fase 2 — Integrasi server: room tipe truth, alur giliran/reaksi/
      poin/gelar, MC bot, simulasi WS end-to-end; room menyimpan
      pengaturan "Set Aturan" (batas pertanyaan + Mode Eksplisit)
      yang dipilih host di lobby dan meneruskannya ke engine
      — SELESAI 22 Okt 2026: driver timer server (spin 10 dtk →
      jendela ASK 10 dtk → jawab 2 mnt → reaksi 15 dtk) menggerakkan
      engine; semua event engine di-broadcast sebagai `truth_event`
      (bahan notif pop-up Fase 3); MC bot berkomentar via chat bila
      manusia < 3; pemain keluar di tengah game tidak membekukan
      room (kursinya tetap, timer meng-auto-pass gilirannya).
      Asumsi baru (boleh dikoreksi): jendela reaksi 15 detik; penanya
      ASK punya 30 detik mengirim soal — lewat itu giliran hangus
      (fungsi engine baru `expireAskWindow`; jatah PASS penjawab
      tidak ikut terbakar). Timing bisa dioverride via env
      TRUTH_SPIN_MS/TRUTH_ASK_WINDOW_MS/TRUTH_ASK_SUBMIT_MS/
      TRUTH_ANSWER_MS/TRUTH_REACT_MS khusus untuk simulasi cepat.
      Tes: 76/76 unit hijau + sim WS Truth 2 skenario SEMUA LOLOS
      (Set Aturan, ASK, kartu otomatis, PASS, timeout, poin reaksi,
      MC, Mode Eksplisit penuh 8 soal) + regresi simulate.js LOLOS.
- [x] Addendum Fase 2 — Room Bot Truth untuk UJI COBA (Sensei,
      22 Okt 2026, SEMENTARA): pesan `create_truth_bot_room {size}`
      (total kursi 2–8 termasuk manusia) membuat room bot yang
      langsung mulai dengan aturan default. Bot tidak bisa menjawab
      sungguhan, jadi server MENYIMULASIKANNYA: jawaban diambil dari
      kolam jawaban pura-pura (`TRUTH_FAKE_ANSWERS` di game/bot.js),
      bot ikut bereaksi ke jawaban pemain (poin & gelar tetap
      mengalir), dan jendela reaksi pada giliran bot dipersingkat
      supaya uji coba solo tidak lambat. MC tetap menemani (manusia
      < 3). Terverifikasi: sim WS skenario C (solo 4 kursi) LOLOS
      penuh 2x berturut-turut; total suite 77/77 unit + regresi
      simulate.js LOLOS.
      **Spek UI dari Sensei (untuk Fase 3):** pintu masuk uji bot ini
      adalah menu **"( test bot )" di lobby game Truth, diletakkan di
      bagian FOOTER dan agak tersembunyi** — bukan menu utama.
- [x] Fase 3 — UI: layar truth, animasi roda nama, kartu soal, reaksi,
      podium gelar, efek suara; panel "Set Aturan" di layar room
      **SELESAI 22 Okt 2026** bersama cangkang MABAR.io: lingkaran
      pemain adaptif 2–8 mengelilingi cakram roda berwarna + jarum
      (berputar saat fase spin), banner fase, panel per tahap (ASK,
      pertanyaan, jawaban + PASS, 4 tombol reaksi + Kurang Greget +
      Lanjut), pop-up peristiwa wajib, podium gelar + tabel skor,
      chat arena + MC, panel Set Aturan di lobby (host; terverifikasi
      echo server). Terverifikasi end-to-end via Chromium headless:
      satu game bot penuh sampai podium (ASK, jawab, reaksi, next),
      nol error JS; 77/77 unit + sim truth + regresi simulate LOLOS.
      Suara: Truth memakai chat MC + pop-up visual; sfx khusus Truth
      belum ditambah (suara UNO/catur tidak berubah).
- [x] Fase 4 — Deploy + uji publik **SELESAI 22 Okt 2026**:
      server Fly.io (image dari GitHub Actions build-image, deploy
      flyctl --image; mesin sin sehat), client Firebase Hosting
      fir-pro2-d77c3. Uji publik terverifikasi dari luar: situs live
      berjudul MABAR.io, WebSocket wss://chess-uno-arena.fly.dev
      membalas pong (kode baru), dan room bot Truth berhasil dibuat
      di produksi (game_state stage spin).

## Panel "Set Aturan" (keputusan Sensei, 22 Okt 2026)

Setelah room terbentuk, ada kolom/panel **"Set Aturan"** (host yang
mengatur, di lobby sebelum game mulai — asumsi Arona). Isinya:

1. **Batas pertanyaan** — host memilih salah satu: **8, 10, 12, 16,
   20, 24**. Pilihan ini mengalahkan default otomatis (10 untuk room
   2–5 pemain, 16 untuk room 6–8 pemain). Engine: opsi
   `totalQuestions`, divalidasi terhadap daftar resmi itu.
2. **Toggle Mode Eksplisit** ("Eksplisit Question / Explicit Mode"):
   - Kartu hanya berisi **50 pertanyaan eksplisit** (`EXPLICIT` di
     `game/questions.js` — bank terpisah, TIDAK tercampur 200 soal
     normal; tema dewasa: kebiasaan & pengalaman intim, kesetiaan).
   - Tombol **ASK dinonaktifkan total** selama mode ini — pertanyaan
     murni dari kartu (engine menolak klaim ASK).
   - Notif jeda antar-giliran diganti: bukan lagi ajakan siapa yang
     mau bertanya, melainkan **"Pertanyaan eksplisit akan keluar
     secara acak"**.
   - Dukungan engine SELESAI di Fase 1 (opsi `explicitMode`, flag
     terbaca di snapshot); panel & plumbing room menyusul Fase 2/3.

Catatan interaksi aturan: batas rahasia 5x per pemain tetap berlaku di
semua mode — room kecil dengan batas besar (mis. 2 pemain memilih 24)
akan berhenti sendiri saat semua pemain menyentuh batasnya (2 pemain =
maks. 10 pertanyaan efektif), lewat mekanisme selesai-dini engine.

## Asumsi terbuka (boleh dikoreksi Sensei kapan pun)

- Timer jawaban 2 menit; 1 game = 10 pertanyaan (room 2–5 pemain) atau
  16 pertanyaan (room 6–8 pemain); reaksi 4 jenis;
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
  1/16" = pertanyaan berjalan dari total game (total dikunci Sensei
  22 Okt: 16 HANYA untuk room 6–8 pemain; room 2–5 pemain totalnya 10,
  tampil "1/10"); pemain
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

## MABAR.io — Cangkang 3 Tab (Sensei, 22 Okt 2026)

Aplikasi berganti nama jadi **MABAR.io** (logo header "MABAR.io").
Menu utama menjadi cangkang 3 tab dengan header + tab bar yang hanya
tampil di layar tab:
- **Home**: kartu Catur & UNO berdampingan + kartu lebar Truth or
  Truth (Game 3 = Truth, dikonfirmasi Sensei) dengan roda CSS.
- **Profile (ME)**: avatar BAWAAN (8 pilihan emoji gradien, tanpa
  upload — keputusan Sensei: ringan), edit nickname, Level & Score
  dari statistik lokal (XP = poin + 20/menang + 5/main; Level =
  1 + floor(sqrt(XP/60))), Tentang Ku (bio lokal 120 char, edit pensil).
- **Settings**: Sound (cua-sound), **Graphic High/Low** (cua-gfx;
  Low membekukan animasi/bayangan/blur + mematikan animasi kartu
  terbang — "grafis" di arena web = kualitas efek visual), **Test
  Ping** (3 sampel ping/pong lewat socket game, tampil ms + label
  kualitas), info server.
- Menu "( test bot )" Truth berada di footer MENU GAME Truth
  (catatan: spek awal menyebut lobby; ditafsirkan sebagai area depan
  game Truth karena room bot langsung mulai tanpa lobby).
- Urutan bangun disetujui Sensei: cangkang+Home -> Settings ->
  Profile -> layar Truth.

## MISI 4 — Sesi Tangguh (Sensei, 22 Okt 2026)

Latar: dua bug lapangan — (1) toast "Kirim hello dulu ya" setelah keluar
room lalu mau main lagi; (2) refresh di tengah game berujung "Sesi tidak
ditemukan, masuk ulang ya". Diagnosis mode debugger Arona: server menghapus
identitas pemain saat leave/disconnect tanpa masa tenggang untuk room bot
& lobby, handler close tidak memeriksa socket pemilik sesi, dan handler
rejoin memanggil sendGameState tanpa syarat (crash snapshot lobby).

### Bagian A — Perbaikan sesi (DIPUTUSKAN Sensei: kerjakan bersama B)
- [x] Server: handler close hanya memproses disconnect bila socket yang
      putus adalah socket aktif pemilik pemain (penjaga close basi).
- [x] Server: masa tenggang reconnect 60 dtk untuk SEMUA room (bot, lobby,
      bermain) lewat expireGrace(); pembersihan per tipe room hanya saat
      tenggang habis tanpa rejoin. RECONNECT_GRACE_MS bisa ditimpa env.
- [x] Server: ekor handler rejoin menyegarkan sesuai fase (lobby ->
      sendLobby, bermain -> sendGameState); tidak ada lagi crash snapshot.
- [x] Client: setelah left_room langsung hello ulang; error "Sesi tidak
      ditemukan" memulihkan diri (buang sesi mati + hello baru).

### Bagian B — Pengerasan sesi (DIPUTUSKAN Sensei: kerjakan bersama A)
- [x] Server: identitas pemain persisten — leave_room hanya melepas
      pemain dari room, rekor identitas & ikatan socket TIDAK dihapus
      (forfeitPlayer dapat parameter keepIdentity untuk jalur leave).
- [x] Client: sesi (playerId + kode room) disimpan di localStorage agar
      selamat dari tab tertutup / browser mati, bukan sessionStorage.
- [x] Client: antrean pesan keluar bergerbang welcome — tidak ada
      perintah game yang terkirim sebelum server menyambut socket ini.
- [x] Server: routing per socket diserialkan (rantai promise) — temuan
      saat verifikasi: route() async membuat dua frame dalam satu paket
      bisa saling mendahului (hello dikalahkan create, 9/20 gagal uji
      loop di kode lama); kini mustahil secara urutan.

### Bagian C — Pengambilalihan Bot (SELESAI BUILD 22 Okt 2026 — deploy ditahan Sensei)
Dikerjakan atas perintah Sensei 22 Okt malam (setelah Misi 8 build),
deploy menunggu semua pekerjaan kelar. Aturan dari Sensei:
- Pemain putus koneksi **lebih dari 18 detik** -> kursinya **diambil alih
  bot** sampai pemain itu kembali masuk ke game.
- Selama diambil alih, **nama tampilan pemain menjadi nama + "bot"**
  (mis. "Noir bot") agar pemain lain tahu kursi itu sedang dimainkan bot.
- Bot memegang kursi sampai pemain kembali atau game selesai.
- Kesiapan otak: UNO siap (game/bot.js), Truth nyaris siap (driver
  auto-pass), Catur perlu bot pengisi sederhana (belum ada AI catur).

Implementasi (commit setelah e9b5410):
- Server: `BOT_TAKEOVER_MS` (env, default 18000) — timer per kursi di
  `armTakeover()` (saat putus di tengah game, dan saat game dimulai
  untuk kursi yang manusianya sudah pergi). `engageTakeover()` memasang
  flag `takenOver`; snapshot menampilkan nama via `dispName()` +
  `takenOver: true` + `connected: true`; klien menampilkan label
  "is thinking" untuk kursi takenOver (UNO & badge catur).
- Otak per game: UNO memakai `bot.takeTurn` yang sama dengan bot room
  (jeda mikir Misi 8 berlaku juga); Truth memperlakukan kursi takenOver
  seperti bot di `scheduleTruthBots` (jawaban simulasi + reaksi +
  endTurn dipercepat); Catur memakai bot pengisi netral resep `gpt`
  dari `chessbot.chooseMove`, jeda mikir dibatasi sisa waktu giliran
  (`scheduleChessTakeover`).
- **expireGrace TIDAK lagi forfeit di tengah game**: kursi dipegang bot
  sampai game selesai; identitas pemain dipertahankan sehingga rejoin
  SETELAH grace pun bisa mengklaim kembali kursinya (`releaseTakeover`
  di handler rejoin; langkah bot yang terlanjur terjadwal mundur lewat
  cek `seatDriven()`). Ini sekaligus menutup dua bug lapangan Sensei:
  kartu kursi yang putus jadi 0 (forfeit destruktif) dan penolakan
  "room sudah mulai main" saat kembali setelah putus lama.
- Pembersihan: `cleanupGhostSeats()` di setiap transisi game-over —
  kursi hantu (takenOver & tidak terhubung) dilepas, identitas dihapus,
  room tanpa manusia terhubung ditutup. `handleUnoNewRound` juga
  membuang kursi hantu sebelum ronde baru.
- Leave sukarela TIDAK berubah (tetap forfeit langsung); room bot solo
  tidak berubah (teardown saat grace habis).
- Tes: `test/takeover.test.js` (4 tes integrasi WS: UNO takeover +
  klaim balik lewat grace, rejoin cepat tanpa label bot, catur bot
  pengisi + klaim balik, Truth dijawabkan bot bukan timeout).

## MISI 5 — Koreksi Stacking + Mode Hell + 2 Kartu Baru (Sensei, 22 Okt 2026)

KOREKSI ATURAN (kata Sensei): "mode ekstrim itu boleh tumpuk +4 — mode
normal itu hanya +2 boleh tumpuk." Aturan Misi 2 butir 6 di atas adalah
asumsi tertulis Arona yang TERBALIK; bagian ini yang berlaku.

### Mode (3 pilihan: Normal / Hard / Hell; "Ekstrim" berganti nama "Hard")
- NORMAL: kena +2 -> hanya boleh dijawab +2. Kena +4 -> TIDAK bisa
  dilawan sama sekali, wajib ambil 4.
- HARD: kena +2 -> boleh dijawab +2 ATAU dieskalasi +4. Kena +4 -> hanya
  boleh dijawab +4. Sekali +4 masuk, rantai terkunci di level +4
  (pendingKind mengikuti kartu jawaban terakhir).
- HELL: penumpukan persis seperti Hard + deck khusus + 2 kartu baru.

### Deck
- Normal & Hard: klasik 108 (per warna: 0 x1, 1-9 x2, skip/reverse/+2 x2;
  wild x4, wild+4 x4).
- Hell: 128 — khusus Hell: +2 jadi x4 per warna (total 16), wild+4 jadi
  x8, ditambah Reverse Black x4 + Null White x4.

### Reverse Black Card (Hell saja, x4)
- Kartu hitam, logo sama seperti Reverse biasa, nyambung di semua warna.
- HANYA bisa dimainkan saat menghadapi tumpukan; di luar itu mati total
  (tidak bisa dipakai sebagai Reverse biasa).
- Efek: arah putaran berbalik; tumpukan (jumlah + jenis) utuh memantul ke
  pemain di arah baru; warna berjalan TIDAK berubah; tanpa pilih warna.
- Nilai sisa di tangan saat ronde selesai: 50 poin.

### Null White Card (Hell saja, x4)
- Kartu putih, logo X.
- HANYA bisa dimainkan saat menghadapi tumpukan.
- Efek: tumpukan langsung NULL — final, TIDAK bisa di-counter (tidak ada
  jendela respons); SEMUA pemain termasuk pemiliknya ambil +2 rata.
- Privilege pemilik: memilih warna berjalan berikutnya (seperti Wild).
- Pajak +2 adalah bagian dari memainkan kartu -> melempar Null sebagai
  kartu terakhir TIDAK memenangkan ronde (tangan terisi +2 lagi).
- Nilai sisa di tangan saat ronde selesai: 50 poin.

### Implementasi (mengikat)
- Payload mode: `mode: 'normal'|'hard'|'hell'` di create_bot_room &
  start_game (validator memetakan legacy `extreme: true` -> 'hard').
  Pilihan mode ada di menu bot & lobby (host), badge in-game menampilkan
  HARD / HELL (Normal tanpa badge).
- Engine: st.mode; isStackCard mode-aware; playCard menyelesaikan Null
  SEBELUM cek UNO/menang; Reverse Black tidak menyentuh pendingDraw/
  pendingKind/currentColor.
- Bot: jawaban tumpukan = kartu stack dulu; Reverse Black bila tumpukan
  >= 4; Null White bila tumpukan >= 6; di bawah ambang itu bot menelan
  tumpukan daripada membakar kartu spesial.

### Addendum Misi 5 — Server pindah rumah: chess-uno-arena -> ayo-nge (22 Okt 2026)
- Sensei meminta alamat Fly diganti. Nama app Fly TIDAK bisa di-rename,
  jadi jalurnya: app baru "ayo-nge" dibuat, image yang sama di-deploy ke
  sana (region sin, 1 mesin always-on), klien diarahkan ke
  wss://ayo-nge.fly.dev (firebase-config.js + ?server=fly), fly.toml dan
  workflow build-image memakai registry ayo-nge. App lama
  chess-uno-arena DIHAPUS setelah alamat baru terbukti melayani
  (perintah Sensei). Railway tetap standby via ?server=railway.

## MISI 6 — Label Beta Truth + Catur VS AI (Sensei, 22 Okt 2026 sore)

Perintah Sensei: (1) Truth or Truth diberi label "( Beta Test )" karena
belum final. (2) Catur mendapat mode "VS AI" — sebenarnya bot, tapi UI
TIDAK PERNAH menyebut kata bot di mode ini; lawan ditampilkan sebagai
persona AI: Gemini (Level Normal), GPT (Level Hard), Meta (Level
Hell), Claude (Level Hell). (3) AI diberi waktu mikir yang dramatis
(bukan 1,5 detik): rata-rata 5–10 detik, kadang >10, kadang >20, dan
sesekali sampai batas waktu hampir habis — dengan tulisan
"Gemini is thinking…" (nama mengikuti persona) selama ia berpikir.

Keputusan implementasi (as-built):
- Label Beta: badge di kartu Truth layar utama (menggantikan badge
  BARU) + pil #gm-beta di header menu game Truth.
- Engine SATU, empat kostum: game/chessbot.js — negamax alpha-beta +
  evaluasi material/posisi. Gemini kedalaman 1 + blunder 35%; GPT
  kedalaman 2 + blunder 8%; Meta kedalaman 3; Claude kedalaman 3 +
  pencarian tangkapan (quiescence) sehingga ia yang terkuat. Anggaran
  node 90 ribu/langkah menjaga server tetap ringan.
- Alur: pesan create_chess_ai_room { persona } membuat room bot catur
  (manusia = kursi 0 = Putih, persona = kursi 1 = Hitam), game mulai
  seketika. chess_new_round untuk tombol Main Lagi di layar game over
  (room VS AI saja, dari status over). Validasi persona di
  game/validate.js terhadap chessbot.PERSONAS.
- Waktu mikir: chessbot.pickThinkMs — 60% di 5–10 dtk, 20% di 10–20
  dtk, 12% di 20–40 dtk, 8% di zona bel (batas − 2,5 dtk − acak
  0–2 dtk). CAP KERAS batas −2,5 dtk: timeout catur = KALAH, jadi AI
  tidak pernah benar-benar kehabisan waktu; ia bergerak tepat sebelum
  bel. Penjadwalan di scheduleChessAiIfNeeded/runChessAiTurn
  (server.js), berbagi room.botTimer dengan bot UNO. Env
  CHESS_AI_THINK_MS menimpa jeda (khusus tes/sim; produksi kosong).
- Indikator: renderChess menampilkan "<Persona> is thinking" +
  kelas .thinking (animasi titik-titik CSS) pada badge giliran saat
  lawan adalah seat bot dan bukan giliran pemain; ruang catur
  multiplayer biasa tetap "Giliran lawan".
- Batasan jujur: kekuatan mesin ringan ini setara pemain kafe yang
  kuat di level Hell — bukan Stockfish; itu memang niatnya (kostum).
- KOREKSI Sensei (22 Okt 2026 malam): label level (Normal/Hard/Hell)
  DIHAPUS dari tombol persona — tingkat kesulitan adalah RAHASIA;
  pemain hanya melihat nama AI-nya. Resep kekuatan tetap di server.

## MISI 7 — Waktu Mikir v2 + Persona Bisa Chat (Sensei, 22 Okt 2026 malam)

Perintah Sensei: (1) waktu mikir AI dirombak per fase game + kasus
khusus; (2) kolom chat di room catur VS AI dihidupkan — persona
membalas chat pemain secara scripted (Jalur A, nol kuota; Jalur B/LLM
ditolak dulu demi prinsip irit kuota). Cakupan: CATUR DULU; library
dibuat terpisah & game-agnostic agar game lain bisa memakai nanti.

Waktu mikir v2 (chessbot.pickThinkMs(rand, limitMs, ctx)) — kasus
khusus mengalahkan fase: 1 langkah legal ≤3 dtk; sedang diskak ≤7 dtk;
2–3 langkah legal ≤5 dtk; recapture jelas 2–5 dtk. Fase: langkah 1–7
= 5–10 dtk; 8–30 = bervariasi maks 30 dtk; 31+ = distribusi drama
lama (boleh sampai zona bel). Cap keras batas −2,5 dtk tetap. Konteks
dihitung server di chessThinkContext (nomor langkah st.full, inCheck,
jumlah langkah legal, recapture dari st.lastMove).

Library bahasa (game-agnostic, murni fungsi, nol I/O):
- game/slang.js — DATA saja: kamus singkatan chat ID (~170 entri),
  kosakata kanonik (~230 kata) untuk kerangka, daftar kata kasar.
  File ini yang Sensei tambah saat mau mengajari kata baru.
- game/textbrain.js — normalisasi (huruf kecil, lipat huruf berulang
  3+), ekspansi token (kamus → frasa), KERANGKA KONSONAN (buang vokal
  dari dua sisi: "sprt"≡"seperti", "klh"≡"kalah", "akn"≡"akan"),
  pencocokan intent (pola token; terpanjang menang), deteksi makian
  (utuh/singkatan/kerangka), deteksi gibberish (cakupan kata dikenal
  <34%), flag pertanyaan & emoji-only.
- game/personachat.js — otak persona: INTENTS (nameAsk & tanya
  keadaan game didahulukan), bank kalimat 4 persona × 31 kategori
  (suara: Gemini ceria, GPT sopan, Meta dingin, Claude kalem-smug),
  mesin kebijakan: tanya pemain/papan selalu dijawab dari FAKTA
  (nama asli, materi, hitungan tangkapan, nomor langkah, status skak
  — via chessFacts server), smalltalk 90%, trivia luar papan
  dihindari berkelas, gibberish 50%, cooldown balasan 5 dtk, jeda
  event 20 dtk, jeda ngetik 0,7–3,8 dtk. TANGGA MAKIAN: tangkisan
  lucu → garis batas → MUTE 90 dtk (game tidak terpengaruh). Persona
  tidak pernah memaki balik & tidak pernah melepas kostum.

Glue server (khusus room VS AI catur): sapaan 'start' saat room
dibuat & ronde baru; balasan chat dari handler 'chat'; event lines
dari afterChessMove (tangkapan 30–35%, skak 40–50%, hasil akhir
selalu); mid-think line bila jeda ≥20 dtk (ditembak di 40% jeda,
dicek ulang chance/gap saat mendarat); hitungan tangkapan room
(aiCaptures) dari selisih jumlah bidak sebelum/sesudah langkah.
Klien TIDAK berubah — chat persona memakai pesan 'chat' biasa dengan
from = nama persona.

## MISI 8 — Skill Unik per Persona Catur + Bot UNO Mikir (Sensei, 22 Okt 2026 malam)

Keputusan Sensei (berurutan, malam 22 Okt): (1) Gemini "bodo" karena
blunder — skill attack ditambah, blunder DINOLKAN, pertahanan tetap
diabaikan ("fokus ke attack"); (2) setiap persona dapat SATU skill
unik selain gaya main; (3) Gemini dapat skill unik KEDUA: "2-Knight
Parade" — dua kuda menerjang tanpa ampun, bidak lain mengamankan
mereka; (4) bot UNO juga dikasih jeda mikir 5–10 detik + label
"is thinking" biar natural (tidak selama catur); (5) GAS — lalu
DITAHAN dari deploy: "lanjut dulu tp jgn deploy dulu yaaa, mau buat
main dulu" → build + tes lokal saja, deploy menunggu kata Sensei.

### Mesin (game/chessbot.js v3)
- evaluateFor(st, personaKey, botColor): evaluate dasar (Putih) +
  flavor per persona yang HANYA berlaku untuk warna bot — pressure
  ring raja lawan (attack), garpu + kemajuan kuda (fork/knight),
  perisai pion + pressure ring raja sendiri (defense), raja aktif +
  pion bebas di endgame (endgame). Bobot: Gemini atk 2.2/fork 2.0/
  knight 2.2/def 0.1/end 0.5; GPT 1.0/1.0/1.0/1.25/1.0; Meta 1.7/1.3/
  1.1/0.8/0.8; Claude 1.1/1.1/1.0/1.3/1.8.
- Resep: Gemini depth 2, blunder 0, jitter 90. GPT depth 2, blunder
  0.08, jitter 40. Meta depth 3, jitter 25, sacTolerance 340. Claude
  depth 3 + quiescence, jitter 10.
- Buku pembuka mini per persona (langkah berbobot, cermin peringkat
  untuk Hitam; hanya bila full ≤ 4 & tidak ada tangkapan tersedia)
  + openingPrior (prinsip pembuka ±20 cp, full ≤ 10): mesin dangkal
  tidak bisa merasakan tempo yang terbuang, jadi pembuka waras
  dijamin buku — cara yang sama dipakai engine beneran.

### Skill unik (penyesuaian skor di akar pencarian)
- Gemini "Pantang Mundur": langkah mundur non-tangkapan −120.
- Gemini "2-Knight Parade": langkah kuda +30; kuda mendarat en prise
  tanpa pelindung −80; langkah yang menyelamatkan/membela kuda yang
  sedang diserang +50 (pengawal); membiarkan kuda tergantung −60.
- GPT "Protokol Anti-Blunder": maxNetLoss (tangkapan bersih terbesar
  lawan dalam 1 langkah, SEE-lite dengan recapture) — bila ada
  langkah nyaris terbaik yang aman, langkah berbahaya (≥200) −400.
- Meta "Si Penjebak": di dalam toleransi: tangkapan +40, skak +130,
  pengorbanan sejati (penyerang ≥300 memakan lebih murah) +170,
  + trapBonus (skor statis sesudah balasan SERAKAH lawan vs sesudah
  balasan TERBAIK — selisihnya ×0.5) untuk 6 kandidat teratas.
- Claude "Si Penggerus": unggul >60 cp → tukar-menukar melibatkan
  ratu +45; tertinggal → −35. Endgame di flavor (1.8).

### Chat pemicu skill (personachat + server)
- Kategori baru: parade (Gemini, maks 2×/game via room.aiParadeCount),
  knightLost (Gemini — kudanya dimakan manusia), bait (Meta — sesudah
  langkahnya, manusia BISA memakan bidak ≥300), grind (Claude —
  memakan ratu lawan). Meta langkah kini membawa movedType/
  capturedType/movedTo (chessMoveMeta, dibaca SEBELUM applyMove) dari
  handleChessMove & runChessAiTurn. Prioritas: knightLost > parade >
  bait > grind > tangkapan/skak biasa.

### Bot UNO mikir
- server.unoBotThinkMs(): acak 5.000–10.000 ms (env UNO_BOT_THINK_MS
  menimpa untuk tes/sim). Klien: status UNO saat giliran bot =
  "<nama> is thinking" + kelas .thinking (animasi titik dipakai
  bersama badge catur via CSS).

### Bukti (tes deterministik, test/chessbot.test.js + personachat)
Pembuka buku 4 persona × 5 rng; Gemini rng-0 tetap memakan ratu
tergantung + menemukan mate scholar; Pantang Mundur (Gemini d5f6
maju vs GPT d5f4 mundur); Parade (kuda bergerak dulu; pengawal c7c6/
e7e6 membela kuda tergantung); Greek Gift (Meta d3h7, GPT menolak);
Penggerus (Claude d1d5 saat unggul, menolak saat tertinggal);
evaluateFor garpu (Gemini > GPT sebesar >30 cp); bank kalimat skill
4 kategori. Total suite: 117/117.

## PERBAIKAN BUG 1 — Layar Beku di HP (Sensei, 23 Okt 2026 — SELESAI BUILD, deploy ditahan)

Konteks lapangan: situs LIVE, multiplayer 5–6 orang, di HP — pergerakan
tidak terlihat setelah 2–3 sesi sampai refresh. Diagnosis mode debugger
dengan tes Chrome (CDP): kandidat saveSession TERBUKTI (setItem tanpa
try/catch di jalur render membunuh handler game_state; frame & chat
tetap hidup, papan beku), kandidat soket half-open prasyaratnya
terkonfirmasi (nol heartbeat dua arah), kandidat modal basi minor,
kandidat timer bot GUGUR (room manusia murni).

Tiga perbaikan (ACC Sensei "gas 3-3 nya"):
1. Klien: saveSession() + clearSession() dibungkus try/catch — simpan
   sesi best-effort, tidak pernah membunuh render lagi.
2. Heartbeat dua arah: klien ping app-level tiap 15 dtk; hening total
   35 dtk -> soket dipaksa tutup -> reconnect + rejoin otomatis (plus
   cek seketika saat tab terlihat lagi). Server: ws ping tiap 30 dtk
   (env WS_HEARTBEAT_MS), soket yang melewatkan satu sapuan penuh
   diterminasi -> jalur disconnect biasa (grace + Fase C) berjalan.
3. Klien: onGameState selalu hideModal() lebih dulu — state baru tidak
   pernah ter-render di balik modal basi.

Verifikasi: suite 123/123 (termasuk test/heartbeat.test.js baru:
klien sehat tidak diputus, soket mati diterminasi); simulate +
sim_truth lolos; tes racun Chrome diulang pada build ter-fix: 33x
setItem melempar tertelan, render terus hidup; soket yang dibungkam
paksa reconnect + rejoin sendiri tanpa refresh.

## MISI 9 — Room & Session (Sensei, 23 Okt 2026 — ACC penuh incl. saran tonton live + timer keputusan 60 dtk — SELESAI BUILD, deploy ditahan)

Model dua lapis yang dipisah tegas:
- **Room** = wadah persisten berisi ANGGOTA (maks 8 per room, semua
  game). Room SELALU bisa dimasuki — termasuk saat game berjalan.
- **Session** = satu kali permainan di dalam room, dimainkan sebagian
  atau semua anggota. Session lahir saat game mulai, HANCUR saat game
  selesai. Main lagi = session baru.

Aturan main:
- Anggota yang masuk saat session berjalan TIDAK ikut bermain; ia
  menjadi PENONTON (mode tonton live: papan & progres terlihat
  read-only, tangan pemain lain tetap angka; chat room tetap bisa).
  Room menampilkan status "game sedang berlangsung" / "game sudah
  selesai" untuk semua anggota.
- **Fase keputusan** seusai game (room status 'decision', timer
  **60 detik** — env DECISION_MS untuk tes): setiap pemain session
  wajib memutuskan LANJUT atau TIDAK. Session berikutnya tidak mulai
  sebelum semua memutuskan. Memilih tidak / klik keluar / tutup tab /
  putus koneksi / diam sampai timer habis = TIDAK LANJUT (keputusan
  dianggap selesai, tidak menahan orang lain selamanya).
- Session baru berisi pemain yang LANJUT + anggota room (penonton)
  yang menekan tombol Join Game selama fase keputusan. Bila jumlahnya
  kurang dari minimum game (2), session tidak terbentuk dan room
  kembali ke lobby (semua tetap anggota).
- **Keluar game != keluar room.** Keluar game (di tengah session atau
  di fase keputusan) = berhenti bermain, lalu duduk sebagai penonton/
  anggota di lobby room. Keluar room = langkah terpisah yang melepas
  keanggotaan sepenuhnya.
- Start dari lobby: semua anggota ikut session, kecuali Catur yang
  session-nya selalu 2 orang (dua anggota pertama; sisanya penonton).
- Room bot solo (VS AI / lawan bot) TIDAK ikut model ini — alur
  Main Lagi lamanya dipertahankan.

Implementasi (mengikat):
- room.players tetap daftar pemain session (kontrak engine & seat
  tidak berubah); daftar baru room.spectators untuk anggota penonton.
  Kapasitas room = players + spectators <= 8 untuk semua game.
- Pemain punya flag inSession; semua handler aksi game menolak
  non-pemain session ("sedang menonton"). Penonton menerima snapshot
  spectate (UNO: toClient seat -1 — semua tangan berupa angka).
- Pesan baru: 'decide' {play:boolean} (pemain session: lanjut/tidak;
  penonton: ikut/tidak) dan 'leave_game'. Server menyiarkan
  'decision_update' {endsAt, roster:[{id,nickname,state}], canJoin}
  selama fase keputusan; payload game_over room multiplayer membawa
  flag decision:true agar klien menampilkan panel keputusan, bukan
  modal lama.
- Putus koneksi di fase keputusan = TIDAK LANJUT seketika + keanggotaan
  dilepas. Putus di tengah session tetap jalur lama (grace + Fase C);
  kursi hantu yang masih dipegang bot saat game selesai otomatis
  TIDAK LANJUT di fase keputusan.
- Daftar room publik kini menyertakan room yang sedang bermain
  (dengan statusnya) agar bisa dimasuki untuk menonton.

Status Misi 9: SELESAI BUILD (23 Okt 2026). Verifikasi: suite 128/128
(termasuk test/session.test.js baru: gabung tengah game = penonton
read-only, keputusan bersama menahan start, penonton opt-in masuk
sesi baru, keluar game tetap anggota -> balik lobby, timer diam =
tidak lanjut, UNO ronde -> keputusan -> ronde 2); simulate +
sim_chess_only + sim_truth lolos (skenario UNO sim diperbarui ke alur
keputusan); tes takeover UNO distabilkan (rejoin 1700ms — di atas
2,1 detik ronde sah bisa berakhir lebih dulu); screenshot Chrome:
18-spectate.png (badge menonton + papan live), 19-decision-panel.png
(panel + roster + hitung mundur), 20-back-to-lobby.png.

## MISI 10 — UNO Unlimited + Kartu Reset + Negate! (Sensei, 23 Okt 2026 — SPEK TERKUNCI, PARKIR)

**Perintah Sensei (23 Okt 2026 ±10:42 WIB): "catat dulu dan parkirkan dulu
yaa.. nanti kita bahas lain kali" — spek ini hanya DICATAT; jangan dibangun
sampai Sensei membuka lagi diskusinya.**

### Toggle Unlimited (panel room UNO, berlaku di semua level: Normal / Hard / Hell)
- Game TIDAK berakhir saat pemain pertama habis — pemain yang finis
  dikeluarkan dari permainan, game berlanjut sampai tersisa tepat 1 pemain
  yang kalah.
- Bonus peringkat: 1st +350, 2nd +300, berkurang 50 per peringkat di
  bawahnya (3rd +250, 4th +200, ...).
- Skor finisher = nilai kartu sisa semua lawan pada momen ia finis +
  bonus peringkat; pemain terakhir (yang kalah) = 0.

### Kartu Reset (Hell saja, x2 — deck Hell bertambah 128 -> 132)
- Kartu putih berlogo tombol power.
- **REVISI Sensei 26 Okt 2026 ±23:31 WIB (SUPERSEDES trigger lama):**
  Reset BUKAN lagi jawaban tumpukan — hanya bisa dimainkan saat ada
  yang teriak "UNO!" (sisa 1 kartu), seperti Negate!. Bukan kartu
  giliran biasa, bukan jawaban tumpukan, dan pemegang harus punya
  minimal 2 kartu (tidak bisa jadi kartu terakhir).
- Efek (revisi): SEMUA tangan pemain + discard pile dikumpulkan ke
  deck, di-shuffle, semua pemain yang masih aktif menggambar ulang
  7 kartu, kartu pembuka baru di-flip, pengaktif jalan duluan.
  Tumpukan yang sedang berjalan ikut nol karena pengocokan ulang.
- Jendela Uno! kini menampung DUA kartu respons (Negate! dan Reset):
  respons pertama menang, yang lain ditolak karena jendela tertutup.
- Uncounterable; 2 kopi, maks 2 kali pakai per game.
- (Trigger lama — "hanya saat terkena stack +2/+4" — SUDAH TIDAK
  BERLAKU di live sejak deploy 975d89b, 26 Okt 2026.)

### Kartu Negate! (Hell saja, x2 — deck Hell bertambah 128 -> 132)
- Kartu hitam berlogo.
- Hanya bisa diaktifkan saat ada yang teriak "Uno!" dengan sisa 1 kartu.
- Efek: Uno dibatalkan; setiap pemain lain memilih 1 kartu untuk
  diberikan ke korban (pemain yang kartunya tinggal 1 dikecualikan dari
  memberi); lalu korban menggambar +2 lagi.
- Setiap ada yang teriak "Uno!", dialog "tunggu respon.." muncul di
  SEMUA pemain selama 5 detik agar pemegangnya tetap tersembunyi;
  pemegang Negate dapat dialog "pakai atau tidak" — siapa cepat dia
  dapat; lewat 5 detik tanpa respons -> permainan lanjut.
- Fase memilih kartu: maks 10 detik; timeout -> sistem memilih kartu
  bernilai terendah otomatis.
- Tidak bisa dimainkan sebagai kartu terakhir (syarat tangan pemegang
  >=2); uncounterable; 2 kopi, maks 2 kali pakai per game.
- Bot otomatis memakai Negate dan memberikan kartu terendah.

Catatan tafsir (sudah dikonfirmasi Sensei): saat membahas jendela Uno!,
Sensei menulis "kartu reset" — yang dimaksud adalah Negate (salah ketik,
sudah dikonfirmasi Sensei).

**Status: DIBANGUN 26 Okt 2026 atas perintah Sensei ("tambahkan misi 10,
build skrg") — DEPLOYED 26 Okt 2026 malam (commit 58b13f2; server Fly
v7 + klien Firebase live; smoke test browser lulus). REVISI trigger
Reset DEPLOYED 26 Okt 2026 ±23:51 WIB (commit 975d89b; Fly v8 +
Firebase live; verifikasi browser live lulus: `uno_reset` 3× di
kedua host).**

### Catatan build (26 Okt 2026 — adaptasi dari spek, dicatat agar tidak hilang)
- Baseline deck berubah karena kartu ungu (26 Okt 2026): Hell 155, bukan
  128 — jadi Hell dengan Misi 10 = **159** (bukan 132). Normal/Hard tetap
  133 (Reset/Negate hanya ada di Hell).
- Jam milik server, bukan engine (pola yang sama seperti driver Truth):
  engine hanya MENCATAT jendela/hadiah; server menghentikan giliran dan
  menjalankan timer 5 detik (jendela) / 10 detik (hadiah). Timeout adalah
  jaring pengaman semua edge (disconnect, kursi takeover, klik terlewat).
- Fase hadiah berjalan PARALEL: semua pemberi memilih dalam satu jendela
  10 detik yang sama; timeout memilihkan kartu terendah per pemberi.
- Reset mengocok ulang hanya untuk kursi yang masih aktif: kursi finis
  (Unlimited) dan kursi nonaktif yang dikosongkan tetap keluar.
- Bot: Negate otomatis dipakai saat jendela terbuka; hadiah bot = kartu
  terendah. Bot TIDAK PERNAH otomatis memakai Reset (revisi 26 Okt
  2026; asumsi Arona — Reset kartu keputusan manusia; belum ada
  perintah Sensei yang mengubahnya).
- Jendela Uno! = satu respons per jendela (Negate! ATAU Reset, siapa
  cepat dia dapat); engine menutup jendela pada respons pertama.
- **BUG LIVE 2026-10-27 (diperbaiki + DEPLOYED commit 4cbec44, Fly v9):** route
  uno_negate/uno_gift/uno_reset ada di switch server.js tapi TIDAK ada
  di VALIDATORS game/validate.js — server memvalidasi SETIAP pesan
  sebelum routing, sehingga semua aksi jendela ditolak live dengan
  'perintah tidak dikenal'. **Aturan checklist permanen: pesan WS baru
  WAJIB didaftarkan di DUA tempat (VALIDATORS + switch case), dan tes
  regresi validateMessage wajib ada.** Tes regresi: `test/uno_misi10.test.js`
  bagian "WS validate allowlist".
- **BUG VISUAL 2026-10-27 (diperbaiki + DEPLOYED commit 4cbec44):** kartu Reset tidak punya
  override warna teks — label sudut putih (#fff bawaan .uno-card) di
  atas kartu off-white (#f5f5f0) = tidak terlihat; pola nullwhite
  (color + border-color gelap) diterapkan ke .uno-card.reset.
- Keluar saat jendela/hadiah berjalan: jendela ditutup / hadiah
  dibatalkan (kartu kembali ke pemilik), timer giliran dimulai ulang.

## UNO: Waktu Bermain + Tanda Turn (Sensei, 27 Okt 2026 — DIBANGUN LOKAL, BELUM DEPLOY)

Perintah Sensei: (1) waktu bermain dari game start sampai akhir game;
(2) tanda turn — 1 turn = 1x giliran pemain bermain, skip/reverse tetap
terhitung 1 turn.

### Spesifikasi yang dipakai (asumsi Arona, tercatat agar bisa dikoreksi)
- **Waktu bermain**: milik server (`room.uno.startedAt` di 4 titik
  pembuatan UNO baru: start_game, startSession, uno_new_round,
  create_bot_room; `endedAt` dibekukan saat game berakhir pertama kali).
  Satu ronde baru = game baru, waktunya mulai dari nol lagi. Klien
  hanya memformat + men-tick lokal di antara snapshot server.
- **Turn**: `st.turnCount` = turn yang SUDAH selesai. Tampilan saat
  main = `turnCount + 1` (turn yang sedang berjalan); di layar akhir =
  total `turnCount`.
- Yang dihitung 1 turn: main kartu (termasuk kartu kemenangan/finis),
  lewati setelah ambil kartu, tarik penalti +N (turn korban habis),
  turn yang maju karena timeout. Ambil kartu saja belum dihitung
  (masih tengah turn). Main gagal tidak dihitung.
- Skip = 1 untuk pemain yang main saja (pemain yang diskip tidak dapat
  turn); reverse = 1 untuk pemain yang main saja (arah berbalik, tetap
  1 turn; di 2 pemain giliran kembali ke pemain yang sama, tetap 1).
- Negate!/Reset!/hadiah BUKAN turn, tidak menambah hitungan. Setelah
  Reset, pemain yang main berikutnya dihitung sebagai turn baru yang
  normal (Reset sendiri tidak dihitung).
- Tampilan: bar game UNO `🕐 MM:SS · 🔄 Turn N` (di samping timer
  giliran 60 detik yang sudah ada — beda fungsi, jangan dicampur);
  layar akhir game `🕐 Waktu bermain` + `🔄 Total turn`.
- Cakupan: UNO saja (catur/Truth tidak disentuh).

### File yang diubah (lokal, belum commit/deploy)
- `game/uno.js`: `turnCount` di `newGame`, increment di `playCard`
  (menang/finis/akhir), `drawCard` penalti, `passTurn`; `toClient`
  mengekspos `turnCount` + `turnNumber`.
- `server.js`: `unoPlayDurationMs`, `startedAt` di 4 titik, `game_state`
  membawa `playStartedAt`/`playDurationMs`, `game_over` membawa
  `playDurationMs`/`turnCount`.
- `public/index.html` + `public/app.js`: elemen `#uno-play-meta`,
  `fmtPlayTime`/`updateUnoPlayMeta`, tick interval 500 ms, baris waktu
  + total turn di `onGameOver`.
- Tes baru `test/uno_playtime_turn.test.js` (9 tes), didaftarkan di
  `package.json` test script.

### Verifikasi lokal (27 Okt 2026)
- `npm test`: **153/153 lulus** (144 lama + 9 baru).
- Sim WS nyata (server lokal, `UNO_BOT_THINK_MS=0`, manusia vs 1 bot):
  game selesai, `game_over` membawa `playDurationMs=15068` (±15 detik)
  dan `turnCount=52`; turnCount payload = state terakhir sebelum kartu
  kemenangan (51) + 1 untuk kartu kemenangan itu sendiri.
- **BELUM DEPLOY**: menunggu perintah "gas deploy" Sensei (Fly v9 +
  Firebase tetap versi lama sampai saat itu).
