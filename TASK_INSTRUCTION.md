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

## Mode Kartu Terakhir — Reset & Negate! (Sensei, 30 Okt 2026 — DIIMPLEMENTASI, menunggu perintah deploy)

Riwayat: dirancang 29 Okt 2026 (parkir), difinalisasi + diimplementasi
30 Okt 2026 atas perintah Sensei ("kerjakan dengan ultimate skill",
laporan dulu 10:34, jawaban Sensei 10:50). Keputusan final Sensei 30 Okt:
(1) efek DISABLED bila dimainkan sebagai kartu terakhir; (2) jendela tetap
butuh ≥2 kartu — aturan lama TIDAK dihapus; (3) main sebagai kartu terakhir
MENGHABISKAN jatah 2×/game; (4) pertanyaan urutan warna-vs-reshuffle GUGUR
(tidak ada reshuffle di jalur terakhir; warna pilihan langsung jadi warna
berjalan); (5) bot memainkan kartu terakhir spesial dengan warna acak;
(6) klik kartu membuka popup info (efek + cara pakai) dengan tombol
[Pakai kartu]/[Tutup], tanpa badge kecil; (7) seluruh UI/UX in-game UNO
dimodernisasi tapi tetap ringan; meja putih default + garis batas di
pinggir (desain meja dipikirkan ulang nanti oleh Sensei).

### Spesifikasi final (aditif — aturan jendela 26 Okt tidak berubah)
- **Mode jendela (tetap):** hanya saat ada yang teriak "UNO!"; pemegang
  butuh ≥2 kartu; respons pertama menang; maks 2× per game.
- **Mode kartu terakhir (baru):** di giliran sendiri, bila tangan tersisa
  tepat 1 kartu (si spesial itu sendiri) dan tidak ada tumpukan pending →
  boleh dimainkan (selalu legal seperti Wild, abaikan warna kartu teratas).
  Wajib pilih warna (error 'pilih warna dulu' bila absen). Efek kartu
  DISABLED di jalur ini. Mode normal = langsung menang; Unlimited = finis
  (rank + skor), game lanjut dengan warna pilihan.
- Jatah 2×/game mencakup KEDUA mode (jendela + kartu terakhir) —
  MEREVISI asumsi parkir 29 Okt yang membebaskan mode terakhir dari jatah.
- Anti-stuck: sebelumnya kartu spesial sebagai satu-satunya kartu = kartu
  mati selamanya (jendela butuh ≥2, giliran biasa menolak) — softlock di
  Unlimited, tak bisa menang di normal. Bot kena juga.
- Tidak butuh pesan WS baru: jalur terakhir memakai `uno_play` yang sudah
  ada (+ `wildColor`, sudah diteruskan validator). Checklist permanen
  (VALIDATORS + switch + tes regresi) tidak terpicu.

### File yang diubah (lokal, 187/187 tes lulus, menunggu perintah deploy)
- `game/uno.js`: `canPlayCheckSpecials()` baru; `canPlay()` + `playCard()`
  membuka jalur terakhir (cek jatah, wajib warna, efek disabled, warna
  pilihan menjadi currentColor, jatah bertambah); `toClient.playable`
  otomatis benar.
- `game/bot.js`: `takeTurn()` — kartu terakhir spesial dimainkan dengan
  warna acak (Sensei).
- `public/app.js`: `UNO_LABEL.reset` ⏻ → ↻; tombol jendela '↻ Pakai
  Reset!'; klik kartu spesial di luar jendela → `showSpecialInfo()` (popup
  efek + cara pakai; tombol [Pakai kartu] hanya muncul bila playable, lalu
  color picker); flash '↻/≠ keluar sebagai kartu terakhir' di
  `handleUnoEvents`.
- `public/style.css`: `.uno-arena` putih + garis batas (ganti panel felt
  ungu); modernisasi tombol (gradien, shadow, pill, hover), `#chat-box-uno`
  gaya bubble, toast kaca gelap, status pill gradien, placeholder input,
  hover color picker, modal lebih lembut, kartu playable terangkat saat
  hover, `.special-info`/`.special-glyph`, kartu Reset putih bersih + oval
  lavender + glyph ↻ tebal.
- `test/uno_lastcard.test.js` (7 tes, baru, terdaftar di package.json test
  script); pesan error lama di `test/uno_misi10.test.js` disesuaikan
  ('...atau sebagai kartu terakhirmu').

## UNO: Waktu Bermain + Tanda Turn (Sensei, 27 Okt 2026 — DEPLOYED Fly v10)

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
- **DEPLOYED 27 Okt 2026 (perintah "gas deploy" Sensei)**: commit
  `90009c0`, server Fly `ayo-nge` **v10** (mesin 82de14c70e2568, sin,
  started; image `img_2wokpyqmmj5yv3g1`, config `bb9ebc7d25cb`) +
  klien Firebase `fir-pro2-d77c3` release complete. Isi image
  ter-deploy dibuktikan via container (turnCount, uno-play-meta,
  playDurationMs, fmtPlayTime ada). Catatan: restart server mematikan
  room yang sedang berjalan; deploy sempat menampilkan peringatan DNS
  sementara untuk ayo-nge.fly.dev (propagasi, mesin sendiri sehat).

---

# LUDO JAHAT — Fase 1 (Sensei, 27 Okt 2026 — BUILD LOKAL SAJA, TANPA DEPLOY/PUSH)

