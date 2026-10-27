import policyService from "../services/service.policy.js";
import { handleRouteError } from "../../../libs/errors.js";

export default function registerPolicy(r) {
  r.get("/policies", async (req, res) => {
    res.json(await policyService.list());
  });

  r.get("/policies/:id", async (req, res) => {
    try {
      res.json(await policyService.get(req.params.id));
    } catch (e) {
      handleRouteError(res, e);
    }
  });
}
