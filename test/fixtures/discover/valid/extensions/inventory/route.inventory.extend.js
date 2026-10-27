export default function extendInventory(r) {
  r.get("/extra", (req, res) => res.json({ ok: true }));
}
