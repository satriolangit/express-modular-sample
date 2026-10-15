import { db } from "../../../libs/deps.js";

async function get(id) {
  const { rows } = await db.query("SELECT * FROM policies WHERE id = $1", [
    Number(id),
  ]);
  if (!rows[0]) throw new Error("Policy not found");
  return rows[0];
}

async function list() {
  const { rows } = await db.query("SELECT * FROM policies");
  return rows;
}

export default { get, list };
