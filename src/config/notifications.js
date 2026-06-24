import { eq } from 'drizzle-orm';
import admin from 'firebase-admin';
import { db } from './db.js';
import { users } from '../db/schema.js';

/**
 * Sends a push notification to one user, looked up by their internal
 * users.id. Silently does nothing if they have no token saved (e.g.
 * haven't opened the app since this feature shipped, or are on a
 * platform/emulator where FCM registration failed) — a missing token is
 * an expected, non-error state, not a bug.
 *
 * If FCM reports the token as invalid/unregistered (the user uninstalled
 * the app, or reinstalled and got a new token), this clears the stale
 * token from the database so we stop trying to send to a dead token.
 */
export async function sendPushToUser(userId, { title, body, data = {} }) {
  try {
    const [user] = await db.select({ fcmToken: users.fcmToken }).from(users).where(eq(users.id, userId));

    if (!user?.fcmToken) {
      return { sent: false, reason: 'no_token' };
    }

    await admin.messaging().send({
      token: user.fcmToken,
      notification: { title, body },
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])), // FCM data payload values must be strings
      android: { priority: 'high' },
      apns: { payload: { aps: { sound: 'default' } } },
    });

    return { sent: true };
  } catch (err) {
    // These are the specific error codes Firebase returns for a token
    // that no longer exists on the device's end — clear it so we don't
    // keep failing on every future event for this user.
    const deadTokenCodes = [
      'messaging/registration-token-not-registered',
      'messaging/invalid-registration-token',
    ];

    if (deadTokenCodes.includes(err.code)) {
      await db.update(users).set({ fcmToken: null }).where(eq(users.id, userId));
      return { sent: false, reason: 'invalid_token_cleared' };
    }

    console.error(`Push notification failed for user ${userId}:`, err.message || err);
    return { sent: false, reason: 'send_error' };
  }
}