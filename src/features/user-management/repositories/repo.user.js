import { db } from "../../../libs/deps.js";

export default {
  async findById(id) {
    const [row] = await db.query("SELECT * FROM app_user WHERE id = ?", [id]);
    return row ?? null;
  },
  async findAll() {
    const query = await db.query("SELECT * FROM app_user");
    return query.rows;
  },
};
