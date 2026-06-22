import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { db } from '../config/db.js';
import { admins } from '../db/schema.js';

const JWT_SECRET = process.env.ADMIN_JWT_SECRET;

if (!JWT_SECRET) {
  // Fail loudly at boot rather than silently signing tokens with `undefined`.
  throw new Error('ADMIN_JWT_SECRET is not set in environment variables');
}

function fail(res, status, code, message) {
  return res.status(status).json({ success: false, data: null, error: { code, message } });
}

/**
 * Verifies the admin's JWT (issued by POST /admin/auth/login) and attaches
 * the admin row to req.admin. Completely separate from the Firebase
 * requireAuth used by the client/worker apps — different token format,
 * different table, different secret.
 */
export async function requireAdminAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return fail(res, 401, 'NO_TOKEN', 'Missing bearer token');
  }

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return fail(res, 401, 'INVALID_TOKEN', 'Invalid or expired token');
  }

  try {
    const [admin] = await db
      .select({ id: admins.id, email: admins.email, name: admins.name, isActive: admins.isActive })
      .from(admins)
      .where(eq(admins.id, decoded.adminId));

    if (!admin || !admin.isActive) {
      return fail(res, 401, 'INVALID_ADMIN', 'Admin account not found or inactive');
    }

    req.admin = admin;
    next();
  } catch (err) {
    console.error('Database lookup failed in requireAdminAuth:', err.message || err);
    return fail(res, 500, 'DB_ERROR', 'Database error during authentication');
  }
}

export { JWT_SECRET };