Perintah Sensei: "gas dibuild ludo kitaaa", nama game "Ludo Jahat".
Status fase ini: build lokal untuk dimainkan vs bot; TIDAK deploy ke
Fly/Firebase, TIDAK push ke GitHub, prod tidak disentuh. Working tree
boleh kotor untuk direview Sensei.

## Spek terkunci (sumber kebenaran: docs/ludo-skill-rules.md — jangan diubah)
- Nama UI: "Ludo Jahat". Klasik: 4 token/pemain, keluar base hanya
  dadu asli 6, jalur utama 52 petak, mendarat tepat di token lawan =
  makan (pulang ke base), petak aman = petak start + petak bintang,
  masuk home butuh angka pas, menang = semua 4 token home.
- Dadu 6 diubah: dapat 6 = jalan dulu pakai 6 itu, lalu kocok lagi;
  maks 3x dapat 6 dalam satu giliran, kocokan ke-4 dalam rantai yang
  sama TIDAK PERNAH 6. ATURAN TERSEMBUNYI: jangan tampilkan di UI
  maupun teks aturan manapun (juga bukan di popup kartu/aturan game).
- Block skill: 4 buah, 1 di tengah tiap sisi, jauh dari petak bintang,
  BUKAN petak aman, kartu hanya didapat kalau mendarat TEPAT (bukan
  lewat), visual jelas beda dari bintang (ikon kartu), kartu yang
  sudah didapat tidak hilang kalau tokennya dimakan.
- Deck bersama 64 kartu, tiap jenis 4 copy: attack hitam 4x4=16,
  defense putih 4x4=16, netral ungu 8x4=32.
- Attack (Sniper, Bom Petak, Rantai Seret, Es Beku): TIDAK bisa
  disimpan, harus dipakai saat itu juga setelah didapat atau hangus.
  Bom Petak: 1 petak jalur utama, semua bidak di petak itu pulang ke
  base, kena bidak sendiri juga (friendly fire), kecuali petak aman;
  sekali pakai, instan, bukan ranjau. Attack tidak bisa menyerang token
  di base, petak aman, jalur home, atau rumah. Seret = mundur 10.
  Beku = token tidak bisa digerakkan di giliran pemiliknya berikutnya.
- Defense (Perisai Baja, Cermin Pantul, Teleport Darurat, Kulit Batu):
  disimpan, trigger HANYA saat diserang, pemain pilih 1 per serangan,
  habis sekali pakai. Cermin hanya target-tunggal (Sniper/Seret/Beku),
  TIDAK untuk Bom Petak. Teleport ke petak aman terdekat di depan,
  kalau tidak ada ke petak start warnanya. Kulit Batu: serangan
  membunuh diubah jadi mundur 6 petak.
- Netral ungu (x2, +1, +2, +3, -1, -2, -3, bebas pilih langkah 1-6):
  disimpan, HANYA untuk diri sendiri, HANYA mengubah jumlah langkah —
  dadu asli menentukan keluar base/kocok lagi. Dipakai setelah kocok,
  sebelum token jalan, maks 1 kartu per kocokan.
- Simpanan: defense + netral GABUNGAN maks 3/pemain. Tangan sudah 3 dan
  dapat kartu simpanan baru: boleh buang 1 kartu lama untuk menukar;
  kalau tidak mau tukar, kartu baru yang hangus.
- Hangus vs terpakai: hangus (tidak dipakai/ditolak/dibuang saat tukar,
  efek tidak terjadi) KEMBALI ke deck dan dikocok lagi. Terpakai (efek
  sudah terjadi) hilang permanen. Deck habis (0 kartu) = TIDAK ada
  restore/reshuffle, block tidak memberi kartu lagi selamanya di game
  itu, game lanjut dengan simpanan yang masih dipegang sampai habis.
- Animasi simple (<1 detik, CSS/emoji) tiap efek kartu (docs bagian 6).
- Bubble popup penjelasan: SEMUA kartu bisa diklik, isi cara pakai +
  kegunaan. Popup pengumuman: saat pemain memakai kartu, muncul ke
  SEMUA pemain (nama kartu + siapa + efek/target), hilang sendiri
  setelah beberapa detik, tidak memblokir giliran, tidak membocorkan
  tangan yang belum dipakai.

## Asumsi eksplisit Fase 1 (BUKAN aturan kunci — Sensei boleh koreksi)
- Fase 1 = mode Vs Bot 4 pemain (1 manusia + 3 Komputer) dulu; mode
  room teman ditunda ke fase berikutnya, struktur kode tidak menutup
  kemungkinan itu (engine tidak bergantung pada isBot).
- Urutan kursi searah jarum jam sesuai gambar desain: merah (Kamu,
  kiri atas) -> hijau (kanan atas) -> kuning (kanan bawah) -> biru
  (kiri bawah). Ini yang menentukan offset start 0/13/26/39 dan kolom
  home tiap warna; bukan urutan merah-hijau-biru-kuning.
- Blokade TIDAK dipakai: token sewarna menumpuk tidak membentuk
  blokade, lawan tetap bisa lewat; lawan yang mendarat di petak
  non-aman memakan SEMUA token lawan di petak itu.
- Pemenang: game berhenti di pemenang pertama (semua 4 token home).
- Cooldown block: block yang sudah memberi kartu tidur 1 putaran penuh
  (semua pemain dapat giliran) sebelum bisa memberi kartu lagi.
- Sniper: penyerang harus punya minimal 1 bidak di jalur utama.
- Kartu -: langkah akhir tidak boleh di bawah 1; kartu - tidak bisa
  dipakai kalau hasilnya <1.
