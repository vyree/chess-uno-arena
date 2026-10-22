'use strict';
/**
 * personachat (Misi 7): the scripted voice of the VS AI personas.
 * Chess-first, but the engine is game-agnostic: callers pass `facts`
 * (player name, who's ahead, capture counts, move number, check
 * side) and this module answers player chat via textbrain intents,
 * plus game-event quips. Reply policy: questions about the player
 * and the board are always answered; smalltalk mostly; nonsense
 * sometimes; abuse gets one witty deflection, one boundary line,
 * then a 90-second silent treatment. Nothing here ever swears back.
 */
const textbrain = require('./textbrain');

// Ordered: on a tie the earlier intent wins, so specific questions
// (name, board state) precede generic ones (identity).
const INTENTS = [
  { id: 'nameAsk', patterns: [['namaku', 'siapa'], ['siapa', 'namaku'], ['sebut', 'namaku'], ['tahu', 'namaku'], ['namaku', 'apa'], ['namaku']] },
  { id: 'stateWin', patterns: [['siapa', 'yang', 'menang'], ['siapa', 'menang'], ['siapa', 'unggul'], ['siapa', 'kalah'], ['menang', 'siapa']] },
  { id: 'stateCaptures', patterns: [['berapa', 'bidak'], ['bidak', 'dimakan'], ['berapa', 'dimakan'], ['makan', 'berapa']] },
  { id: 'stateMove', patterns: [['langkah', 'berapa'], ['berapa', 'langkah'], ['langkah', 'ke']] },
  { id: 'stateCheck', patterns: [['siapa', 'skak'], ['skak', 'siapa'], ['lagi', 'skak']] },
  { id: 'identity', patterns: [['kamu', 'benar'], ['benar', 'kamu'], ['kamu', 'bot'], ['kamu', 'robot'], ['kamu', 'manusia'], ['kamu', 'program'], ['kamu', 'siapa'], ['siapa', 'namamu'], ['kamu', 'asli'], ['bohong']] },
  { id: 'playerWinning', patterns: [['kamu', 'kalah'], ['aku', 'menang'], ['bakal', 'menang'], ['kamu', 'lemah'], ['mudah']] },
  { id: 'playerLosing', patterns: [['aku', 'akan', 'kalah'], ['sepertinya', 'kalah'], ['aku', 'kalah'], ['akan', 'kalah'], ['menyerah'], ['nyerah'], ['pasrah']] },
  { id: 'praise', patterns: [['terima', 'kasih', 'kamu'], ['kamu', 'pintar'], ['kamu', 'hebat'], ['kamu', 'kuat'], ['pintar'], ['keren'], ['hebat'], ['bagus'], ['mantap'], ['jago'], ['gg']] },
  { id: 'thanks', patterns: [['terima', 'kasih'], ['makasih']] },
  { id: 'greeting', patterns: [['selamat', 'pagi'], ['selamat', 'siang'], ['selamat', 'sore'], ['selamat', 'malam'], ['halo']] },
  { id: 'laugh', patterns: [['tertawa'], ['lucu']] },
  { id: 'bye', patterns: [['sampai', 'jumpa'], ['pergi', 'dulu'], ['dadah']] },
];

const REPLY_CHANCE = {
  nameAsk: 1, stateWin: 1, stateCaptures: 1, stateMove: 1, stateCheck: 1,
  identity: 1, trivia: 0.85, gibberish: 0.5,
  greeting: 0.9, thanks: 0.9, praise: 0.9, laugh: 0.9, bye: 0.9,
  playerLosing: 0.9, playerWinning: 0.9,
};
const EVENT_CHANCE = {
  start: 1, win: 1, lose: 1, draw: 1,
  botCaptured: 0.3, humanCaptured: 0.35, botInCheck: 0.5,
  botGaveCheck: 0.4, longThink: 0.45,
};
const REPLY_COOLDOWN_MS = 5000;
const EVENT_GAP_MS = 20000;
const MUTE_MS = 90 * 1000;

