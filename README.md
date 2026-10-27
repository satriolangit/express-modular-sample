# base-api — Modular API Starter (Express 5 + ESM)

> **Bahasa Indonesia | [English](README.en.md)**

Aplikasi inti (*base*) dari arsitektur modular base + extension: satu aplikasi Express, banyak `module` fitur, dan repo `extension` terpisah untuk kustomisasi per klien. Lihat [ARCHITECTURE.md](docs/ARCHITECTURE.md) untuk gambaran lengkap.

- **Runtime:** Node.js ≥ 20.11 (disarankan 22), ESM (`"type": "module"`)
- **HTTP:** Express 5
- **Infra:** PostgreSQL (wajib), NATS + JetStream (opsional), WebSocket, node-cron
- **Test:** `node:test` + fake deps — tanpa database (4/4 hijau)
- **Status:** POC / starter — lihat [batasan](docs/ARCHITECTURE.md#9-batasan-desain-saat-ini-poc)

## Quickstart (5 menit)

```bash
# 0. Posisikan repo extension di sebelah repo ini:
#    modular-api-workspace/
#    ├── express-modular-sample/            ← repo ini
#    └── express-modular-extension-sample/

# 1. Siapkan PostgreSQL (contoh via Docker) — aplikasi menolak start tanpa ini
docker run --name pg-poc -e POSTGRES_PASSWORD=pass -e POSTGRES_DB=arsi_system_db -p 5432:5432 -d postgres:16

# 2. Sesuaikan .env (PG_HOST=localhost, PG_PASSWORD=pass, dst.)

# 3. Bootstrap — package.json is generated and not tracked
node scripts/copy-extensions.js   # salin extension → src/extensions/
node scripts/merge-package.js     # generate package.json gabungan
npm install
npm start                         # cek route table di terminal

# 4. Verifikasi
curl -s http://localhost:3000/health
curl -s http://localhost:3000/users/1
```

Ingin NATS juga? `docker run --name nats-poc -p 4222:4222 -d nats:latest -js` (tanpa NATS, aplikasi tetap jalan dalam *degraded mode*).

## Test

```bash
node scripts/copy-extensions.js   # wajib — test memakai src/extensions/
npm test                          # node --test "test/**/*.test.js"
```

## Struktur Singkat

```text
index.js                # bootstrap: config → infra → deps → discover → init → mount → listen
package.base.json       # source of truth dependencies (package.json = generated)
scripts/
  copy-extensions.js    # extension-api/src → src/extensions/
  merge-package.js      # package.base.json + extension → package.json
src/
  libs/                 # infra + mesin komposisi (db, nats, ws, scheduler, discover, mountModule)
  modules/              # module fitur (user-management, product-management)
  extensions/           # GENERATED dari repo extension (gitignored)
test/                   # node:test + fake deps
```

## Peta Dokumentasi

| Dokumen | Isi |
| --- | --- |
| [docs/DEVELOPER-GUIDE.md](docs/DEVELOPER-GUIDE.md) | **Mulai di sini jika baru.** Setup, test, 6 tutorial (module, extension, WS, NATS, scheduler) + latihan |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Cara kerja sistem: bootstrap, komposisi route, lifecycle, build pipeline, shutdown |
| [docs/CONTRACT.md](docs/CONTRACT.md) | Aturan wajib (module, extension, merge, deps, WS, NATS, package, test, error) |

## Perintah

| Perintah | Fungsi |
| --- | --- |
| `npm start` | Jalankan server |
| `npm test` | Jalankan seluruh test |
| `npm run poc:copy` | Salin extension ke `src/extensions/` |
| `npm run merge:ext` | Generate `package.json` dari `package.base.json` + extension |
| `npm run merge:ext:dry` | Preview merge tanpa menulis file |