- Posisi petak block (absolut jalur utama 0..51): [5, 18, 31, 44].
  Alasan: masing-masing di tengah segmen 13 petak tiap sisi (segmen
  merah 0-12, hijau 13-25, biru 26-38, kuning 39-51); jarak ke petak
  aman terdekat minimal 3 petak (5 ke 8 = 3, ke 0 = 5; 18 ke 21 = 3,
  ke 13 = 5; 31 ke 34 = 3, ke 26 = 5; 44 ke 47 = 3, ke 39 = 5) — jadi
  jauh dari bintang/start sesuai perintah, dan tidak ada block yang
  menempel petak aman. Petak aman absolut = [0, 8, 13, 21, 26, 34, 39, 47].
- Extra roll klasik (makan lawan / token sampai home) tetap berlaku,
  dan rantai 6 dihitung per giliran yang sama (termasuk roll ekstra
  dari makan/home). Implementasi cap: begitu 6 sudah keluar 3x dalam
  satu giliran pemain, SEMUA kocokan berikutnya di giliran yang sama
  dibatasi 1-5 sampai giliran berpindah (ini bacaan literal "maks 3x
  dapat 6 dalam satu giliran"; kalau Sensei maksudnya rantai putus
  setelah satu kocokan non-6, aturan ini harus dikoreksi).
- Keluar base: token dari base yang dadu aslinya 6 ditempatkan di
  petak start (progress 0); langkah 6 itu dipakai untuk keluar, bukan
  ditambah jalan 6 petak dari start. Pemain boleh memilih jalan token
  lain yang sudah di jalur dengan langkah hasil modifikasi, sebagai
  ganti keluar base.
- Bot: sederhana dan sah (tidak mengintip tangan lawan/deck): pilih
  token dengan prioritas keluar base (6) > makan > masuk home >
  mendarat block skill > petak aman > maju terjauh; attack dipakai
  langsung saat dapat; defense dipilih saat diserang (Perisai untuk
  Sniper/Bom, Cermin untuk target-tunggal bila ada bidak penyerang di
  jalur, Teleport bila terdesak, Kulit Batu sebagai fallback); netral
  sederhana (+/x2 untuk mengejar home, - untuk pas masuk home, bebas
  pilih untuk pas masuk home/keluar dari kejaran). UI lawan bot TIDAK
  PERNAH menyebut kata "bot" — label "Komputer" seperti desain.
- Timer giliran: mengikuti pola UNO, 60 detik (TURN_TIMEOUT_MS yang
  sama); timeout = aksi otomatis yang sah (kocok + jalan pertama /
  lewati attack / tolak defense / pertahankan tangan), lalu giliran
  lanjut — bukan forfeit langsung, agar game bot tidak mati karena
  satu timeout.

## File yang diubah/dibuat (Fase 1)
- [x] TASK_INSTRUCTION.md (bagian ini)
- [x] game/ludo.js (baru, engine murni, tanpa DOM)
- [x] game/validate.js (validator ludo_* — aturan permanen repo)
- [x] game/rooms.js (minimal: MAX_PLAYERS.ludo = 8, agar create('ludo') lolos)
- [x] server.js (minimal: snapshot ludo, create_ludo_bot_room, handler
      ludo_roll/ludo_move/ludo_use_neutral/ludo_attack/ludo_defense/
      ludo_swap/ludo_pass_attack, timer 60 dtk, driver bot, pengumuman)
- [x] public/index.html (kartu game Ludo Jahat, layar screen-ludo)
- [x] public/app.js (render Ludo, dadu, kartu, popup, animasi — tanpa aturan main)
- [x] public/style.css (minimal: papan gelap Ludo, kartu, popup, animasi)
- [x] test/ludo.test.js (baru) + package.json (daftarkan tes + node --check)
- [x] TIDAK diubah: Dockerfile, fly.toml, CI, kode UNO/Catur/Truth
      kecuali titik integrasi minimal di atas (satu baris room.ludo
      di backToLobby + cabang snapshot/game_over/timeout di server.js).

## Verifikasi Fase 1 (27 Okt 2026, lokal saja — TIDAK deploy/push)
- `npm run check`: bersih. `npm test`: **174/174 lulus**
  (153 lama + 21 baru di test/ludo.test.js).
- Sim WS lokal (server port lokal, LUDO_BOT_THINK_MS=0, 1 manusia
  otomatis + 3 Komputer): game penuh sampai pemenang — **Komputer
  Kuning menang**, 709 aksi manusia, 48 pengumuman (draw kartu,
  pakai netral, makan bidak). Sim pertama sempat kena rate limit
  20 pesan/detik server karena aksi otomatis terlalu cepat (bukan
  bug game untuk pemain manusia; sim diperlambat jadi <10 pesan/
  detik, socket tidak lagi ditutup).
- YANG BELUM TERBUKTI DI SIM WS: pasangan attack+defense yang
  terekam eksplisit di log pengumuman (log sim hanya mencetak 20
  pengumuman pertama; attack/defense teruji di unit test engine:
  Perisai membatalkan Sniper, Cermin ditolak untuk Bom, Bom friendly
  fire). Perlu uji manual di browser: klik kartu attack, pilih
  target, lihat defense lawan ter-trigger + popup pengumuman.
- YANG BELUM DIVERIFIKASI: tampilan papan di browser sungguhan
  (subagen ini tidak punya live browser; render papan hanya dicek
  lewat node --check + logika koordinat, bukan screenshot).
  Sensei perlu cek visual: yard merah kiri atas, dadu tengah,
  petak bintang, block skill ikon kartu, token pion.

