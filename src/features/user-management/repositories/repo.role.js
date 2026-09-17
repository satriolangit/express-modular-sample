const { db } = require("../../../libs/deps");

module.exports = {
  async findByUserId(userId) {
    return db.query("SELECT * FROM roles WHERE user_id = ?", [userId]);
  },
  async findAll() {
    return db.query("SELECT * FROM roles");
  },
};
