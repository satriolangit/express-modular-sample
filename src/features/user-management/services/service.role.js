import roleRepo from "../repositories/repo.role.js";

async function listRoles() {
  return roleRepo.findAll();
}

export default { listRoles };
