export default function registerInventory(r) {
  r.get("/", (req, res) => res.json([]));
}
