import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../config/db.js';
import { users } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// First call after a successful Firebase OTP/login on any of the three
// frontends. Creates the row on first sight — there's no separate
// "register" endpoint, since phone+OTP login is the registration step.
router.post('/sync', requireAuth, async (req, res) => {
  const { role, name, phone, email } = req.body;
  let user = req.user;
  let isNewUser = false;

  if (!user) {
    isNewUser = true;
    await db.insert(users).values({
      firebaseUid: req.firebaseUid,
      role: role || 'client',
      name: name || null,
      phone: phone || null,
      email: email || null,
    });
    [user] = await db.select().from(users).where(eq(users.firebaseUid, req.firebaseUid));
  }

  res.json({
    success: true,
    data: { id: user.id, role: user.role, phone: user.phone, name: user.name, isNewUser },
    error: null,
  });
});

router.get('/me', requireAuth, async (req, res) => {
  if (!req.user) {
    return res.status(404).json({
      success: false,
      data: null,
      error: { code: 'USER_NOT_SYNCED', message: 'Call /auth/sync first' },
    });
  }
  res.json({ success: true, data: req.user, error: null });
});

export default router;
