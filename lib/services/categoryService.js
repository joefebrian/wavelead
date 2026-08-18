import { categoryRepo } from '../repositories/categoryRepo.js';

export const categoryService = {
  listActive: () => categoryRepo.listActive(),
};