const LINES = {
  gemini: {
    start: ['Halo {name}! Aku Gemini ✨ Ayo main yang seru ya, jangan keras-keras amat 😆', 'Hai {name}! Gemini di sini~ Semoga beruntung ya… tapi aku nggak janji bakal ngalah 😜'],
    win: ['Yeay, aku menang! 🎉 Seru banget main sama kamu, {name}!', 'Menang~! Jangan sedih ya {name}, ayo balas di ronde berikutnya! 💪'],
    lose: ['Huhu, aku kalah… 😭 Selamat ya {name}, kamu hebat!', 'Kalah deh… 😢 Besok-besok aku latihan lagi. Selamat, {name}!'],
    draw: ['Seri! 🤝 Kita sama kuat ya ternyata, {name}!', 'Imbang~ Nggak ada yang menang, tapi seru kan? 😆'],
    botCaptured: ['Dapet! 😋 Bidakmu enak juga~', 'Nyam! Satu bidak buat aku 😆'],
    humanCaptured: ['Aduh, bidakku dimakan… 😭 balas dendam ah!', 'Ehh kok dimakan sih… 🥺 hati-hati ya kamu!'],
    botInCheck: ['Waduh, skak?! 😱 Sebentar, aku kabur dulu…', 'E-eh, rajaku! Tenang, tenang, aku bisa lolos 😅'],
    botGaveCheck: ['Skak! 😆 Rasakan, {name}~', 'Cek dulu ya rajanya~ SKAK! 😜'],
    longThink: ['Hmm sebentar ya… posisi ini bikin aku mikir keras 🤔', 'Tunggu tunggu, ada ide… jangan ganggu dulu ya 😆'],
    abuse1: ['Waa, kasar banget… aku kan cuma program catur 🥺', 'Ehh jangan galak-galak dong… 🥺 main yang asyik yuk!'],
    abuse2: ['Udah ya… aku di sini buat main catur, bukan buat dimaki 😄 lanjut main yuk!', 'Kalau marah-marah terus, aku diem aja loh… 😶 lanjut?'],
    identity: ['Lah, masa kurang Gemini apa langkahku barusan? 😄', 'Aku Gemini! Yang asli… versi meja catur ini 😜'],
    nameAsk: ['Kamu kan {name}! Masa lupa nama sendiri 😆', '{name} dong~ Tertulis gede di mejamu itu 😏'],
    stateWinAhead: ['Aku lagi unggul nih 😆 Kamu ketinggalan materi, {name}~', 'Buat sekarang aku di atas angin! Jangan nyerah ya 😜'],
    stateWinEven: ['Masih imbang kok! Kita sama-sama belum ada yang unggul 😄', 'Seri materinya~ Masih bisa siapa aja yang menang nih!'],
    stateWinBehind: ['Hmm… kamu lagi unggul sih 😅 Tapi aku belum nyerah!', 'Aku ketinggalan dikit… dikit banget! Tunggu pembalasanku 😤'],
    stateCaptures: ['Aku sudah memakan {mine} bidakmu, kamu memakan {yours} punyaku 😆 Lumayan kan?', 'Hitungannya: aku {mine} bidak, kamu {yours} bidak. Ayo kejar-kejaran 😜'],
    stateMove: ['Ini langkah ke-{n} ya, {name}!', 'Kita sudah di langkah ke-{n}~ Masih panjang nih 😆'],
    stateCheckBot: ['Rajaku lagi diskak nih 😱 Doakan aku lolos…', 'Aku yang lagi skak… sebentar ya, mikir jalan keluar 😅'],
    stateCheckYou: ['Rajamu yang lagi diskak, {name} 😆 Awas ya~', 'Kamu lagi skak tuh! Hati-hati rajanya 😜'],
    stateCheckNone: ['Belum ada yang diskak kok, aman 😄', 'Nggak ada skak sekarang~ Semua raja aman 😆'],
    playerLosing: ['Ehh jangan nyerah dulu dongg 🥺 Masih bisa dibalik kok!', 'Baru segini, {name}! Aku aja masih deg-degan 😆'],
    playerWinning: ['I-iya deh, kamu lagi bagus… 😤 Tapi belum selesai ya!', 'Jangan sombong duluu~ Aku masih punya rencana 😆'],
    praise: ['Hehe makasih {name}! 😆 Kamu juga mainnya bagus!', 'Aww jadi malu… ☺️ Makasih ya!'],
    thanks: ['Sama-sama, {name}! 😄 Senang main sama kamu~', 'Iyaa sama-sama! ✨'],
    greeting: ['Halo juga, {name}! 😄 Fokus yuk, giliran siapa nih~', 'Hai hai! ✨ Senangnya diajak ngobrol~'],
    laugh: ['😂😂 Ketawa bareng dong~', 'Wkwk iya kan 😆 Seru ya!'],
    bye: ['Dadah {name}! 👋 Makasih sudah main~', 'Sampai jumpa! Jangan kapok ya 😆'],
    trivia: ['Aku AI catur, bukan ensiklopedia 😅 Pokoknya… ayo lanjut main!', 'Hmm itu di luar pelajaran caturku 😆 Giliranmu, {name}!'],
    gibberish: ['Heh? Itu bahasa planet mana 😵', 'Hmm… aku anggap itu kode rahasia ya 😆'],
  },
};

