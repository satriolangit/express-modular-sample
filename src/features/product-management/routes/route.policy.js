const policyService = require("../services/service.policy");

module.exports = function registerPolicy(r) {
  r.get("/policies", async (req, res) => {
    res.json(await policyService.list());
  });

  r.get("/policies/:id", async (req, res) => {
    try {
      res.json(await policyService.get(req.params.id));
    } catch (e) {
      res.status(404).json({ error: e.message });
    }
  });
};
