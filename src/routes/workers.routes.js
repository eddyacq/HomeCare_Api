import { Router } from 'express';
import { eq, and, sql } from 'drizzle-orm';
import { db } from '../config/db.js';
import { workers, users } from '../db/schema.js';
import { verifyFirebaseToken } from '../middleware/auth.js';

const router = Router();

/**
 * GET /workers
 * GET /workers?service=cleaning
 *
 * Lists available workers, joined with their user info (name, phone).
 * Optional ?service= filter matches against the comma-separated
 * `skills` column using a simple LIKE — fine for V1's scale.
 */
router.get('/', verifyFirebaseToken, async (req, res) => {
  try {
    const { service } = req.query;

    const conditions = [eq(workers.isAvailable, true)];

    if (service) {
      // skills is stored as "cleaning,laundry" — match if it contains the term
      conditions.push(sql`${workers.skills} LIKE ${'%' + service + '%'}`);
    }

    const rows = await db
      .select({
        id: workers.id,
        userId: workers.userId,
        name: users.name,
        phone: users.phone,
        skills: workers.skills,
        languages: workers.languages,
        bio: workers.bio,
        profilePhotoUrl: workers.profilePhotoUrl,
        isAvailable: workers.isAvailable,
        isChildcareVerified: workers.isChildcareVerified,
        ratingAverage: workers.ratingAverage,
        ratingCount: workers.ratingCount,
        jobsCompleted: workers.jobsCompleted,
        adminRemark: workers.adminRemark,
      })
      .from(workers)
      .innerJoin(users, eq(users.id, workers.userId))
      .where(and(...conditions));

    res.json({ data: rows });
  } catch (err) {
    console.error('GET /workers error:', err);
    res.status(500).json({ error: { message: 'Failed to fetch workers' } });
  }
});

/**
 * GET /workers/:id
 *
 * Single worker profile — used for the "view profile" screen before booking.
 */
router.get('/:id', verifyFirebaseToken, async (req, res) => {
  try {
    const { id } = req.params;

    const [worker] = await db
      .select({
        id: workers.id,
        userId: workers.userId,
        name: users.name,
        phone: users.phone,
        skills: workers.skills,
        languages: workers.languages,
        bio: workers.bio,
        profilePhotoUrl: workers.profilePhotoUrl,
        isAvailable: workers.isAvailable,
        isChildcareVerified: workers.isChildcareVerified,
        ratingAverage: workers.ratingAverage,
        ratingCount: workers.ratingCount,
        jobsCompleted: workers.jobsCompleted,
        adminRemark: workers.adminRemark,
      })
      .from(workers)
      .innerJoin(users, eq(users.id, workers.userId))
      .where(eq(workers.id, Number(id)));

    if (!worker) {
      return res.status(404).json({ error: { message: 'Worker not found' } });
    }

    res.json({ data: worker });
  } catch (err) {
    console.error('GET /workers/:id error:', err);
    res.status(500).json({ error: { message: 'Failed to fetch worker' } });
  }
});

export default router;