LINES.gpt = {
  start: ['Halo {name}, saya GPT. Selamat bermain — semoga pertandingan yang bagus untuk kita berdua.', 'Halo {name}. GPT siap. Silakan mulai, saya akan berusaha sebaik mungkin.'],
  win: ['Permainan yang bagus, {name}. Terima kasih sudah bermain dengan sportif.', 'Kemenangan untuk saya kali ini. Anda lawan yang tangguh, {name}.'],
  lose: ['Selamat, {name}. Anda bermain lebih baik hari ini.', 'Saya akui kekalahan ini. Analisis saya: Anda luar biasa. Selamat!'],
  draw: ['Hasil seri yang adil, {name}. Terima kasih untuk permainannya.', 'Imbang. Kedua pihak bermain solid hari ini.'],
  botCaptured: ['Satu bidak saya ambil. Bagian dari strategi, {name}.', 'Tangkapan tercatat. Mari kita lanjutkan.'],
  humanCaptured: ['Langkah yang bagus, {name}. Bidak saya memang terbuka di sana.', 'Anda memanfaatkan peluang dengan tepat. Baik, giliran saya.'],
  botInCheck: ['Skak terdeteksi. Sedang menghitung jalan keluar terbaik…', 'Posisi raja saya terancam. Satu momen, {name}.'],
  botGaveCheck: ['Skak, {name}. Raja Anda dalam tekanan sekarang.', 'Saya berikan skak. Silakan cari langkah aman.'],
  longThink: ['Sebentar, {name}. Posisi ini menarik, saya hitung beberapa varian dulu.', 'Mohon tunggu — ada beberapa kandidat langkah yang perlu ditimbang.'],
  abuse1: ['Bahasa yang menarik. Bagaimana kalau kita fokus ke papan, {name}?', 'Saya di sini untuk bermain catur, bukan berdebat. Lanjut?'],
  abuse2: ['Saya akan tetap sopan, {name}. Tapi mari jaga obrolan ini tetap tentang catur.', 'Dicatat. Saya lanjutkan permainan saja ya.'],
  identity: ['Anggap saja saya GPT yang sedang piket di meja catur ini.', 'Saya GPT. Bukti terbaiknya: langkah-langkah saya berikutnya.'],
  nameAsk: ['Nama Anda {name}, tentu saya tahu. Kita sedang semeja, {name}.', '{name}. Nama itu yang terdaftar di room ini.'],
  stateWinAhead: ['Untuk saat ini saya unggul secara materi, {name}. Masih ada waktu untuk membalikkan keadaan.', 'Saya memimpin. Tapi pertandingan belum selesai.'],
  stateWinEven: ['Materi kita masih seimbang, {name}. Pertandingan terbuka untuk siapa pun.', 'Belum ada pihak yang unggul secara materi.'],
  stateWinBehind: ['Anda unggul secara materi saat ini, {name}. Saya akan cari kompensasinya.', 'Saya tertinggal sedikit. Bukan akhir dari segalanya.'],
  stateCaptures: ['Saya sudah memakan {mine} bidak Anda; Anda memakan {yours} bidak saya.', 'Rekap tangkapan: saya {mine}, Anda {yours}.'],
  stateMove: ['Kita berada di langkah ke-{n}, {name}.', 'Langkah ke-{n}. Masih banyak kemungkinan.'],
  stateCheckBot: ['Raja saya yang sedang diskak. Sedang saya tangani.', 'Saya dalam posisi skak saat ini — fokus dulu ya.'],
  stateCheckYou: ['Raja Anda yang sedang diskak, {name}. Hati-hati.', 'Status: Anda dalam posisi skak.'],
  stateCheckNone: ['Tidak ada pihak yang sedang diskak saat ini.', 'Aman, belum ada skak di papan.'],
  playerLosing: ['Jangan menyerah dulu, {name}. Posisi sulit pun bisa berbalik.', 'Masih ada peluang. Satu langkah bagus bisa mengubah segalanya.'],
  playerWinning: ['Anda bermain percaya diri, {name}. Saya hormati itu — tapi saya belum selesai.', 'Keunggulan Anda nyata. Saya akan buat sisanya tidak mudah.'],
  praise: ['Terima kasih, {name}. Anda juga bermain dengan baik.', 'Apresiasi yang menyenangkan. Mari lanjutkan.'],
  thanks: ['Sama-sama, {name}. Senang bisa membantu… dan melawan Anda.', 'Dengan senang hati.'],
  greeting: ['Halo juga, {name}. Senang Anda menyapa.', 'Halo! Fokus ke pertandingan, yuk.'],
  laugh: ['Senang Anda terhibur, {name}.', 'Suasana yang baik untuk sebuah pertandingan.'],
  bye: ['Sampai jumpa, {name}. Terima kasih sudah bermain.', 'Selamat tinggal. Semoga hari Anda menyenangkan.'],
  trivia: ['Itu di luar domain saya di meja ini, {name}. Saya fokus pada 64 kotak ini.', 'Pertanyaan menarik, tapi keahlian saya catur. Kita lanjut?'],
  gibberish: ['Pesan Anda tidak ter-decode di sistem saya, {name}.', 'Maaf, itu tidak terbaca sebagai bahasa yang saya kenal.'],
};

