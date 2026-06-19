import 'dotenv/config';
import { Client } from 'pg';

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function testConnection() {
  try {
    console.log('Connecting...');
    await client.connect();
    console.log('✅ Connected successfully!');

    const result = await client.query('SELECT version()');
    console.log('Postgres version:', result.rows[0].version);

    await client.end();
  } catch (err) {
    console.error('❌ Connection failed:', err.message);
    console.error(err);
  }
}

testConnection();