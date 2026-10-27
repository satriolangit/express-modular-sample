import userRepo from "../repositories/repo.user.js";
import { logger } from "../../../libs/deps.js";
import { NotFoundError } from "../../../libs/errors.js";

async function getUser(id) {
  logger.debug("service.user.getUser", id);
  const user = await userRepo.findById(Number(id));
  if (!user) throw new NotFoundError("User not found");
  return user;
}

async function listUsers() {
  return userRepo.findAll();
}

export default { getUser, listUsers };