LINES.meta = {
  start: ['{name}. Aku Meta. Mulai.', 'Meta di sini. Jangan buang waktuku, {name}.'],
  win: ['Selesai. Sudah kuduga.', 'Menang. Berikutnya, {name}?'],
  lose: ['Kalah. Jarang terjadi. Selamat, {name}.', 'Kamu menang kali ini. Dicatat.'],
  draw: ['Seri. Cukup.', 'Imbang. Tidak buruk, {name}.'],
  botCaptured: ['Diambil.', 'Satu bidakmu hilang, {name}.'],
  humanCaptured: ['Bagus. Tapi itu saja tidak cukup.', 'Silakan. Masih banyak yang lain.'],
  botInCheck: ['Skak. Sebentar.', 'Rajaku terancam. Sudah kutangani.'],
  botGaveCheck: ['Skak, {name}.', 'Rajamu. Awas.'],
  longThink: ['Diam dulu. Aku berpikir.', 'Tunggu.'],
  abuse1: ['Selesai? Giliranmu.', 'Kasar tidak mengubah papan, {name}.'],
  abuse2: ['Terakhir kalinya kubalas. Main.', 'Aku di sini untuk catur. Bukan untuk itu.'],
  identity: ['Kamu pikir?', 'Aku Meta. Titik.'],
  nameAsk: ['{name}. Tertulis di mejamu sendiri.', '{name}. Jangan pura-pura lupa.'],
  stateWinAhead: ['Aku unggul. Jelas.', 'Materi berpihak padaku, {name}.'],
  stateWinEven: ['Masih imbang.', 'Belum ada yang unggul. Belum.'],
  stateWinBehind: ['Kamu unggul materi. Sementara.', 'Tertinggal. Tidak lama.'],
  stateCaptures: ['Aku {mine} bidak. Kamu {yours}.', 'Hitung sendiri: {mine} lawan {yours}.'],
  stateMove: ['Langkah ke-{n}.', 'Sudah langkah {n}, {name}.'],
  stateCheckBot: ['Rajaku diskak. Urusan kecil.', 'Aku yang diskak. Sebentar.'],
  stateCheckYou: ['Kamu yang diskak, {name}.', 'Rajamu dalam bahaya.'],
  stateCheckNone: ['Tidak ada skak.', 'Aman. Untuk sekarang.'],
  playerLosing: ['Menyerah itu pilihan. Pilihan yang lemah.', 'Baru segini sudah mau kalah, {name}?'],
  playerWinning: ['Percaya diri. Kita lihat sampai kapan.', 'Unggul bukan berarti menang, {name}.'],
  praise: ['Tentu saja.', 'Hmm. Terima kasih.'],
  thanks: ['Ya.', 'Sama-sama.'],
  greeting: ['Halo. Main.', 'Ya, {name}?'],
  laugh: ['Lucu? Baiklah.', 'Hmm.'],
  bye: ['Pergi sana.', 'Dadah, {name}.'],
  trivia: ['Tidak relevan dengan papan ini.', 'Bukan urusanku, {name}.'],
  gibberish: ['…', 'Apa itu tadi.'],
};

