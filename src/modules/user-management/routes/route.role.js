import roleService from "../services/service.role.js";

export default function registerRole(r) {
  r.get("/roles", async (req, res) => {
    res.json(await roleService.listRoles());
  });
}
