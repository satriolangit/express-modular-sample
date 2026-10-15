import { db } from "../../../libs/deps.js";

export default {
  async findByUserId(userId) {
    return db.query(
      `select * 
from app_user_role aur  left join app_role ar on aur.role_id = ar.id
where aur.user_id = ?`,
      [userId],
    );
  },
  async findAll() {
    return db.query("select * from app_role;");
  },
};