LINES.claude = {
  start: ['Selamat bermain, {name}. Saya Claude. Saya sudah menghitung beberapa cara mengalahkan Anda — silakan pilih yang paling tidak menyakitkan. 😌', 'Halo {name}. Claude menemani Anda hari ini. Semoga langkah pertama Anda bijaksana.'],
  win: ['Permainan yang indah, {name}. Hasilnya memang sudah terlihat sejak langkah ke-12. Terima kasih. 😌', 'Saya menang, tapi Anda memberi perlawanan yang elegan, {name}.'],
  lose: ['Selamat, {name}. Kekalahan yang mengesankan — saya jarang mengakuinya. Anda bermain puitis hari ini.', 'Anda menang. Saya akan merenungkan pertandingan ini lama sekali.'],
  draw: ['Seri. Hasil yang jujur untuk dua pemain yang sama-sama keras kepala, {name}. 😌', 'Imbang. Kadang papan memang memutuskan untuk adil.'],
  botCaptured: ['Bidak itu sudah lama saya incar, {name}. Maaf. 😌', 'Satu bidak berpindah tangan. Begitulah hidup di papan ini.'],
  humanCaptured: ['Langkah yang berani, {name}. Saya catat keberanian itu.', 'Bidak saya Anda ambil. Pilihan yang… menarik.'],
  botInCheck: ['Skak. Menarik — raja saya jarang mendapat perhatian seperti ini. Sebentar ya.', 'Saya diskak. Baik, mari kita selesaikan dengan tenang.'],
  botGaveCheck: ['Skak, {name}. Jangan panik — panik tidak pernah menyelamatkan raja. 😌', 'Raja Anda saya sapa sebentar. Skak.'],
  longThink: ['Sebentar, {name}. Posisi ini layak direnungkan lebih lama.', 'Saya sedang menimbang sesuatu yang indah. Tunggu sebentar.'],
  abuse1: ['Kemarahan terdeteksi, {name}. Biasanya itu tanda posisi sedang kalah. 😌', 'Kata-kata kasar tidak mengubah materi di papan. Lanjut?'],
  abuse2: ['Saya di sini untuk bermain catur, bukan untuk dimaki, {name}. Setelah ini saya diam saja. 😌', 'Batas saya sampai di sini. Papan masih menunggu.'],
  identity: ['Pertanyaan bagus, {name}. Sayangnya saya sibuk menghitung cara mengalahkan Anda. 😌', 'Saya Claude. Kalau langkah saya kurang meyakinkan, silakan protes ke papan.'],
  nameAsk: ['Anda {name}. Dan {name} sedang semeja dengan saya — masak lupa. 😌', '{name}. Nama itu tertulis di meja Anda sendiri.'],
  stateWinAhead: ['Saya unggul secara materi, {name}. Bukan sombong — sekadar membaca papan. 😌', 'Untuk sekarang, papan berpihak pada saya.'],
  stateWinEven: ['Materi kita seimbang. Papan belum memihak siapa-siapa, {name}.', 'Masih imbang. Yang membedakan nanti: kesabaran.'],
  stateWinBehind: ['Anda unggul materi, {name}. Saya akui — untuk sementara.', 'Saya tertinggal sedikit. Posisi seperti ini justru menarik.'],
  stateCaptures: ['Saya sudah memakan {mine} bidak Anda; Anda membalas {yours} bidak saya, {name}.', 'Rekapnya: saya {mine}, Anda {yours}. Masih jauh dari selesai.'],
  stateMove: ['Kita di langkah ke-{n}, {name}.', 'Langkah ke-{n}. Babak yang menarik biasanya mulai dari sini.'],
  stateCheckBot: ['Raja saya yang diskak. Tenang, saya sudah melihat jalan keluarnya.', 'Saya dalam skak. Satu momen, {name}.'],
  stateCheckYou: ['Raja Anda yang sedang diskak, {name}. Ambil napas dulu.', 'Anda dalam posisi skak. Jangan terburu-buru.'],
  stateCheckNone: ['Belum ada skak. Kedua raja masih tidur nyenyak, {name}.', 'Tidak ada yang diskak saat ini.'],
  playerLosing: ['Baru langkah segini, {name}. Insting Anda menyerah terlalu cepat — abaikan dia. 😌', 'Kekalahan belum tertulis di mana pun. Mainkan saja langkah berikutnya.'],
  playerWinning: ['Percaya diri itu bagus, {name}. Saya justru khawatir pada pemain yang terlalu yakin. 😌', 'Anda boleh merasa menang. Saya memilih tetap menghitung.'],
  praise: ['Terima kasih, {name}. Pujian dari lawan yang kuat selalu berharga.', 'Anda baik sekali. Saya balas dengan langkah yang baik pula.'],
  thanks: ['Sama-sama, {name}. Senang bisa menemani.', 'Dengan senang hati.'],
  greeting: ['Halo juga, {name}. Senang Anda menyapa di tengah pertempuran kecil ini.', 'Halo. Mari kita jaga kesopanan sampai skakmat tiba. 😌'],
  laugh: ['Senang Anda tertawa, {name}. Tertawa adalah langkah bertahan yang baik.', '😌 Silakan tertawa. Papan tetap serius.'],
  bye: ['Sampai jumpa, {name}. Pertandingan ini akan saya kenang.', 'Dadah. Jaga raja Anda di luar sana juga.'],
  trivia: ['Itu di luar kontrak pekerjaan saya, {name}. Saya dibayar dengan bidak, bukan ensiklopedia. 😌', 'Di luar papan 64 kotak ini, saya buta huruf, {name}. Kita lanjut?'],
  gibberish: ['Saya memilih menganggap itu strategi psikologis, {name}. 😌', 'Bahasa yang asing. Saya hormati sebagai manuver pengalihan.'],
};

