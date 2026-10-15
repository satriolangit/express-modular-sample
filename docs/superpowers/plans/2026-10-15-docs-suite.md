# Dokumentasi Suite (ARCHITECTURE, CONTRACT, DEVELOPER GUIDE) Implementation Plan

> **For agentic workers:** Plan ini dieksekusi inline di sesi yang sama (konteks kode + hasil review ada di sesi ini). Gunakan checkbox (`- [ ]`) untuk tracking.

**Goal:** Menulis dokumentasi lengkap untuk pemula — `docs/ARCHITECTURE.md`, `docs/CONTRACT.md`, `docs/DEVELOPER-GUIDE.md`, `README.md` (base + extension) — yang akurat terhadap kode branch `feature/express5-esm`, lalu menghapus `dev-guide.md` lama yang sudah stale.

**Architecture penulisan:** "Satu fakta, satu tempat" — ARCHITECTURE = konsep & alasan (naratif + mermaid), CONTRACT = aturan/invarian (tabel ✅/❌), DEVELOPER-GUIDE = tutorial langkah-demi-langkah + latihan. Dok lain hanya link.

**Tech Stack dokumen:** Markdown, diagram mermaid (render GitHub), contoh kode ESM/Express 5 yang bisa dijalankan.

## Global Constraints

- Bahasa Indonesia; istilah teknis (route, middleware, live binding, dsb.) tetap English.
- Audiens: paham JS dasar + async/await; **belum** pernah pakai Express/NATS/WebSocket.
- Semua contoh kode WAJIB cocok dengan kode aktual: ESM (`import`/`export default`), Express `^5.1.0`, folder `src/modules/`, `mountModule`, `discover()` async, deps live binding (`export let` + `populate()`), test `node:test`.
- Nama path file referensi harus nyata (cek dengan `grep`/`ls` sebelum commit).
- Mermaid: gunakan `flowchart`, `sequenceDiagram`, `stateDiagram-v2` — hindari fitur experimental.
- `docs/DEVELOPER-GUIDE.md` tiap bab praktik diakhiri "Latihan" + "Checklist".
- `dev-guide.md` dihapus **setelah** Task 3 selesai (git rm), bukan sebelumnya.
- Commit terpisah: base repo (docs + README + delete dev-guide) dan extension repo (README).

---

## File Structure

| File | Aksi | Isi |
| --- | --- | --- |
| `express-modular-sample/docs/ARCHITECTURE.md` | Create | Konsep, lifecycle, pipeline, infra, batasan POC |
| `express-modular-sample/docs/CONTRACT.md` | Create | 10 kontrak (module, extension, merge, deps, ws, nats, scheduler, package, test, error) |
| `express-modular-sample/docs/DEVELOPER-GUIDE.md` | Create | Setup, test, 6 tutorial, debugging, cheat sheet + latihan |
| `express-modular-sample/README.md` | Create | Pintu masuk: apa ini, quickstart, peta dokumen |
| `express-modular-extension-sample/README.md` | Create | Peran repo + cara dipakai + link |
| `express-modular-sample/dev-guide.md` | Delete | Konten relevan sudah diserap 3 dok baru |

---

### Task 1: `docs/ARCHITECTURE.md` (±500 baris)

**Files:**
- Create: `express-modular-sample/docs/ARCHITECTURE.md`

**Struktur bab:**
1. Apa itu base-api & extension-api (masalah: 1 produk inti + kustomisasi per klien)
2. Peta konsep: module, extension, shared libs, deps (peta istilah + diagram folder)
3. Bootstrap lifecycle (mermaid sequenceDiagram: dotenv → logger → NATS → PG → deps.populate → discover → init hooks → scheduler → mount → listen → shutdown)
4. Composition pipeline (mermaid flowchart: discovery → routeCollector → mergeRoutes 4 mode → mountModule; tabel 4 mode merge)
5. Request lifecycle (mermaid sequenceDiagram: request-id → router → service → repo → response + access log; error middleware)
6. Infra clients: db (pool/tx/insert), nats (mermaid stateDiagram reconnect + background retry), ws (channel registry/heartbeat), scheduler, logger, deps (live binding)
7. Build pipeline (mermaid flowchart: package.base.json → merge-package → copy-extensions → npm install)
8. Graceful shutdown (urutan + alasan ws.close sebelum await http close)
9. Batasan desain POC (auth hardcoded, rate limit in-memory tanpa prune, API_KEY belum dipakai, kredensial fallback di config, komposisi extension build-time, boot fail-fast)

- [ ] Tulis bab 1–3
- [ ] Tulis bab 4–6 (diagram + tabel merge mode)
- [ ] Tulis bab 7–9
- [ ] Self-review: placeholder scan; cek tiap nama simbol/path ada di kode (`grep`); cek mermaid syntax; link internal valid
- [ ] Commit (`docs: add ARCHITECTURE.md`)

---

### Task 2: `docs/CONTRACT.md` (±600 baris)

**Files:**
- Create: `express-modular-sample/docs/CONTRACT.md`

