export default function extendBroken(r) {
  r.get("/", (req, res) => res.json({ ok: true }));
}