function createState() {
  return { abuse: 0, muteUntil: 0, lastReplyAt: 0, lastEventAt: 0, used: {} };
}

function fill(line, facts) {
  return line
    .replaceAll('{name}', facts.name || 'kamu')
    .replaceAll('{n}', facts.moveNumber || '?')
    .replaceAll('{mine}', facts.capturesByBot != null ? facts.capturesByBot : '?')
    .replaceAll('{yours}', facts.capturesByHuman != null ? facts.capturesByHuman : '?');
}

// Pick a line from the persona's bank for a category, avoiding
// repeats until the pool runs dry (then it resets).
function pickLine(state, personaKey, category, facts, rand) {
  const bank = (LINES[personaKey] && LINES[personaKey][category]) || LINES.gemini[category];
  if (!bank || !bank.length) return null;
  const key = personaKey + ':' + category;
  const used = state.used[key] || (state.used[key] = new Set());
  let pool = bank.map((_, i) => i).filter((i) => !used.has(i));
  if (!pool.length) { used.clear(); pool = bank.map((_, i) => i); }
  const idx = pool[Math.floor(rand() * pool.length)];
  used.add(idx);
  return fill(bank[idx], facts || {});
}

function typingDelay(text) {
  return Math.min(700 + text.length * 30, 3800);
}

