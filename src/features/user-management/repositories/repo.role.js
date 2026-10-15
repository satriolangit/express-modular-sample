import { db } from "../../../libs/deps.js";

export default {
  async findByUserId(userId) {
    const { rows } = await db.query(
      `select * 
from app_user_role aur  left join app_role ar on aur.role_id = ar.id
where aur.user_id = $1`,
      [userId],
    );
    return rows;
  },
  async findAll() {
    const { rows } = await db.query("select * from app_role");
    return rows;
  },
};
