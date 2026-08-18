// Role-based access control. NEVER trust the client — call these guards
// inside services / API routes.

export const ROLES = {
  VISITOR: 'visitor',
  USER: 'user',
  CHANNEL_OWNER: 'channel_owner',
  BUSINESS: 'business',
  MODERATOR: 'moderator',
  ADMIN: 'admin',
  SUPER_ADMIN: 'super_admin',
};

// Ordinal ranking for hierarchical checks.
const RANK = {
  [ROLES.VISITOR]: 0,
  [ROLES.USER]: 10,
  [ROLES.CHANNEL_OWNER]: 20,
  [ROLES.BUSINESS]: 30,
  [ROLES.MODERATOR]: 50,
  [ROLES.ADMIN]: 80,
  [ROLES.SUPER_ADMIN]: 100,
};

export function rankOf(role) {
  return RANK[role] ?? 0;
}

export function hasAtLeastRole(session, minRole) {
  if (!session?.role) return false;
  return rankOf(session.role) >= rankOf(minRole);
}

export function requireRole(session, minRole) {
  if (!hasAtLeastRole(session, minRole)) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }
}

export function requireAuth(session) {
  if (!session?.userId) {
    const err = new Error('Unauthorized');
    err.status = 401;
    throw err;
  }
}
