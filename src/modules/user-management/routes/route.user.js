import userService from "../services/service.user.js";

export default function registerUser(r) {
  r.get("/", async (req, res) => {
    res.json(await userService.listUsers());
  });

  r.get("/:id", async (req, res) => {
    try {
      res.json(await userService.getUser(req.params.id));
    } catch (e) {
      res.status(404).json({ error: e.message });
    }
  });
}
