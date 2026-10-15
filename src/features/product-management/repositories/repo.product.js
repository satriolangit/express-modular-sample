import { db } from "../../../libs/deps.js";

export default {
  async findById(id) {
    const { rows } = await db.query("SELECT * FROM products WHERE id = $1", [
      id,
    ]);
    return rows[0] ?? null;
  },
  async findAll() {
    const { rows } = await db.query("SELECT * FROM products");
    return rows;
  },
};