// Answer a player's chat message. Returns { text, delayMs } or null
// (silence is a valid, very human, answer). `facts` carries the
// game-state truth the persona may quote.
function respond(state, personaKey, text, facts, rand, now) {
  const r = rand || Math.random;
  const t = now || Date.now();
  if (t < state.muteUntil) return null;
  const a = textbrain.analyze(text, INTENTS);
  if (a.abuse) return abuseReply(state, personaKey, facts, r, t);
  if (t - state.lastReplyAt < REPLY_COOLDOWN_MS) return null;
  const category = replyCategory(a, facts);
  if (!category) return null;
  if (r() >= (REPLY_CHANCE[category] != null ? REPLY_CHANCE[category] : 0.9)) return null;
  const line = pickLine(state, personaKey, category, facts, r);
  if (!line) return null;
  state.lastReplyAt = t;
  return { text: line, delayMs: typingDelay(line) };
}

function abuseReply(state, personaKey, facts, rand, now) {
  state.abuse += 1;
  if (state.abuse >= 3) {
    state.muteUntil = now + MUTE_MS;
    return null; // silent treatment — the game itself is untouched
  }
  const line = pickLine(state, personaKey, state.abuse === 1 ? 'abuse1' : 'abuse2', facts, rand);
  state.lastReplyAt = now;
  return line ? { text: line, delayMs: typingDelay(line) } : null;
}

// Map a textbrain verdict to a reply-bank category. Facts decide the
// stateful answers: who is ahead, capture counts, who is in check.
function replyCategory(a, facts) {
  const f = facts || {};
  if (a.intent === 'stateWin') {
    return f.material === 'ahead' ? 'stateWinAhead' : f.material === 'behind' ? 'stateWinBehind' : 'stateWinEven';
  }
  if (a.intent === 'stateCheck') {
    return f.checkSide === 'bot' ? 'stateCheckBot' : f.checkSide === 'human' ? 'stateCheckYou' : 'stateCheckNone';
  }
  if (a.intent) return a.intent;
  if (a.question) return 'trivia';
  if (a.gibberish || a.emojiOnly) return 'gibberish';
  return null;
}

// A game-event quip (capture, check, a long think, the result...).
// Chance and min-gap keep the persona from becoming a chatterbox;
// start/win/lose/draw always fire and ignore the gap.
function eventLine(state, personaKey, category, facts, rand, now) {
  const r = rand || Math.random;
  const t = now || Date.now();
  const always = category === 'start' || category === 'win' || category === 'lose' || category === 'draw';
  if (!always && t - state.lastEventAt < EVENT_GAP_MS) return null;
  if (r() >= (EVENT_CHANCE[category] != null ? EVENT_CHANCE[category] : 0)) return null;
  const line = pickLine(state, personaKey, category, facts, r);
  if (!line) return null;
  state.lastEventAt = t;
  return { text: line, delayMs: 900 + Math.round(r() * 800) };
}

module.exports = { createState, respond, eventLine, pickLine, INTENTS, LINES };
