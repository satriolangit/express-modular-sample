const { db } = require("../../../libs/deps");

module.exports = {
  async findById(id) {
    const [row] = await db.query("SELECT * FROM products WHERE id = ?", [id]);
    return row ?? null;
  },
  async findAll() {
    return db.query("SELECT * FROM products");
  },
};
