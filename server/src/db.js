import pg from 'pg';

const { Pool } = pg;

const {
  DATABASE_URL,
  DB_HOST = 'localhost',
  DB_PORT = '5432',
  DB_USER = 'postgres',
  DB_PASSWORD = '',
  DB_NAME = 'komeya'
} = process.env;

const connectionString = DATABASE_URL || `postgres://${encodeURIComponent(DB_USER)}${DB_PASSWORD ? ':'+encodeURIComponent(DB_PASSWORD) : ''}@${DB_HOST}:${DB_PORT}/${DB_NAME}`;

export const pool = new Pool({
  connectionString,
  max: 10
});

export async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    const res = await client.query(sql, params);
    return res;
  } finally {
    client.release();
  }
}
