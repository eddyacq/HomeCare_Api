import { Router } from 'express';
import { eq, and, desc, sql } from 'drizzle-orm';
import { db } from '../config/db.js';
import { bookings, workers, users } from '../db/schema.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { firebaseAuth } from '../config/firebase.js';
const router = Router();

// ─────────────────────────────────────────────────────────────────────────
// CLIENT-FACING — worker discovery (used by the client app)
// ─────────────────────────────────────────────────────────────────────────

/**
 * GET /worker
 * GET /worker?service=cleaning
 *
 * Lists available workers, joined with their user info. Used by the
 * client app's worker discovery screen.
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const { service } = req.query;
    const conditions = [eq(workers.isAvailable, true)];

    if (service) {
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
    console.error('GET /worker error:', err);
    res.status(500).json({ error: { message: 'Failed to fetch workers' } });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// WORKER-FACING — the logged-in worker's own profile and jobs
// These specific-word paths (me, me/jobs) are registered BEFORE the
// generic /:id route below, so Express never tries to treat "me" as an id.
// ─────────────────────────────────────────────────────────────────────────

/**
 * GET /worker/me
 *
 * The logged-in worker's own profile. Used by the worker app right after
 * login to confirm onboarding status (404 here means "not a registered
 * worker — contact your administrator").
 */
router.get('/me', requireAuth, requireRole('worker'), async (req, res) => {
  try {
    const [profile] = await db
      .select({
        workerId: workers.id,
        userId: users.id,
        name: users.name,
        phone: users.phone,
        skills: workers.skills,
        languages: workers.languages,
        bio: workers.bio,
        isAvailable: workers.isAvailable,
        isChildcareVerified: workers.isChildcareVerified,
        ratingAverage: workers.ratingAverage,
        ratingCount: workers.ratingCount,
        jobsCompleted: workers.jobsCompleted,
        adminRemark: workers.adminRemark,
      })
      .from(workers)
      .innerJoin(users, eq(users.id, workers.userId))   // ← this line was missing
      .where(eq(workers.userId, req.user.id));

    if (!profile) {
      return res.status(404).json({
        error: { message: 'No worker profile found for this account. Contact your administrator.' },
      });
    }

    res.json({ data: profile });
  } catch (err) {
    console.error('GET /workers/me error:', err);
    res.status(500).json({ error: { message: 'Failed to fetch worker profile' } });
  }
});

/**
 * GET /worker/me/jobs
 * GET /worker/me/jobs?status=pending
 *
 * Bookings assigned to the logged-in worker, optionally filtered by
 * comma-separated status list.
 */
router.get('/me/jobs', requireAuth, requireRole('worker'), async (req, res) => {
  try {
    const [workerRow] = await db
      .select({ id: workers.id })
      .from(workers)
      .where(eq(workers.userId, req.user.id));

    if (!workerRow) {
      return res.status(404).json({ error: { message: 'No worker profile found for this account.' } });
    }

    const { status } = req.query;

    const rows = await db
      .select({
        id: bookings.id,
        serviceType: bookings.serviceType,
        status: bookings.status,
        scheduledAt: bookings.scheduledAt,
        address: bookings.address,
        notes: bookings.notes,
        createdAt: bookings.createdAt,
        clientId: bookings.clientId,
        clientName: users.name,
        clientPhone: users.phone,
      })
      .from(bookings)
      .leftJoin(users, eq(users.id, bookings.clientId))
      .where(eq(bookings.workerId, workerRow.id))
      .orderBy(desc(bookings.scheduledAt));

    const filtered = status
      ? rows.filter((b) => status.split(',').includes(b.status))
      : rows;

    res.json({ data: filtered });
  } catch (err) {
    console.error('GET /worker/me/jobs error:', err);
    res.status(500).json({ error: { message: 'Failed to fetch jobs' } });
  }
});


/**
 * POST /workers/link-account
 *
 * Called once, automatically, the first time a worker successfully logs
 * in via Firebase phone OTP. Finds the `users` row matching their phone
 * number (created earlier by an admin, with a placeholder firebase_uid
 * like "pending-..."), and overwrites it with their real Firebase UID
 * from the verified token.
 */
router.post('/link-account', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      return res.status(401).json({ error: { message: 'Missing bearer token' } });
    }

    let decoded;
    try {
      decoded = await firebaseAuth.verifyIdToken(token);
    } catch (err) {
      return res.status(401).json({ error: { message: 'Token verification failed' } });
    }

    const phone = decoded.phone_number;
    if (!phone) {
      return res.status(400).json({ error: { message: 'No phone number on this token' } });
    }

    const [existingUser] = await db.select().from(users).where(eq(users.phone, phone));

    if (!existingUser) {
      return res.status(404).json({
        error: { message: 'No worker profile found for this phone number. Contact your administrator.' },
      });
    }

    if (existingUser.role !== 'worker') {
      return res.status(403).json({ error: { message: 'This account is not registered as a worker.' } });
    }

    if (existingUser.firebaseUid === decoded.uid) {
      return res.json({ data: { linked: true, alreadyLinked: true } });
    }

    if (!existingUser.firebaseUid.startsWith('pending-')) {
      return res.status(409).json({
        error: { message: 'This phone number is already linked to a different account.' },
      });
    }

    await db
      .update(users)
      .set({ firebaseUid: decoded.uid, updatedAt: new Date() })
      .where(eq(users.id, existingUser.id));

    res.json({ data: { linked: true, alreadyLinked: false } });
  } catch (err) {
    console.error('POST /workers/link-account error:', err);
    res.status(500).json({ error: { message: 'Failed to link account' } });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// CLIENT-FACING — single worker profile (must come AFTER /me routes above)
// ─────────────────────────────────────────────────────────────────────────

/**
 * GET /worker/:id
 *
 * Single worker profile — used for a "view profile" screen in the client
 * app before booking. Registered last so it never intercepts /me or
 * /me/jobs (Express matches routes top-to-bottom).
 */
router.get('/:id', requireAuth, async (req, res) => {
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
    console.error('GET /worker/:id error:', err);
    res.status(500).json({ error: { message: 'Failed to fetch worker' } });
  }
});

export default router;