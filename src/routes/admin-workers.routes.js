import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../config/db.js';
import { users, workers } from '../db/schema.js';
import { requireAdminAuth } from '../middleware/admin-auth.js';

const router = Router();

/**
 * GET /admin/workers
 *
 * Full worker list for the admin dashboard table — joined with their
 * user info, includes inactive/unavailable ones too (unlike the
 * client-facing /workers route, which only shows available workers).
 */
router.get('/', requireAdminAuth, async (req, res) => {
  try {
    const rows = await db
      .select({
        workerId: workers.id,
        userId: users.id,
        name: users.name,
        phone: users.phone,
        email: users.email,
        skills: workers.skills,
        languages: workers.languages,
        bio: workers.bio,
        isAvailable: workers.isAvailable,
        isChildcareVerified: workers.isChildcareVerified,
        ratingAverage: workers.ratingAverage,
        ratingCount: workers.ratingCount,
        jobsCompleted: workers.jobsCompleted,
        adminRemark: workers.adminRemark,
        createdAt: workers.createdAt,
      })
      .from(workers)
      .innerJoin(users, eq(users.id, workers.userId))
      .orderBy(workers.createdAt);

    res.json({ data: rows });
  } catch (err) {
    console.error('GET /admin/workers error:', err);
    res.status(500).json({ error: { message: 'Failed to fetch workers' } });
  }
});

/**
 * POST /admin/workers
 * Body: { name, phone, skills, languages, bio?, isChildcareVerified? }
 *
 * Creates both the `users` row (role: 'worker') and the `workers` row in
 * one step. This is what replaces the manual two-step DBeaver insert.
 *
 * Note: phone must be in full international format (e.g. +233207800001)
 * since that's what Firebase Auth will look for on the worker's first
 * real login — the firebase_uid stays NULL here and gets filled in
 * automatically the first time they successfully log in via OTP (see
 * the /auth/sync-style flow we'd add for that — tracked as a follow-up,
 * not yet wired).
 */
router.post('/', requireAdminAuth, async (req, res) => {
  try {
    const { name, phone, skills, languages, bio, isChildcareVerified } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ error: { message: 'name and phone are required' } });
    }

    const [existingUser] = await db.select().from(users).where(eq(users.phone, phone));
    if (existingUser) {
      return res.status(409).json({ error: { message: 'A user with this phone number already exists' } });
    }

    // firebaseUid is required NOT NULL + unique in the schema, so we use a
    // unique placeholder until their first real login overwrites it.
    // (This mirrors the test-worker-uid-N pattern used during early seeding,
    // formalized here instead of done by hand in DBeaver.)
    const placeholderUid = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const [newUser] = await db
      .insert(users)
      .values({
        firebaseUid: placeholderUid,
        role: 'worker',
        phone,
        name,
      })
      .returning({ id: users.id });

    const [newWorker] = await db
      .insert(workers)
      .values({
        userId: newUser.id,
        skills: skills || null,
        languages: languages || null,
        bio: bio || null,
        isChildcareVerified: isChildcareVerified || false,
      })
      .returning();

    res.status(201).json({ data: { ...newWorker, name, phone } });
  } catch (err) {
    console.error('POST /admin/workers error:', err);
    res.status(500).json({ error: { message: 'Failed to create worker' } });
  }
});

/**
 * PATCH /admin/workers/:id
 * Body: any subset of { skills, languages, bio, isAvailable,
 *                        isChildcareVerified, adminRemark }
 *
 * Updates a worker's profile fields. Does not touch name/phone — those
 * live on `users` and changing a worker's phone would break their
 * Firebase login link, so that's deliberately out of scope here.
 */
router.patch('/:id', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { skills, languages, bio, isAvailable, isChildcareVerified, adminRemark } = req.body;

    const updates = { updatedAt: new Date() };
    if (skills !== undefined) updates.skills = skills;
    if (languages !== undefined) updates.languages = languages;
    if (bio !== undefined) updates.bio = bio;
    if (isAvailable !== undefined) updates.isAvailable = isAvailable;
    if (isChildcareVerified !== undefined) updates.isChildcareVerified = isChildcareVerified;
    if (adminRemark !== undefined) updates.adminRemark = adminRemark;

    const [updated] = await db
      .update(workers)
      .set(updates)
      .where(eq(workers.id, Number(id)))
      .returning();

    if (!updated) {
      return res.status(404).json({ error: { message: 'Worker not found' } });
    }

    res.json({ data: updated });
  } catch (err) {
    console.error('PATCH /admin/workers/:id error:', err);
    res.status(500).json({ error: { message: 'Failed to update worker' } });
  }
});

export default router;