## Integrasi assets ludo-clean (27 Okt 2026 — LOKAL SAJA, TANPA DEPLOY/PUSH)
Perintah Sensei: terapkan assets ludo-clean ke game. Aturan game,
engine, server, dan validator TIDAK diubah; yang diubah hanya tampilan
(renderLudo, style, struktur dadu) + perbaikan geometri SVG.
- Latar papan: `public/assets/ludo-clean/board-full.svg` (img, bukan
  225 div grid CSS lagi). Bintang, block skill, kolom home, dan
  segitiga tengah sudah ada di dalam SVG — tidak digambar ulang
  sebagai div di atasnya. Token jalur/home/tengah tetap memakai
  pemetaan grid yang sudah ada (LUDO_PATH / LUDO_HOME / [7,7]).
- Perbaikan geometri SVG (board-full.svg + yard-*.svg, folder yang
  sama, bukan folder baru): kotak dalam base dibuat KONSENTRIS
  dengan kotak luar yard, sesuai syarat Sensei (pendekatan v2 lama
  yang menggeser kotak dalam ke titik tengah slot DITOLAK dan tidak
  dipakai lagi). Yard 0-360, kotak dalam 60-300 (lebar 240, pusat
  180 = pusat yard, margin 60 di semua sisi). Per warna: merah
  dalam (60,60), hijau (600,60), kuning (600,600), biru (60,600)
  dalam koordinat papan 0-900.
- Pemetaan SLOT TAMPIL base (display-only, BUKAN perubahan aturan):
  token progress -1 dirender di slot tampil ini, urut tokenIdx
  0..3, bukan di pusat sel grid engine (2,2),(2,4)... yang
  rata-ratanya bergeser ke tengah papan dan tidak simetris di yard.
  Koordinat papan 0-900: merah [[120,120],[240,120],[120,240],
  [240,240]], hijau [[660,120],[780,120],[660,240],[780,240]],
  kuning [[660,660],[780,660],[660,780],[780,780]], biru
  [[120,660],[240,660],[120,780],[240,780]]. Dalam persen papan:
  120/900=13.333%, 240/900=26.667%, 660/900=73.333%,
  780/900=86.667%. Slot = 1/4 dan 3/4 kotak dalam (120 dan 240
  relatif yard), jarak ke semua sisi sama, gap sama, tiap pion
  tepat di tengah lingkaran slot (r=28 di SVG). Di app.js:
  LUDO_BASE_DISPLAY + ludoTokenPos(); LUDO_BASE lama tetap ada
  untuk referensi grid tapi tidak lagi dipakai untuk render base.
- Token: `<img>` pawn-{color}.svg absolut (persen), bukan emoji.
  Token jalur/home: pusat sel grid ((c+0.5)/15, (r+0.5)/15).
  Token menumpuk di satu titik digeser simetris +-1.4 poin persen
  agar tidak tumpang tindih persis. Target Bom: tombol transparan
  di pusat sel block skill. Token beku: badge ❄️ + glow biru.
- Dadu tengah: `<img>` dice-{n}.svg sesuai angka server (bukan
  teks 🎲 + angka); saat belum ada dadu, tampil dice-6.svg redup
  sebagai placeholder dekoratif (bukan hasil kocokan).
- Perbaikan label kartu tangan (cacat cek visual sebelumnya):
  `.ludo-card` menjadi inline-flex dengan gap 6px, sehingga nama
  dan label grup tidak lagi menempel ("+3 Langkah Netral").
- Ringan: yang dimuat di layar Ludo hanya board-full.svg 15.353
  byte + 4 pion @420 byte + 1 dadu <=461 byte = sekitar 17,5 KB
  total (folder ludo-clean utuh 104 KB termasuk demo/README/
  per-part yang tidak dimuat di game). Tanpa PNG/JPG besar, tanpa
  library baru, tanpa font eksternal, animasi tetap CSS <1 detik.

## Perbaikan lingkaran slot + nama pemain di base (27 Okt 2026 — LOKAL SAJA)
Perintah Sensei: lingkaran slot base dibuat simetris dan berimpit
dengan pion; nama pemain di atas tiap kotak base.
- Akar cacat screenshot sebelumnya: board-full.svg + yard-*.svg
  berisi DUA set lingkaran per yard — lingkaran utama r=28 di
  posisi slot tampil (120/240 dst.) DAN lingkaran samar r=20
  fill=none di pusat sel grid engine (150/270 dst., bergeser
  +30/+30 dari pion). Lingkaran samar itulah yang terlihat kosong
  dan menggantung. Perbaikan: semua lingkaran r=20 samar DIHAPUS
  dari board-full.svg dan keempat yard-*.svg (board-full: 38
  lingkaran -> 22, yaitu 16 slot r=28 + 4 dot kartu skill r=5 +
  2 lingkaran tengah; tiap yard: 8 -> 4). Lingkaran yang tersisa
  persis sama dengan LUDO_BASE_DISPLAY di atas, r=28 (diameter 56
  = lebar pion 6,2% papan), jadi pion menutupi isi lingkaran dan
  stroke warnanya melingkari pion. Kotak dalam tetap konsentris
  (60-300), tidak diubah.
- Tafsir "samain dengan posisi dadu": dadu duduk tepat di tengah
  lingkaran area dadu tengah papan; yang diminta untuk base
  adalah hal yang sama — lingkaran slot harus berimpit dengan
  pionnya, BUKAN dengan dadu tengah (dadu di 50%,50% tidak ada
  hubungannya dengan slot base; menyamakan slot ke dadu akan
  menumpuk semua pion di tengah papan, jadi tafsir itu ditolak
  dan dicatat di sini).
