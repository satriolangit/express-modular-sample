import productRepo from "../repositories/repo.product.js";

async function get(id) {
  const p = await productRepo.findById(Number(id));
  if (!p) throw new Error("Product not found");
  return p;
}

async function list() {
  return productRepo.findAll();
}

export default { get, list };
