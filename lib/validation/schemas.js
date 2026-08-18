import { z } from 'zod';

export const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  display_name: z.string().min(1).max(80),
  country_code: z.string().length(2).optional(),
  preferred_language: z.string().min(2).max(8).optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const listChannelsSchema = z.object({
  category: z.string().optional(),
  country: z.string().optional(),
  q: z.string().optional(),
  sort: z.enum(['newest', 'top', 'trending']).optional(),
  limit: z.coerce.number().min(1).max(60).optional(),
  cursor: z.string().optional(),
});