- Nama pemain: overlay teks HTML absolut `.ludo-base-name` di
  dalam `#ludo-board` (bukan gambar/font/library baru), dibuat
  sekali di renderLudo lalu diperbarui tiap render dari roster
  live `m.players[pi].nickname` (urutan kursi = red, green,
  yellow, blue; room bot: merah = nickname manusia, sisanya
  "Komputer Hijau/Kuning/Biru" dari server). Posisi: pita atas
  tiap yard, lebar 40%, tinggi 6,667% (tepi luar yard sampai tepi
  kotak dalam), sehingga tidak menutupi pion baris pertama
  (tepi atas pion di 10,2%). Perataan Sensei: merah (kiri atas,
  left 0%, top 0%, rata kiri), hijau (kanan atas, left 60%, top
  0%, rata kanan), kuning (kanan bawah, left 60%, top 60%, rata
  kanan), biru (kiri bawah, left 0%, top 60%, rata kiri).
  Gaya: teks putih tebal, bayangan hitam tipis, ukuran
  clamp(10px, 3,4vw, 14px), ellipsis bila nama terlalu panjang.
  Verifikasi: screenshot baru di
  ~/workspace/your_files/ludo-clean-applied/names-v2/ .

## Perbaikan kecil + uji attack/defense (27 Okt 2026 — LOKAL SAJA,
## BELUM TERBUKTI attack+defense, BUG DRIVER BOT DITEMUKAN)
Perintah Sensei (ACC via widget): lanjutkan sekarang, tetap lokal,
tanpa deploy/push. Perbaikan kecil SELESAI dan terverifikasi:
- Dadu placeholder: sebelum ada hasil kocokan, dadu tengah kini
  memakai `dice-blank.svg` baru (kotak putus-putus + "?" abu-abu,
  tanpa pip, ~318 byte, gaya sama dengan dice-*.svg). `dice-6.svg`
  hanya tampil setelah hasil kocokan benar-benar 6. Perubahan:
  `public/app.js` (diceImg.src/alt saat st.dice null),
  `public/index.html` (src awal), README ludo-clean (baris baru).
- Header mobile: aturan baru HANYA di `#screen-ludo .game-bar`
  (game lain tidak tersentuh): nowrap, gap 6px, badge ellipsis
  (max-width 260px desktop, 96px di <=480px), padding/font chip
  dikecilkan di <=480px. Bukti: tinggi bar 46px di 390px (satu
  baris, bukan dua), screenshot
  `your_files/ludo-clean-applied/attack-defense/05-blank-dice-mobile-header.png`
  (header 1 baris + dadu "?" di tengah) dan `06-blank-dice-desktop.png`.
Uji attack+defense via browser: TIDAK TERBUKTI (jujur, bukan gagal
otomasi semata). Permainan alami 10 menit di browser headless
(1.695 aksi, deck 64 -> 50, 21 pengumuman) TIDAK PERNAH mendapat
kartu attack — hanya defense/netral — lalu di menit ke-10 fase
attack Komputer Biru muncul dan macet. Harness WS (2 room paralel,
server asli, tanpa ubah repo) mereproduksi: SEMUA fase attack bot
(turn 1/2/3: bom, seret, beku) bertahan TEPAT 60000-60005 ms lalu
dilewati timer (ludoAutoStep -> pass, kartu hangus, tanpa
pengumuman pemakaian). Akar masalah (dibaca dari kode, bukan
tebakan): `server.js` ludoBotStep memanggil
`doLudoAttack(room, botChooseAttack(...))`, tapi format targetnya
tidak cocok — bot mengembalikan `{player, token}` / `{abs}`,
sedangkan doLudoAttack membaca `data.targetPlayer/targetToken/
targetAbs` (format klien manusia di `public/app.js`). Akibatnya
beginAttack selalu gagal ("target serangan tidak valid" /
tidak ada bidak di petak itu), botStep kembali tanpa ludoSync
dan tanpa timer baru, game menunggu timer giliran 60 detik.
Temuan terkait (belum diverifikasi terpisah): defense bot saat
penyerangnya manusia juga tidak terjadwal — scheduleLudoBot hanya
melihat kursi giliran (penyerang), bukan kursi defender, sehingga
defense bot kemungkinan hanya terselesaikan lewat timeout
(doLudoDefense null = terima serangan). PERBAIKAN INI TIDAK
DITERAPKAN di tugas ini (di luar cakupan "uji", butuh ACC Sensei):
pemetaan field target bot di doLudoBotStep + penjadwalan defense
untuk defender bot, plus tes integrasi bot-attack. Sampai itu
diperbaiki, pasangan attack+defense TIDAK BISA dibuktikan lewat
browser — jangan diklaim terverifikasi. Bukti: screenshot
`attack-defense/04-final.png` (fase attack Biru macet, toast
"Bukan giliranmu" = klik di luar giliran ditolak server dengan
benar) dan log `attack-defense/hunt-log.txt`.

## LUDO JAHAT — Perbaikan bug driver bot attack + kartu gaya UNO (27 Okt 2026 malam, LOKAL SAJA, TANPA DEPLOY/PUSH)

Perintah Sensei 27 Okt 2026 18:55 WIB: "boleh. perbaiki bugnya dengan
mode debugger. lalu, utk kartu.. buat design nya supaya kaya kartu di
game uno." Dikerjakan lokal saja; aturan/efek kartu TIDAK diubah
(docs/ludo-skill-rules.md tidak disentuh); UNO/Catur/Truth tidak
diubah kecuali gaya kartu Ludo yang meniru UNO.

