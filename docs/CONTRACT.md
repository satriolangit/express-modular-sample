# CONTRACT — Aturan Komposisi base-api & extension-api

> **Bahasa Indonesia | [English](./en/CONTRACT.md)**

> **Dokumen ini menjawab:** "Aturan apa yang tidak boleh dilanggar?"
> Untuk memahami cara kerja sistem, baca [ARCHITECTURE.md](./ARCHITECTURE.md).
> Untuk tutorial langkah-demi-langkah, baca [DEVELOPER-GUIDE.md](./DEVELOPER-GUIDE.md).

**Audiens:** developer yang paham JavaScript dasar + `async/await`, baru mengenal repo ini.

Setiap bab berisi: aturan, contoh ✅, contoh ❌, dan **akibat pelanggaran**. Kontrak ini menjelaskan *mengapa* kode boleh atau tidak boleh ditulis dengan cara tertentu — baca sebelum mengubah apa pun di `src/`.

---

## Daftar Isi

1. [Module Contract](#1-module-contract)
2. [Extension Contract](#2-extension-contract)
3. [Route Merge Contract](#3-route-merge-contract)
4. [deps Contract](#4-deps-contract)
5. [WebSocket Contract](#5-websocket-contract)
6. [NATS Contract](#6-nats-contract)
7. [Scheduler Contract](#7-scheduler-contract)
8. [Package Contract](#8-package-contract)
9. [Test Contract](#9-test-contract)
10. [Error Contract](#10-error-contract)

## Ringkasan Jika Hanya Ingin Ingat 10 Hal

| # | Aturan kilat |
| --- | --- |
| 1 | Semua kode ESM (`import`/`export default`). Tidak ada `require`/`module.exports`. |
| 2 | Module = folder di `src/modules/<name>/` dengan `index.js` (`export default { prefix, init }`). |
| 3 | File route bernama `route.<group>.js`; extension bernama `route.<group>.extend.js`. |
| 4 | Jangan akses `db`/`nats`/`ws`/`scheduler` di top-level module — hanya di dalam function. |
| 5 | Jangan edit `src/extensions/` di base-api — itu hasil generate. Edit di repo extension. |
| 6 | Path WS (`/ws/...`) dan nama task scheduler harus unik dan dinamespace per module. |
| 7 | Subscribe NATS lewat pola `onConnected` + cek `isAvailable()`; jangan di top-level. |
| 8 | `package.base.json` adalah source of truth; `package.json` generated. |
| 9 | `npm run poc:copy` sebelum `npm test` (test butuh `src/extensions/`). |
| 10 | Route static (`/roles`, `/policies`) harus dievaluasi sebelum route parameter (`/:id`). |

---

## 1. Module Contract

**Tujuan:** setiap module bisa ditemukan (`discover`), di-init (`init`), dan di-mount (`mountModule`) tanpa registrasi manual di file pusat.

### Struktur wajib

```text
src/modules/<module-name>/
├── index.js                      # WAJIB — metadata module
├── routes/
│   ├── route.<group>.js          # satu file per grup route
│   └── route.<group>.js
├── services/
│   └── service.<x>.js
└── repositories/
    └── repo.<x>.js
```

### Aturan

| Aturan | Detail |
| --- | --- |
| Nama folder | Huruf kecil, dipisah `-` (`user-management`). Ini menjadi nama module dan fallback prefix (`/user-management`). |
| `index.js` | `export default { prefix, init }`. `prefix` string diawali `/`. `init(deps)` opsional, boleh async. |
| File route | Nama **harus** berformat `route.<group>.js`. `<group>` hanya boleh berisi huruf/angka/`-`. |
| Isi file route | `export default function registerUser(r) { r.get(...), r.post(...), ... }` |
| Method yang tersedia | `get`, `post`, `put`, `patch`, `delete`, `all` (huruf kecil semua) |
| Path route | Relatif terhadap prefix module. `"/"` = root prefix; `"/:id"` = parameter; `"/roles"` = static. |
| Module system | ESM murni. Tidak ada `require`, `module.exports`, `__dirname`. |
| Akses infrastruktur | Lewat `deps` param `init`, atau `import { db, logger } from "../../../libs/deps.js"` — dipakai **di dalam function**, bukan top-level. |
| Validasi | `discover()` menolak `prefix` tanpa `/`, `init` non-function, dan route file yang tidak mengekspor default function. |

### ✅ Contoh benar

```js
// src/modules/user-management/index.js
export default {
  prefix: "/users",

  async init(deps) {
    const { logger } = deps;
    logger.info("[user-management] init");
    // register WS, subscribe NATS, scheduler — lihat kontrak terkait
  },
};
```

```js
// src/modules/user-management/routes/route.user.js
import userService from "../services/service.user.js";

export default function registerUser(r) {
  r.get("/", async (req, res) => {
    res.json(await userService.listUsers());
  });
}
```

### ❌ Contoh salah

```js
// ❌ CommonJS — tidak akan dimuat sebagai ESM
module.exports = { prefix: "/users" };

// ❌ Nama file tidak dikenali discover()
//    src/modules/user-management/routes/users.js

// ❌ Prefix tanpa slash di depan
export default { prefix: "users" };

// ❌ Akses db di top-level — dievaluasi sebelum populate()
import { db } from "../../../libs/deps.js";
const pool = db.getPool();        // TypeError: Cannot read properties of null

// ❌ require di tengah kode
const uuid = require("uuid");
```

### Akibat pelanggaran

| Pelanggaran | Akibat |
| --- | --- |
| File route tidak bernama `route.<group>.js` | Route tidak pernah ditemukan; muncul 404 misterius |
| `require`/`module.exports` | Crash saat boot: `require is not defined` / module tanpa export |
| Prefix tanpa `/` | Boot crash saat `app.use()` |
| Akses deps di top-level | `TypeError` null saat boot — dan hanya muncul di module yang "beruntung" dievaluasi terlalu awal |
| Nama folder duplikat dengan folder di extension | Bukan error — tapi module dan extension dianggap satu module (gabungan). Pastikan itu memang yang diinginkan |

---

## 2. Extension Contract

**Tujuan:** extension menempel pada module inti tanpa mengubah file module tersebut, dan tetap selamat saat extension di-copy ulang.

### Dua bentuk extension

| Bentuk | Untuk apa | File kunci |
| --- | --- | --- |
| **Extend module inti** | Override/menambah route, middleware, helper pada module yang sudah ada | `route.<group>.extend.js`, `init.extend.js` |
| **Extension-only module** | Module baru yang hanya ada di klien tertentu | `index.js` + `routes/` (jangan buat `init.extend.js`) |

### Aturan

| Aturan | Detail |
| --- | --- |
| Lokasi penulisan | Selalu di repo **extension-api**. `base-api/src/extensions/` adalah hasil copy (gitignored) — perubahan di sana akan hilang. |
| Nama file route | Di root extension wajib `route.<group>.extend.js`; `discover()` menolak `route.<group>.js` di root. Extension-only module memakai subfolder `routes/route.<group>.js`. |
| Import ke libs base | `../../libs/deps.js` (dari root folder module extension); dari subfolder `routes/` atau `services/` tambah satu level: `../../../libs/deps.js` |
| Import ke kode module inti | `../../modules/<module>/services/<file>.js` — merujuk ke kode base, bukan menyalinnya |
| Init hook extension | `init.extend.js` → `export default async function initXxx(deps) {}` |
| Module system | ESM; `package.json` extension wajib `"type": "module"` |
| Dependency tambahan | Deklarasikan di `package.json` extension — akan digabung otomatis saat `merge:ext` |

### ✅ Contoh benar

```js
// extension-api/src/user-management/route.user.extend.js
import userServiceBase from "../../modules/user-management/services/service.user.js";
import mw from "./middleware.extend.js";

export default function extendUser(r) {
  // Overwrite GET /users/:id — tambah auth + logger + rate limit
  r.get("/:id", mw.auth, mw.requestLogger, mw.rateLimit, async (req, res) => {
    try {
      res.json(await userServiceBase.getUser(req.params.id));
    } catch (e) {
      res.status(404).json({ error: e.message });
    }
  });
}
```

```js
// extension-api/src/user-management/init.extend.js
export default async function initUserExt(deps) {
  const { logger } = deps;
  logger.info("[user-management.ext] init");
  // subscribe NATS / register WS — lihat kontrak masing-masing
}
```

### ❌ Contoh salah

```js
// ❌ Import memakai istilah/folder lama
import x from "../../features/user-management/services/service.user.js";

// ❌ require() di extension
const uuid = require("uuid");

// ❌ Mengedit langsung file hasil copy
//    base-api/src/extensions/user-management/route.user.extend.js

// ❌ init.extend.js di extension-only module
//    extension-api/src/audit-user/init.extend.js
```

### Akibat pelanggaran

| Pelanggaran | Akibat |
| --- | --- |
| Edit di `src/extensions/` | Hilang pada `poc:copy` berikutnya |
| Path import salah | Boot crash saat `discover()` me-load file — satu file salah, seluruh aplikasi gagal start |
| `init.extend.js` di extension-only module | `getExtInit` tetap dimuat dan dipanggil; `index.init` + `extInit` dua-duanya jalan — bingungkan dan biasanya tidak diinginkan |
| Menyalin kode module inti alih-alih import | Dua sumber kebenaran; bug fix di base tidak ikut terbawa |

---

## 3. Route Merge Contract

**Tujuan:** menggabungkan definisi route module inti dan extension secara deterministik.

### Identitas route

Sebuah route diidentifikasi oleh **`method + path`** (path relatif terhadap prefix module):

```text
GET /:id        ← route.user.js (base)
GET /:id        ← route.user.extend.js (extension)   → COCOK → di-merge
DELETE /:id     ← route.user.extend.js               → tidak ada base → route baru
GET /roles      ← route.role.js                      → tidak ada extension → apa adanya
```

### Mode merge

| Kondisi extension | Mode | Handler akhir |
| --- | --- | --- |
| Tanpa opsi (default) | `overwrite` | Handler extension (base dibuang seluruhnya) |
| `{ prepend: [...] }` | `prepend` | `prepend → middlewareBase → handlerBase` |
| `{ mergeMiddleware: true }` | `merge` | `middlewareBase → middlewareExt → handler` |
| `{ mergeMiddleware: true, keepBaseHandler: true }` | `merge+keep` | `middlewareBase → middlewareExt → handlerBase` |
| `{ prepend: [...], mergeMiddleware: true }` | `prepend+merge` | `prepend → middlewareBase → middlewareExt → handler` |
| Tidak ada pasangan base | `new` | Route extension apa adanya |

Catatan:
- "Handler" = elemen **terakhir** dari daftar handler; sisanya dianggap middleware.
- `overwrite` membuang middleware base. Kalau middleware base masih dibutuhkan, gunakan `prepend` (jangan salin ulang kodenya).
- `mergeMiddleware` tetap menganggap handler terakhir extension sebagai terminal. Jika extension hanya berisi middleware, gunakan `keepBaseHandler: true`; semua handler extension diperlakukan sebagai middleware dan handler base dipertahankan.

### Aturan urutan route

Express mencocokkan route **secara berurutan** dan berhenti di kecocokan pertama. Namun `mountModule` sekarang **mengurutkan route final secara deterministik** sebelum dipasang: static segment lebih dulu, lalu parameter, wildcard, dan method `all` paling akhir. Urutan file/group tidak menentukan hasil.

1. **Route static selalu dievaluasi sebelum route parameter** dengan segmen yang sama. `/users/roles` tidak akan tertelan `/:id`.
2. **Tetap tulis route static sebelum parameter** di file yang sama agar urutan deklarasi jelas dan mudah dibaca:

```js
// route.user.js — urutan deklarasi tetap jelas
export default function registerUser(r) {
  r.get("/roles", listRolesHandler);   // ✅ static dulu
  r.get("/:id", getUserHandler);       // parameter belakangan
}
```

3. **Test mengunci perilaku ini:** `test/routeOrder.test.js` menguji sorter secara unit dan menguji ulang dengan `fs.readdirSync` dibalik.

> Aturan praktis: saat menambah route static baru, cek route table saat boot. Urutan final sudah disortir, tetapi route table tetap bukti yang paling mudah dibaca.

4. **Duplikat `method + path` dalam satu group** → yang terakhir menang diam-diam. **Duplikat antar-group/file** → keduanya terpasang; Express memakai yang pertama cocok. Tidak ada error — karena itu tanggung jawab developer memastikan tidak ada duplikat tak sengaja.

### ✅ Contoh benar

```js
// route.product.extend.js — route baru tanpa bentrok
r.post("/policies", mw.auth, handler);
```

```js
// Override + pertahankan middleware base yang ada
r.get("/:id", { prepend: [mw.auth] });
// hasil: mw.auth → middlewareBase → handlerBase
```

### ❌ Contoh salah

```js
// ❌ Route static didaftarkan setelah parameter di group yang dievaluasi lebih dulu
r.get("/:id", getUserHandler);
r.get("/roles", listRolesHandler);   // tidak pernah tercapai untuk /users/roles

// ❌ Menyalin ulang handler base padahal hanya ingin menambah middleware
r.get("/:id", async (req, res) => { /* copy-paste isi base + tambahan */ });

// ❌ Dua file berbeda mendaftarkan "GET /" untuk prefix yang sama
```

### Akibat pelanggaran

| Pelanggaran | Akibat |
| --- | --- |
| Static route "tertelan" `/:id` | 404 aneh (`User not found` untuk path yang jelas bukan id) |
| Overwrite padahal butuh middleware base | Auth/validasi base hilang dari endpoint |
| Duplikat tak sengaja | Perilaku tergantung urutan boot; bug sulit direproduksi |

---

## 4. deps Contract

**Tujuan:** semua module berbagi satu instance infra, tanpa saling import langsung.

### Cara kerja singkat

`src/libs/deps.js` mengekspor **live binding**:

```js
export let db = null;
export function populate(values) { if ("db" in values) db = values.db; /* ... */ }
```

`index.js` memanggil `populate({ config, logger, db, nats, ws, scheduler, http })` **sebelum** `discover()`. Karena binding-nya hidup, semua module yang sudah/akan di-load otomatis melihat nilai terbaru.

### Aturan

| Aturan | Detail |
| --- | --- |
| Cara import | `import { db, logger, nats, ws, scheduler } from "../../../libs/deps.js"` (sesuaikan jumlah `../`) |
| Kapan akses | Di dalam body function (`init`, handler, service, repo). Nilai terbaca saat function **dipanggil**, saat itu deps sudah terisi. |
| Yang dilarang | Mengambil *nilai* deps di top-level module: `const pool = db.getPool()` atau `const myLogger = logger` di scope module |
| `populate()` | Hanya dipanggil di `index.js` (produksi) dan test helper. Module tidak boleh memanggil `populate()`. |
| Sebagian | `populate()` hanya mengganti key yang disertakan — aman untuk override parsial di test |

### ✅ Contoh benar

```js
import { db } from "../../../libs/deps.js";

export default {
  async findById(id) {
    const { rows } = await db.query("SELECT * FROM app_user WHERE id = $1", [id]);
    return rows[0] ?? null;
  },
};
```

```js
// service: logger dipakai saat function dipanggil
import { logger } from "../../../libs/deps.js";

async function getUser(id) {
  logger.debug("service.user.getUser", id);   // ✅ saat dipanggil, logger sudah terisi
  // ...
}
```

### ❌ Contoh salah

```js
// ❌ Dievaluasi saat import — deps mungkin belum di-populate
import { db, logger } from "../../../libs/deps.js";
const pool = db.getPool();          // TypeError: Cannot read properties of null
const log = logger;                 // null selamanya (di-copy by value)

// ❌ Module memanggil populate()
import { populate } from "../../../libs/deps.js";
populate({ db: myCustomDb });       // hanya test helper & index.js yang boleh
```

### Akibat pelanggaran

| Pelanggaran | Akibat |
| --- | --- |
| Nilai deps di-copy di top-level | `null` permanen — error hanya muncul saat runtime tertentu, sulit dilacak |
| `populate()` dari module | Urutan bootstrap rusak; module lain bisa melihat state setengah jadi |

---

## 5. WebSocket Contract

**Tujuan:** banyak module berbagi satu WebSocket server, masing-masing dengan channel sendiri.

### Aturan

| Aturan | Detail |
| --- | --- |
| Registrasi | `ws.register(path, handler, { owner })` — dari `init(deps)` module |
| Path | Unik global, konvensi `/ws/<module>` (contoh: `/ws/users`, `/ws/users-ext`, `/ws/audit`) |
| Duplikat | `register()` **throw** — dua module tidak boleh memakai path yang sama |
| Handler | `(socket, req) => {}`; panggil `socket.send(JSON.stringify(...))` untuk mengirim |
| Pesan masuk | `socket.on("message", raw => ...)` — `raw` adalah Buffer; selalu validasi JSON |
| Payload keluar | Konvensi `{ type: "...", ... }`; welcome message memakai key `module`: `{ type: "welcome", module: "user-management" }` |
| Broadcast | `ws.broadcast(path, payload)` → jumlah client terkirim; otomatis `JSON.stringify` |
| Batas | Payload maksimal 1 MB (`WS_MAX_PAYLOAD`); client tanpa `pong` di-terminate otomatis |
| Upgrade malformed | URL invalid → `400` dan socket ditutup; proses tetap hidup |
| Error | Kesalahan di dalam handler async **tidak** ditangkap otomatis — tangani sendiri (try/catch) |

### ✅ Contoh benar

```js
async init(deps) {
  const { ws, logger } = deps;

  ws.register(
    "/ws/inventory",
    (socket, req) => {
      socket.send(JSON.stringify({ type: "welcome", module: "inventory" }));

      socket.on("message", (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          socket.send(JSON.stringify({ echo: msg }));
        } catch {
          socket.send(JSON.stringify({ error: "invalid json" }));
        }
      });
    },
    { owner: "inventory-management" },
  );
}
```

### ❌ Contoh salah

```js
// ❌ Path sudah dipakai module lain — throw saat boot
ws.register("/ws/users", handler, { owner: "audit" });

// ❌ Path tanpa namespace (rawan bentrok)
ws.register("/events", handler);

// ❌ Mendaftar di top-level module — dijalankan sebelum ws.init()
ws.register("/ws/x", handler);

// ❌ Menganggap error async tertangkap otomatis
socket.on("message", async (raw) => {
  await doSomethingMayThrow(raw);    // rejection tidak terlihat di log
});
```

### Akibat pelanggaran

| Pelanggaran | Akibat |
| --- | --- |
| Path duplikat | Boot crash dengan pesan jelas (*WS path already registered*) — sengaja fail-fast |
| Registrasi di top-level | `channels` belum siap / handler terdaftar sebelum server ada |
| JSON invalid tidak divalidasi | Error di handler; koneksi bisa tertutup tanpa pesan jelas |

---

## 6. NATS Contract

**Tujuan:** komunikasi event antar-module yang tetap benar setelah reconnect.

### Aturan

| Aturan | Detail |
| --- | --- |
| Naming subject | `<entity>.<aksi>` huruf kecil: `user.created`, `user.deleted`, `audit.logged` |
| Subscribe | Selalu lewat fungsi `setup()` yang idempoten, didaftarkan ke `onConnected` + dipanggil langsung jika sudah terkoneksi |
| Publish core | `nats.publish(subject, payload)` — fire-and-forget; return `false` jika NATS tidak tersedia. Aman dipanggil kapan saja. |
| Publish JetStream | `nats.jsPublish(subject, payload)` — persisten; return `null` jika gagal. `await` hasilnya. |
| JetStream consume | `await nats.consume(stream, durableName)` → `consumer.consume()`; ack (`m.ack()`) setelah sukses, `m.nak()` saat gagal |
| Durable name | Unik per consumer: `user-management-worker`, `audit-user-worker` |
| Decode pesan JetStream | `JSON.parse(nats.get().sc.decode(m.data))` |
| JetStream opsional | Jika server NATS tidak mengaktifkan JetStream, aplikasi tetap boot; `jsPublish`/`consume` menjadi no-op/throw yang ditangani module |
| Background retry | Hanya aktif bila `NATS_AUTO_RETRY_AFTER_EXHAUST=true`; `onConnected` dipanggil lagi setelah reconnect berhasil |
| Larangan | Subscribe di top-level module; memanggil `nats.get()` tanpa cek ketersediaan |

### Pola wajib (reconnect-safe)

```js
async init(deps) {
  const { nats, logger } = deps;

  function setup() {
    if (!nats.isAvailable()) return;

    // Core NATS
    const sub = nats.subscribeJson("user.created");
    (async () => {
      for await (const { data } of sub) {
        logger.info("[inventory] user.created", data);
      }
    })().catch((err) => logger.debug("[inventory] sub ended", { error: err.message }));

    // JetStream
    (async () => {
      try {
        const consumer = await nats.consume("USERS", "inventory-worker");
        const messages = await consumer.consume();
        for await (const m of messages) {
          try {
            const data = JSON.parse(nats.get().sc.decode(m.data));
            // ... proses
            m.ack();
          } catch (err) {
            logger.error("[inventory] js handler", { error: err.message });
            m.nak();
          }
        }
      } catch (err) {
        logger.warn("[inventory] JS consumer setup failed", { error: err.message });
      }
    })();
  }

  nats.onConnected(setup);          // dipanggil lagi setiap reconnect
  if (nats.isAvailable()) setup();  // kasus bootstrap: sudah terkoneksi sejak awal
}
```

**Kenapa harus begini?** Setelah koneksi putus permanen dan background retry berhasil menyambung ulang, semua subscription lama ikut mati. `onConnected` dipanggil setiap koneksi sukses, sehingga `setup()` dipanggil ulang dan subscription dibuat kembali. `setup()` harus idempoten — membuat subscriber baru dari koneksi baru, bukan menduplikasi state.

### ✅ / ❌ Perbandingan singkat

```js
// ✅ publish aman kapan saja — no-op kalau NATS mati
nats.publish("user.created", { id: 1 });

// ❌ bisa throw "nats not available" saat degraded mode
const { nc } = nats.get();
nc.publish("user.created", "{}");
```

### Akibat pelanggaran

| Pelanggaran | Akibat |
| --- | --- |
| Subscribe tanpa cek `isAvailable()` | Error saat degraded mode; subscribe tidak pernah dibuat |
| Tidak memakai pola `onConnected` | Setelah reconnect, event berhenti diterima secara diam-diam (bug paling halus di sistem ini) |
| Durable name duplikat antar consumer | Dua consumer saling berebut pesan yang sama |
| Lupa `ack`/`nak` | Pesan di-redeliver terus-menerus |

---

## 7. Scheduler Contract

**Tujuan:** task terjadwal yang tidak saling bertabrakan dan tidak menahan shutdown.

### Aturan

| Aturan | Detail |
| --- | --- |
| Nama task | Unik **global**, konvensi `<module>:<task>` — contoh `audit-user:flush-buffer`, `global:health-check` |
| Cron | 5 field standar (`*/5 * * * *`); divalidasi saat register — expression salah = throw |
| Timezone | Default `UTC` (`SCHEDULER_TZ`); bisa di-override per task |
| Handler | Harus async-safe; scheduler menangkap error dan mencatatnya (task gagal ≠ app crash) |
| Overlap | Task yang masih berjalan saat tick berikutnya → tick di-skip (ada warning log) — desain task harus mendukung ini |
| `runOnInit` | Jalankan sekali saat `startAll()` (setelah `listen`); tidak jalan bila scheduler disabled |
| Shutdown | `stopAll({ waitMs })` menunggu task in-flight maksimal `waitMs` (default 10 dtk saat shutdown) — handler sebaiknya selesai jauh di bawah itu |

### ✅ Contoh benar

```js
async init(deps) {
  const { scheduler, logger } = deps;

  scheduler.register({
    name: "inventory:daily-report",       // namespace module
    schedule: "0 7 * * *",                // tiap hari 07:00 UTC
    owner: "inventory-management",
    handler: async () => {
      logger.info("[inventory] daily report");
      // pekerjaan...
    },
  });
}
```

### ❌ Contoh salah

```js
// ❌ Nama generik — dua module bisa bentrok
scheduler.register({ name: "cleanup", schedule: "* * * * *", handler: () => {} });

// ❌ Cron expression invalid → throw saat init → boot exit
scheduler.register({ name: "x:y", schedule: "tiap jam", handler: () => {} });

// ❌ Task berat setiap menit tanpa proteksi (akan saling skip / menumpuk)
scheduler.register({ name: "x:heavy", schedule: "* * * * *", handler: heavyWork });
```

### Akibat pelanggaran

| Pelanggaran | Akibat |
| --- | --- |
| Nama duplikat | Boot crash (`task already registered`) |
| Cron invalid | Boot crash saat module init |
| Handler menggantung | Shutdown menunggu sampai `waitMs`, lalu lanjut dengan task belum selesai |

---

## 8. Package Contract

**Tujuan:** dependency hasil gabungan base + extension selalu bisa diregenerasi, tidak ada konflik versi misterius.

### Aturan

| Aturan | Detail |
| --- | --- |
| Source of truth | `package.base.json` (base) dan `package.json` (extension). **Edit dan commit keduanya.** |
| File generated | `package.json` (base, **tidak di-track**, gitignored) dan `src/extensions/` — jangan edit manual |
| Generate | `node scripts/merge-package.js` (atau `npm run merge:ext` setelah `package.json` ada) — `--dry-run` untuk preview |
| Section yang digabung | `dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`, `overrides`, `resolutions` |
| Strategi konflik | `MERGE_STRATEGY=extension-wins` (default) \| `base-wins` \| `strict` |
| Major mismatch | Dilaporkan dengan tanda ⚠️ — extension tetap menang, tapi base bisa rusak |
| Lockfile | Dihapus otomatis saat generate (hindari lock tidak sinkron) |
| Scripts | Diambil dari base; extension tidak boleh mengubah `scripts` |

Dependency tambahan dari extension (contoh `uuid`) otomatis masuk ke `package.json` hasil merge — inilah cara extension menambahkan library tanpa menyentuh repo base.

> Pada clone baru, `package.json` belum ada. Jalankan `node scripts/copy-extensions.js` lalu `node scripts/merge-package.js` sebelum `npm install`/`npm test`.

### ✅ Alur benar

```bash
# Menambah dependency baru untuk extension:
# 1. Edit package.json di repo extension → tambahkan ke "dependencies"
# 2. Di base:
npm run merge:ext      # package.json (base) diregenerasi
npm install            # install dependency gabungan
```

### ❌ Contoh salah

```bash
# ❌ npm install uuid langsung di base tanpa deklarasi di package.base.json
#    → hilang begitu `merge:ext` dijalankan berikutnya

# ❌ Edit package.json (base) secara manual
#    → ditimpa oleh merge; source of truth-nya package.base.json
```

### Akibat pelanggaran

| Pelanggaran | Akibat |
| --- | --- |
| Install tanpa deklarasi | Dependency "hilang" setelah regenerate |
| Edit `package.json` base | Perubahan ditimpa; membingungkan ("sudah saya edit kok kembali") |
| `MERGE_STRATEGY=strict` di CI | Build gagal saat ada konflik — memang tujuannya, fail-fast |

---

## 9. Test Contract

**Tujuan:** test cepat, tanpa infrastruktur eksternal, dan tidak menumpuk state antar-file.

### Aturan

| Aturan | Detail |
| --- | --- |
| Runner | `node:test` + `node:assert/strict` — `npm test` (`node --test "test/**/*.test.js"`) |
| Prasyarat | `npm run poc:copy` dulu — test route/extension butuh `src/extensions/` (helper memberi pesan jelas jika belum) |
| Isolasi | Setiap file test dijalankan di proses terpisah oleh Node; deps di-populate per test |
| Fake deps | Gunakan `installFakeDeps()` dari `test/helpers/fakes.js` — jangan konek PG/NATS asli |
| Database | Fake db mencocokkan pola SQL; menambah query baru berarti menambah pola di `fakes.js` |
| App untuk test | `buildTestApp()` (discover + init + mount + error middleware) + `withServer()` (listen port 0 + `fetch`) |
| Browser/HTTP | Pakai `fetch` bawaan Node — tanpa library tambahan |

### ✅ Contoh test yang benar

```js
import test from "node:test";
import assert from "node:assert/strict";
import { buildTestApp, withServer } from "./helpers/buildTestApp.js";

test("GET /users mengembalikan daftar user", async () => {
  const { app } = await buildTestApp();

  await withServer(app, async (base) => {
    const res = await fetch(`${base}/users`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), [{ id: 1, name: "Alice" }]);
  });
});
```

```js
// Untuk menguji jalur error (db down):
const { app } = await buildTestApp({ db: fakeDbThrowing("db down") });
```

### ❌ Contoh salah

```js
// ❌ Import module tanpa installFakeDeps → deps masih null
const { default: repoUser } = await import("../src/modules/.../repo.user.js");
await db.query("...");               // TypeError: null

// ❌ Test yang menembak PostgreSQL/NATS asli
const pool = new pg.Pool({ host: "8.215.75.12", ... });

// ❌ Mengandalkan urutan/state antar file test
```

### Checklist saat menambah module baru

- [ ] Test di `test/` mengimpor module lewat `discover()` (buildTestApp) atau langsung dengan fake deps
- [ ] Jalankan `npm run poc:copy` sebelum `npm test`
- [ ] Jika menambah SQL baru, tambahkan pola di `fakeDb()` supaya test route bisa masuk ke jalur sukses
- [ ] Verifikasi route table yang dicetak `mountModule` sesuai harapan (terutama urutan static vs `/:id`)

---

## 10. Error Contract

**Tujuan:** setiap error punya bentuk response dan alur log yang konsisten.

### Aturan

| Kondisi | Response | Catatan |
| --- | --- | --- |
| Error tak tertangani di handler async | `500 { "error": "internal error" }` | Express 5 meneruskan rejection otomatis ke error middleware; detail + stack hanya masuk log |
| Resource tidak ditemukan | `404 { "error": "<pesan>" }` | Service melempar `NotFoundError`; route memetakan lewat `handleRouteError()`, contoh `"User not found"` |
| Input tidak valid | `400 { "error": "<pesan>" }` | Contoh: `validateBody` middleware |
| Tidak berhak | `403 { "error": "forbidden", "need": "<role>" }` | Dari `requireRole` |
| Terlalu banyak request | `429 { "error": "too many requests" }` | Dari `rateLimit` |
| Sukses | JSON body langsung | Tanpa envelope; array = array; object = object |
| Health | `200/503 { ok, degraded, uptimeSec, checks }` | `ok = checks.pg && (checks.nats \|\| !NATS_REQUIRED)`; `degraded = !checks.nats` |

Aturan tambahan:
- Domain "tidak ditemukan" dilempar sebagai `NotFoundError` dan dipetakan oleh `handleRouteError()` menjadi 404. Error lain (DB, bug) dibiarkan naik ke error middleware → `500 { "error": "internal error" }`.
- Jangan pernah mengirim `stack` atau pesan internal mentah ke client.
- Selalu log dengan konteks: `logger.error("...", { reqId, error: err.message })`.
- Jangan menelan error tanpa log (try/catch kosong).
- Express 5: **tidak perlu** wrapper `try/catch` hanya untuk menghindari request menggantung — tapi tetap gunakan `try/catch` jika ingin memetakan error domain ke status code tertentu.

### ✅ Contoh benar

```js
// Memetakan domain error ke 404
r.get("/:id", async (req, res) => {
  try {
    res.json(await userService.getUser(req.params.id));
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

// Membiarkan error tak terduga naik ke error middleware global (500 + log)
r.get("/", async (req, res) => {
  res.json(await userService.listUsers());   // error → 500 { error: "internal error" }
});
```

### ❌ Contoh salah

```js
// ❌ Menelan error
try { await danger(); } catch (e) {}

// ❌ Membocorkan detail internal
res.status(500).json({ error: err.stack, query: sql });

// ❌ throw string
throw "user not found";        // tidak punya .message; sulit di-debug

// ❌ lupa response → request menggantung (padahal tidak error)
if (!ok) { console.log("skip"); }   // tidak ada res.*
```

### Akibat pelanggaran

| Pelanggaran | Akibat |
| --- | --- |
| Membocorkan stack/SQL ke client | Kebocoran informasi |
| Menelan error | Bug tak terlihat; debugging mimpi buruk |
| Response ganda / lupa response | `ERR_HTTP_HEADERS_SENT` / request menggantung |

---

**Dokumen terkait:**
- [ARCHITECTURE.md](./ARCHITECTURE.md) — cara kerja sistem
- [DEVELOPER-GUIDE.md](./DEVELOPER-GUIDE.md) — tutorial praktik
