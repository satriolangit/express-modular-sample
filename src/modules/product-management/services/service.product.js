import productRepo from "../repositories/repo.product.js";
import { NotFoundError } from "../../../libs/errors.js";

async function get(id) {
  const p = await productRepo.findById(Number(id));
  if (!p) throw new NotFoundError("Product not found");
  return p;
}

async function list() {
  return productRepo.findAll();
}

export default { get, list };
