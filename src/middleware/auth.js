import { eq } from 'drizzle-orm';
import { db } from '../config/db.js';
import { users } from '../db/schema.js';
import { firebaseAuth } from '../config/firebase.js';

function fail(res, status, code, message) {
  return res.status(status).json({ success: false, data: null, error: { code, message } });
}

// Verifies the Firebase ID token on every request and looks up the matching
// row in `users`. req.user is null until /auth/sync has run once for this
// uid — routes that require a synced user should check for that explicitly.
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return fail(res, 401, 'NO_TOKEN', 'Missing bearer token');
  }

  try {
    const decoded = await firebaseAuth.verifyIdToken(token);
    const [user] = await db.select().from(users).where(eq(users.firebaseUid, decoded.uid));

    req.firebaseUid = decoded.uid;
    req.user = user || null;
    next();
  } catch (err) {
    // Temporary — logs the real reason to the Render logs so we can see
    // past the generic 401. Remove once the underlying cause is fixed.
    console.error('Token verification failed:', err.message);
    return fail(res, 401, 'INVALID_TOKEN', 'Token verification failed');
  }
}

// Use after requireAuth to restrict a route to specific roles, e.g.
// router.get('/admin/workers', requireAuth, requireRole('admin'), handler)
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return fail(res, 403, 'FORBIDDEN', 'Insufficient permissions');
    }
    next();
  };
}