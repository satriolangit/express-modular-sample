const roleRepo = require("../repositories/repo.role");

async function listRoles() {
  return roleRepo.findAll();
}

module.exports = { listRoles };
