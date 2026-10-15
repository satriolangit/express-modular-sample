import userRepo from "../repositories/repo.user.js";
import { logger } from "../../../libs/deps.js";

async function getUser(id) {
  logger.debug("service.user.getUser", id);
  const user = await userRepo.findById(Number(id));
  if (!user) throw new Error("User not found");
  return user;
}

async function listUsers() {
  return userRepo.findAll();
}

export default { getUser, listUsers };
