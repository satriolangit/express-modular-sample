import { db } from "../../../libs/deps.js";

export default {
  async findById(id) {
    const [row] = await db.query("SELECT * FROM products WHERE id = ?", [id]);
    return row ?? null;
  },
  async findAll() {
    return db.query("SELECT * FROM products");
  },
};
