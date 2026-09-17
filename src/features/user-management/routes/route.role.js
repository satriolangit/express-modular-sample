const roleService = require("../services/service.role");

module.exports = function registerRole(r) {
  r.get("/roles", async (req, res) => {
    res.json(await roleService.listRoles());
  });
};
