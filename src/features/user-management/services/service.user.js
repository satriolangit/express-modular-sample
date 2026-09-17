const userRepo = require("../repositories/repo.user");
const roleRepo = require("../repositories/repo.role");
const { logger } = require("../../../libs/deps");

async function getUser(id) {
  logger.debug("service.user.getUser", id);
  const user = await userRepo.findById(Number(id));
  if (!user) throw new Error("User not found");
  return user;
}

async function listUsers() {
  return userRepo.findAll();
}

module.exports = { getUser, listUsers };