### Bug: format target bot vs format klien manusia (ROOT CAUSE)

- `game/ludo.js` `botChooseAttack(st, attacker, card)` mengembalikan
  bentuk engine: non-bom `{player, token}` (target progress tertinggi),
  bom `{abs}` (petak skor musuh x10 - sendiri x8, hanya bila skor > 0).
- `server.js` `doLudoAttack(room, data)` membangun target untuk
  `ludo.beginAttack` dari format klien manusia: non-bom
  `{player: data.targetPlayer, token: data.targetToken}`, bom
  `{abs: data.targetAbs}`. `beginAttack` sendiri mengharapkan bentuk
  engine `{player, token}` / `{abs}`.
- `server.js` `ludoBotStep` cabang attack (sebelum perbaikan)
  meneruskan hasil bot mentah: `else doLudoAttack(room, target);`
  -> `doLudoAttack` membaca `target.targetPlayer/targetToken/targetAbs`
  = `undefined` -> `beginAttack` gagal ("target serangan tidak valid"
  non-bom / "tidak ada bidak di petak itu" bom) -> `doLudoAttack`
  mengembalikan `{ok:false}` -> pemanggil MENGABAIKAN return tanpa
  `ludoSync` dan tanpa timer baru -> game diam di fase `attack`
  sampai timer giliran 60 detik memicu `ludoAutoStep` (cabang attack ->
  `doLudoPassAttack`, kartu hangus kembali ke deck, tanpa pengumuman
  pemakaian). Bukti lama: semua fase attack bot bertahan TEPAT
  60000-60005 ms (hunt-log.txt tugas sebelumnya).

### Perbaikan (server.js saja, satu tempat per masalah)

1. ATTACK — terjemahan di SATU call-site bot, di cabang attack
   `ludoBotStep` (jalur manusia `doLudoAttack` TIDAK disentuh, karena
   `doLudoAttack` adalah kontrak klien manusia yang sudah divalidasi
   di `game/validate.js`; melebarkannya menerima dua format akan
   mengaburkan kontrak itu):
   - bom: `doLudoAttack(room, { targetAbs: target.abs })`
   - non-bom: `doLudoAttack(room, { targetPlayer: target.player, targetToken: target.token })`
   - fallback anti-gantung: bila `doLudoAttack` gagal, panggil
     `doLudoPassAttack` (pass sah: kartu hangus kembali ke deck);
     bila pass pun gagal, `ludoSync(room)` sebagai jaring pengaman
     terakhir. Jadi fase attack bot TIDAK PERNAH lagi diam tanpa
     sync/timer baru.
2. DEFENSE — dugaan tugas sebelumnya TERBUKTI dari kode (bukan
   asumsi): `scheduleLudoBot` lama hanya memeriksa
   `room.players[st.turn]` (penyerang). Selama fase defense, engine
   turn tetap di penyerang, jadi defender bot di belakang penyerang
   manusia tidak pernah dijadwalkan (hanya terselesaikan lewat
   timeout `doLudoDefense(null)` = terima serangan); sebaliknya
   penyerang bot + defender manusia membuat timer bot bisa
   auto-memainkan defense manusia. Perbaikan di `scheduleLudoBot`
   DAN di kepala `ludoBotStep` (konsisten di kedua tempat):
   `actor = (phase === 'defense' && pendingDefense) ? pendingDefense.defender : turn`;
   hanya jadwalkan/langkahkan bila `seatDriven(room.players[actor])`.
   Timer giliran 60 detik tetap berjalan lewat `ludoSync` ->
   `startTurnTimer`, jadi defender manusia yang diam tetap
   diselesaikan timeout.
3. TIDAK diubah: efek kartu, deck, cooldown, aturan lain, perilaku
   attack manusia, `game/ludo.js`, Dockerfile/fly.toml/CI,
   UNO/Catur/Truth.

### Tes baru + hasil

- `test/ludo.test.js` +4 tes engine (total file 25/25): (1) Sniper
  format mentah bot gagal, format terjemahan server berhasil +
  Perisai membatalkan; (2) Bom friendly fire (kedua token -> base);
  (3) Seret + Cermin memantul ke penyerang; (4) Beku + Teleport ke
  petak aman terdekat di depan (progress 10 -> 13).
- `test/ludo_bot_attack.test.js` BARU (didaftarkan di package.json
  script `test` + `check`): spawn server asli port 3221,
  `LUDO_BOT_THINK_MS=0`, klien WS auto-main kursi manusia, melacak
  fase attack bot + pengumuman `ludo_announce`. Kriteria: >=1 fase
  attack bot selesai <20000 ms DAN ada pengumuman kartu attack itu.
  Pelajaran harness (BUKAN bug server): (a) kirim create sebelum
  welcome ditolak ("Kirim hello dulu ya") -> tambah waitWelcome;
  (b) penjaga dedup state mematikan giliran manusia kedua -> dihapus
  (pengiriman ganda aman karena server menolak aksi kedua setelah
  fase berpindah); (c) pengumuman bisa tiba SEBELUM state fase attack
  diproses loop tes (antrean diproses bergantian saat loop sleep),
  sehingga versi awal tes membuangnya dan melaporkan announced=false
  padahal attack selesai 0-1 ms -> perbaikan tes: log pengumuman
  bertanda waktu (announceLog) dan cocokkan dalam jendela
  [attackStart-1s, +5s]. Setelah itu tes LULUS dalam 608 ms:
  "Komputer Biru memakai Es Beku!", attack selesai 0 ms (dulu 60000 ms).
