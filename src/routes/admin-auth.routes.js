import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { db } from '../config/db.js';
import { admins } from '../db/schema.js';
import { JWT_SECRET } from '../middleware/admin-auth.js';

const router = Router();

/**
 * POST /admin/auth/login
 * Body: { email, password }
 *
 * Returns a JWT valid for 7 days. The React dashboard stores this and
 * sends it as a Bearer token on every subsequent request.
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: { message: 'Email and password are required' } });
    }

    const [admin] = await db.select().from(admins).where(eq(admins.email, email.toLowerCase().trim()));

    if (!admin || !admin.isActive) {
      return res.status(401).json({ error: { message: 'Invalid email or password' } });
    }

    const passwordMatches = await bcrypt.compare(password, admin.passwordHash);
    if (!passwordMatches) {
      return res.status(401).json({ error: { message: 'Invalid email or password' } });
    }

    const token = jwt.sign({ adminId: admin.id }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      data: {
        token,
        admin: { id: admin.id, email: admin.email, name: admin.name },
      },
    });
  } catch (err) {
    console.error('POST /admin/auth/login error:', err);
    res.status(500).json({ error: { message: 'Login failed' } });
  }
});

/**
 * POST /admin/auth/setup
 * Body: { email, password, name, setupKey }
 *
 * One-time route to create the FIRST admin account, since there's no
 * other way to bootstrap into a system with no admins yet. Protected by
 * a setup key (set via env var) rather than left wide open. Once you have
 * at least one admin, delete this route or rotate/remove the setup key.
 */
router.post('/setup', async (req, res) => {
  try {
    const { email, password, name, setupKey } = req.body;

    if (setupKey !== process.env.ADMIN_SETUP_KEY) {
      return res.status(403).json({ error: { message: 'Invalid setup key' } });
    }

    if (!email || !password) {
      return res.status(400).json({ error: { message: 'Email and password are required' } });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: { message: 'Password must be at least 8 characters' } });
    }

    const [existing] = await db.select().from(admins).where(eq(admins.email, email.toLowerCase().trim()));
    if (existing) {
      return res.status(409).json({ error: { message: 'An admin with this email already exists' } });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const [created] = await db
      .insert(admins)
      .values({ email: email.toLowerCase().trim(), passwordHash, name: name || null })
      .returning({ id: admins.id, email: admins.email, name: admins.name });

    res.status(201).json({ data: created });
  } catch (err) {
    console.error('POST /admin/auth/setup error:', err);
    res.status(500).json({ error: { message: 'Setup failed' } });
  }
});

export default router;