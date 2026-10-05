# DEPLOYMENT.md — Infrastructure & Release

> AI DILARANG deploy ke production tanpa approval eksplisit user.
> Misi Raphael: JANGAN deploy ke publik — belum ada VPS. Cukup runnable lokal.

## 1. Environments

| Env | URL | Purpose |
|---|---|---|
| Development | `http://localhost:3000` | kerja harian + testing Sensei |
| Staging | — | belum ada |
| Production | — | BELUM ADA VPS — jangan deploy |

## 2. Environment Variables

| Variable | Required | Example | Notes |
|---|---|---|---|
| `PORT` | No | `3000` | port HTTP+WS (default 3000) |

> Semua variabel di atas ada di `.env.example`. Tidak ada secret di proyek ini.

## 3. Build & Deploy Steps

```bash
npm install        # install ws (pinned)
npm test           # unit tests harus hijau
node test/simulate.js  # simulasi integrasi hijau
node server.js     # jalan di http://localhost:3000
# Deploy publik: DITUNDA sampai Sensei punya VPS (lihat rencana di bawah)
```

Rencana deploy nanti (saat VPS tersedia): satu proses `node server.js` di balik reverse proxy (nginx/Caddy) + HTTPS; jalankan via systemd/pm2; `PORT` via env.

## 4. Release Checklist

- [ ] Semua fase `TASK_INSTRUCTION.md` selesai
- [ ] Tests hijau + `node --check` bersih
- [ ] `SECURITY.md` checklist passed
- [ ] Rollback plan: karena belum deploy — N/A

## 5. AI Rules

- FORBIDDEN deploy ke production atas inisiatif sendiri.
- Jika user bilang "deploy", TANYA dulu: ke environment mana?
- Setelah deploy: verifikasi URL live + fitur utama, lalu laporkan.
