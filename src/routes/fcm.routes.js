import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../config/db.js';
import { users } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

/**
 * POST /auth/fcm-token
 * Body: { token }
 *
 * Saves (or overwrites) the calling user's FCM token. Called by both the
 * client and worker apps right after login, and again whenever Firebase
 * hands the app a refreshed token (tokens can change — app reinstall,
 * cleared data, etc. — so this should be called on every app start, not
 * just once at signup).
 *
 * Lives under requireAuth, so it only ever updates the logged-in user's
 * own row — there's no way to set someone else's token through this.
 */
router.post('/fcm-token', requireAuth, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(404).json({ error: { message: 'User not found. Please log in again.' } });
    }

    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ error: { message: 'token is required' } });
    }

    await db.update(users).set({ fcmToken: token, updatedAt: new Date() }).where(eq(users.id, req.user.id));

    res.json({ data: { saved: true } });
  } catch (err) {
    console.error('POST /auth/fcm-token error:', err);
    res.status(500).json({ error: { message: 'Failed to save push token' } });
  }
});

export default router;