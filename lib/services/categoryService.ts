import { categoryRepo } from '../repositories/categoryRepo';
import type { Category } from '@/lib/types';

export const categoryService = {
  listActive: (): Promise<Category[]> => categoryRepo.listActive(),
};
