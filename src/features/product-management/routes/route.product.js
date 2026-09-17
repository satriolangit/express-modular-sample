const productService = require("../services/service.product");

module.exports = function registerProduct(r) {
  r.get("/", async (req, res) => {
    res.json(await productService.list());
  });

  r.get("/:id", async (req, res) => {
    try {
      res.json(await productService.get(req.params.id));
    } catch (e) {
      res.status(404).json({ error: e.message });
    }
  });
};