- HASIL AKHIR: `npm test` 179/179 lulus (174 lama + 4 engine baru +
  1 WS baru); `npm run check` bersih.

### Desain kartu gaya UNO (hanya presentasi, CSS + render saja)

Referensi yang ditiru: `public/app.js` `cardHTML`/`cardClass` +
`public/style.css` `.uno-card` (kartu tegak 84x120, border 3px putih,
radius 10px, bayangan `0 3px 10px rgba(0,0,0,.25)`, indeks kecil
`.cnr` kiri atas + kanan bawah terbalik 180 derajat, oval putih
miring -22 derajat di tengah dengan nilai diputar balik +22 derajat).
- `public/style.css` `.ludo-card` lama (chip horizontal) diganti
  kartu tegak 78x112, border 3px putih, radius 10px, bayangan sama
  dengan UNO, `.cnr` 13px tl/br (br rotate 180 derajat), `.oval`
  84%x52% putih miring -22 derajat dengan `.val` 26px diputar balik,
  `.ludo-card-name` 10px bold maks 2 baris; `.ludo-card.mini`
  60x86 untuk bubble; `.ludo-announce-card` chip 22x22 bulat border
  pink neon untuk ikon di banner pengumuman.
- Warna jenis TIDAK diubah: attack `#17171c` (teks putih, oval putih,
  val gelap); defense `#f5f5f0` (border `#cfcfda`, oval gelap, val
  putih); netral `#7b2fbe` (oval putih, val ungu).
- `public/app.js`: konstanta `LUDO_CARD_ICON` (sniper target, bom,
  seret rantai, beku, perisai, cermin, teleport, kulit, x2, +1/+2/+3,
  -1/-2/-3, bebas "1-6") + `ludoCardFace(card, info)` (cnr + oval/val
  + nama + cnr, pola sama dengan `cardHTML` UNO). Tangan memakai
  face ini; bubble diawali mini card yang sama; pengumuman tetap
  `textContent` lalu `prepend` chip ikon (sengaja TIDAK innerHTML
  supaya nickname tetap tidak ter-escape). Kartu baru di
  `pendingDraw` masih teks, tidak diubah. Tanpa gambar raster baru,
  tanpa font eksternal, tanpa library.
- Verifikasi browser (headless-shell, server lokal port 3103,
  endpoint sementara lalu DIKEMBALIKAN, `git diff
  public/firebase-config.js` kosong): screenshot di
  `~/workspace/your_files/ludo-clean-applied/attack-defense-fixed/`:
  01-hand-desktop (kartu Perisai Baja gaya UNO di tangan),
  02-bubble-desktop + 03-bubble-mobile 390px (mini card di bubble,
  teks terbaca, tidak menutupi papan), 04-defense-ui (pengumuman
  "Komputer Kuning memakai Bom Petak!" + status diserang + 2 kartu
  defense gaya UNO dengan tombol "Pakai defense ini"),
  06/07-defense-after (Perisai terpakai: tangan tinggal Teleport
  Darurat, game lanjut ke giliran manusia, tanpa gantungan).
  CATATAN JUJUR: banner "memakai Perisai Baja" sendiri tidak
  tertangkap screenshot karena pada kecepatan think-0 banner
  langsung ditimpa event berikutnya (<1 detik); yang terbukti
  visual adalah pengumuman attack (04) + efek pemakaian defense
  (06/07). Animasi kartu (Sniper/Bom/Beku) juga BELUM tertangkap
  screenshot di tugas ini — hanya unit test + WS. Serangan kartu
  attack TIDAK pernah duduk di tangan (by design, instan saat
  didapat); wajah kartu attack di browser hanya muncul sebagai
  chip ikon di banner pengumuman.
- Sisa cacat dari tugas sebelumnya yang MASIH berlaku: dadu
  placeholder sudah blank, header mobile 1 baris, tapi animasi
  Sniper/Bom/Beku via browser + pasangan attack+defense untuk
  Cermin/Kulit Batu via browser belum tertangkap (hanya tes).

## Deploy Ludo Jahat — DEPLOYED 28 Okt 2026 (Fly v11, commit 438a1c6)
- Perintah Sensei 28 Okt 2026: deploy Ludo supaya bisa dicoba langsung di prod.
- Server: buildah (diinstal ulang via apt 28 Okt — biner lama hilang kena recycle VM;
  depot builder Fly + Docker statis GAGAL dari sandbox: depot menggantung, Docker
  gagal `setns: operation not permitted` saat RUN) -> push registry.fly.io/ayo-nge:latest
  (login token deploy) -> `flyctl deploy --image ... -a ayo-nge --ha=false` -> Fly v11,
  mesin sin started, health check lulus, root + /healthz 200.
- Klien: `firebase deploy --only hosting` (fir-pro2-d77c3) — index memuat "Ludo Jahat",
  app.js + board-full.svg 200. Link coba: https://fir-pro2-d77c3.web.app (default Fly).
- Verifikasi pra-deploy: `npm run check` bersih, `git diff public/firebase-config.js`
  kosong, npm test 179/180. SATU tes flaky: `test/ludo_bot_attack.test.js` gagal 3x
  dan lulus 1x (631 ms) dalam 4 run 28 Okt — tes ini memburu event acak (bot mendarat
  di block + menarik kartu attack) hanya dalam 3 room; perburuan WS terpisah 28 Okt
  membuktikan mekanisme prod bekerja (7 fase attack bot, selesai 0-10 ms, 6/7
  diumumkan). Tes ini perlu diperkeras (mis. seed/deterministik), BUKAN bukti
  regresi driver bot — jangan jadikan satu-satunya gerbang deploy, tapi jangan
  juga dihapus diam-diam.
