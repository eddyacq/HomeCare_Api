// import { drizzle } from 'drizzle-orm/mysql2';
// import mysql from 'mysql2/promise';
// import * as schema from '../db/schema.js';

// // Keep connectionLimit conservative — Railway's hobby MySQL plans cap
// // concurrent connections, and a pool that's too wide is the easiest way
// // to hit "too many connections" under load.
// const pool = mysql.createPool({
//   uri: process.env.DATABASE_URL,
//   connectionLimit: 10,
//   waitForConnections: true,
// });

// export const db = drizzle(pool, { schema, mode: 'default' });
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../db/schema.js';

// Render's free Postgres requires SSL, but with a self-signed cert chain —
// rejectUnauthorized: false skips chain validation. Fine for this stage;
// revisit if you need stricter SSL once you're off the free tier.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

export const db = drizzle(pool, { schema });