**Struktur bab (10 kontrak, tiap kontrak: aturan, contoh ✅, contoh ❌, akibat pelanggaran):**
1. Module contract: struktur folder, `route.<group>.js`, `export default (r) => {}`, `index.js { prefix, init }`
2. Extension contract: file di-copy build-time; import path `../../modules/...` & `../../libs/deps.js`; `init.extend.js` vs `index.js` (extension-only); wajib ESM
3. Route merge contract: 4 mode + presedensi; **kunci: urutan route static (`/roles`, `/policies`) harus sebelum `/:id`** — di Express 5 first-match, dan urutan mengikuti urutan file group; duplikat path+method dalam satu group = digantikan, lintas file = berisiko
4. deps contract: `populate()` sebelum `discover()`; akses di body function (bukan top-level module evaluation); live binding
5. WS contract: path unik (register throw jika duplikat), owner, payload welcome `{ type, module }`, heartbeat ≤ maxPayload
6. NATS contract: subject naming, ack/nak JetStream, pola re-subscribe `onConnected` (idempoten), degraded mode (isAvailable check)
7. Scheduler contract: nama unik + namespace `<module>:<task>`, cron valid, handler async aman
8. Package contract: `package.base.json` source of truth; `package.json` generated + gitignored; strategi merge; lockfile dihapus saat generate
9. Test contract: `npm run poc:copy` wajib sebelum `npm test`; fake deps via `populate()`; jangan panggil infra asli
10. Error contract: async error → Express 5 forward ke error middleware → JSON 500 `{ error: "internal error" }`; route tertentu mengembalikan 404/400 `{ error: message }`; response sukses = JSON body langsung

- [ ] Tulis kontrak 1–5
- [ ] Tulis kontrak 6–10
- [ ] Self-review: contoh ✅/❌ benar-benar sesuai kode saat ini; cek semua `file:line`/path; link internal
- [ ] Commit (`docs: add CONTRACT.md`)

---

### Task 3: `docs/DEVELOPER-GUIDE.md` (±1400 baris)

**Files:**
- Create: `express-modular-sample/docs/DEVELOPER-GUIDE.md`

**Struktur bab (tiap bab praktik berakhir "Latihan" + "Checklist"):**
1. Prasyarat & konsep dasar kilat (Node ≥20/22, ESM, npm, apa itu HTTP server & middleware — khusus pemula)
2. Setup & jalankan dari nol: clone kedua repo → `.env` → `npm run poc:copy` → `npm run merge:ext` → `npm install` → `npm start` → verifikasi `/health`; diagram mermaid urutan perintah + penjelasan tiap script
3. Test: `npm test`, anatomi test (fakes, buildTestApp, withServer), membaca output TAP
4. Tutorial A — membuat module baru dari nol: `src/modules/inventory-management/` (index.js, routes/route.inventory.js, services, repositories) + verifikasi manual & test
5. Tutorial B — menambah route/service/repository di module yang ada (contoh GET /products/:id/policies)
6. Tutorial C — membuat extension: overwrite, prepend, mergeMiddleware, route baru, extension-only module; langkah `poc:copy` + `merge:ext`
7. Tutorial D — WebSocket: register path, welcome, echo, broadcast; cara tes dengan `wscat`/script kecil
8. Tutorial E — NATS: publish, subscribeJson, JetStream consume + ack/nak, pola reconnect-safe
9. Tutorial F — scheduled task: register, namespace, runOnInit, verifikasi log
10. Debugging & troubleshooting: log access, request-id, health check, error umum (EADDRINUSE, PG unreachable, WS path duplikat, dst.)
11. Cheat sheet perintah + tabel "mau melakukan X → buka bab Y" + daftar latihan mandiri

- [ ] Tulis bab 1–3
- [ ] Tulis Tutorial A–C
- [ ] Tulis Tutorial D–F
- [ ] Tulis bab 10–11
- [ ] Self-review: tiap perintah dieksekusi/divalidasi; kode contoh konsisten dengan CONTRACT; latihan punya solusi/arah jawaban singkat
- [ ] Commit (`docs: add DEVELOPER-GUIDE.md`)

---

### Task 4: README (kedua repo) + hapus `dev-guide.md`

**Files:**
- Create: `express-modular-sample/README.md`
- Create: `express-modular-extension-sample/README.md`
- Delete: `express-modular-sample/dev-guide.md` (via `git rm`)

**Konten README base:** 1 paragraf produk, fitur kunci, quickstart 5 menit (copy-paste), struktur folder ringkas, peta dokumen (link ke 3 dok), prasyarat (Node 22+, PG, NATS opsional), status POC.
**Konten README extension:** peran repo (daemon kustomisasi, bukan app standalone), cara dipakai (di-copy oleh `poc:copy`), struktur src, requirement `type: module`, link ke dok base.

- [ ] Tulis README base + README extension
- [ ] `git rm dev-guide.md`
- [ ] Verifikasi tidak ada lagi referensi ke `dev-guide.md` di source/README (`grep`)
- [ ] Commit (`docs: add READMEs, retire stale dev-guide.md`)

---

### Task 5: Verifikasi menyeluruh + commit extension repo

- [ ] Jalankan ulang semua perintah di quickstart DEVELOPER-GUIDE: `npm run poc:copy && npm run merge:ext && npm install && npm test` (harus sukses, 4/4 pass)
- [ ] Cek konsistensi lintas dokumen: `grep -n "ARCHITECTURE\|CONTRACT\|DEVELOPER-GUIDE"` — semua link menunjuk file yang ada
- [ ] Cek tidak ada placeholder (`TBD`, `TODO`, `xxx`, `nanti`) di docs
- [ ] Cek istilah: tidak ada "feature" (kecuali catatan historis), tidak ada `require(`/Express 4 di contoh kode
- [ ] Commit extension repo README (`docs: add README`)
- [ ] Laporkan ringkasan + status branch (tidak merge tanpa instruksi user)

---

## Self-Review (dijalankan saat plan dibuat)

- **Spec coverage:** 5 klarifikasi user (bahasa, penggantian dev-guide, audiens, lokasi, gaya mermaid+latihan) → tercermin di Global Constraints + struktur task. ✅
- **Placeholder scan:** tidak ada task tanpa deliverable konkret; konten bab didefinisikan per bab. ✅
- **Konsistensi:** nama file/path konsisten (`docs/ARCHITECTURE.md` dst.); urutan task memastikan `dev-guide.md` dihapus hanya setelah 3 dok selesai. ✅