- Catatan: uji WS prod dari sandbox GAGAL TLS (keterbatasan proksi sandbox, sudah
  dikenal sejak dulu) — uji WS akhir tetap di perangkat Sensei.
- Commit 438a1c6 + dokumen ini belum di-push ke GitHub saat deploy (deploy memakai
  image lokal); push dilakukan terpisah setelah verifikasi prod.

## Home cards disamakan — DEPLOYED 28 Okt 2026 (Fly v12, commit 2dba65d)
- Perintah Sensei 28 Okt 2026 (dari screenshot home): samakan warna + bentuk kartu,
  jadi 4 grid kotak; Ludo + Truth masing-masing dapat DUA label.
- Perubahan (hanya public/index.html + public/style.css): keempat kartu memakai
  satu gradasi ungu (#8f7fe0 -> #6750c2) dan grid 2x2 yang sama (Truth tidak lagi
  melebar penuh, Ludo tidak lagi gelap); Ludo + Truth masing-masing memakai dua
  badge: ( Under Construction ) kuning + ( Limited Access ) putih-pink. Badge
  lama ( Beta Test ) di kartu home Truth DIGANTI kedua badge ini.
- Pelajaran visual: versi pertama badge absolute pojok kanan MENUTUPI nama game
  di kartu setengah lebar (desktop + mobile) — diperbaiki jadi baris footer
  (margin-top:auto, di bawah art), terverifikasi screenshot desktop 900px + mobile
  390px sebelum deploy. Badge hanya label visual, kedua game tetap bisa dimainkan.
- Sisa: pill ( Beta Test ) di header MENU game Truth (gm-beta, tampil saat menu
  Truth dibuka) TIDAK diubah — itu bukan kartu home; tanyakan Sensei bila mau
  diganti juga.
- Deploy: buildah -> Fly v12 (sin started) + Firebase Hosting; verifikasi prod:
  style.css memuat gc-badges/badge-limited, index memuat 2x Under Construction +
  2x Limited Access.

## Label kartu home direvisi — DEPLOYED 28 Okt 2026 (Fly v14, commit adfff70)
- Perintah Sensei 28 Okt 2026 (dari screenshot prod): ukuran kartu beda karena
  label; buang label Limited Access, label Under Construction saja, kecil, di
  pojok kanan atas, supaya ukuran kartu sama.
- Perubahan: kedua kartu hanya satu badge ( Under Construction ) kecil
  (10px, absolute top:10px right:10px); header kartu berlabel diberi
  padding-top 20px supaya nama game mulai di bawah badge, bukan tertutup
  badge (pelajaran dari revisi sebelumnya). Badge absolute = tidak menambah
  tinggi kartu; terverifikasi screenshot desktop 900px + mobile 390px.
- Insiden deploy: VM recycle 28 Okt 12:03 WIB menghapus biner buildah sistem
  (lagi) — deploy pertama jalan dengan image LAMA (Fly v13, tanpa perubahan
  ini) karena `flyctl deploy --image` memakai tag latest yang sudah ada di
  registry. Buildah diinstal ulang via apt (sources azure-only, salinan
  tersimpan di ~/workspace/.apt-azure-only.sources), image dibangun ulang +
  push + deploy menjadi Fly v14 yang benar, healthz 200. Pelajaran: SELALU
  verifikasi image/tag yang ter-deploy (atau buildah tersedia) sebelum
  mengklaim deploy; `flyctl deploy --image` tanpa build baru = redeploy lama.
- Verifikasi prod: index memuat 2x Under Construction, 0x Limited Access;
  style.css tanpa badge-limited, gc-badges absolute pojok kanan atas.

# Level Chaos + Normal/Hard 4 Warna (2026-10-30, perintah Sensei)

Keputusan Sensei (5 jawaban, 30 Okt 2026):
1. Chaos pakai 5 warna (bukan ungu-only).
2. Urutan level: normal → hard → chaos → hell.
3. Aturan tumpukan chaos ikut hard (eskalasi +2→+4).
4. Tanpa extra draw2 di chaos (2 per warna × 5 warna = 10 total sudah cukup).
5. Jendela teriakan UNO! tetap ada di chaos (tanpa kartu counter).

Komposisi deck:
- normal/hard: 4 warna × 25 + wild ×4 + wild4 ×4 = **108** (ungu dihapus total:
  deck, color picker, pilihan warna bot; `playCard` menolak wildColor purple
  via `modeColors(st.mode)`).
- chaos: 5 warna × 25 + wild ×5 + wild4 ×5 + reverseBlack ×2 + nullWhite ×2,
  TANPA negate/reset, TANPA extra draw2 = **139**. Tumpukan ikut hard
  (otomatis — `isStackCard` hanya mengkhususkan normal).
- hell: tidak berubah = **159**.

Implementasi: `modeColors(mode)` di game/uno.js (diexport; dipakai bot.js,
playCard, dan helper klien `unoModeColors()`); `MODES` = normal/hard/chaos/hell;
validator `validMode` menerima chaos; opsi Chaos 🌀 di bot-mode & lobby-mode;
badge 🌀 CHAOS di header meja. Tes: test/uno_chaos.test.js (8 tes).
Status: implementasi + 195/195 tes lulus, BELUM commit/push/deploy.
