import { db } from "../../../libs/deps.js";

async function get(id) {
  const [p] = await db.query("SELECT * FROM policies WHERE id = ?", [
    Number(id),
  ]);
  if (!p) throw new Error("Policy not found");
  return p;
}

async function list() {
  return db.query("SELECT * FROM policies");
}

export default { get, list };
