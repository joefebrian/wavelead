import bcrypt from 'bcryptjs';

export async function hashPassword(plain) {
  if (!plain || plain.length < 8) throw new Error('Password must be at least 8 characters');
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain, hash) {
  if (!plain || !hash) return false;
  return bcrypt.compare(plain, hash);
}
