import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from '../db/schema.js';

// Keep connectionLimit conservative — Railway's hobby MySQL plans cap
// concurrent connections, and a pool that's too wide is the easiest way
// to hit "too many connections" under load.
const pool = mysql.createPool({
  uri: process.env.DATABASE_URL,
  connectionLimit: 10,
  waitForConnections: true,
});

export const db = drizzle(pool, { schema, mode: 'default' });
