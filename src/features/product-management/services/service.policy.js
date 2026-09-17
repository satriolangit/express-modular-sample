const { db } = require("../../../libs/deps");

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

module.exports = { get, list };
