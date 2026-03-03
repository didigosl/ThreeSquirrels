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
  max: 30, // Increased from 10 to 30 to handle more concurrent requests
  connectionTimeoutMillis: 2000, // Fail fast after 2s if pool is full
  idleTimeoutMillis: 30000 // Close idle clients after 30s
});

// Handle unexpected errors on idle clients
pool.on('error', (err, client) => {
  console.error('Unexpected error on idle client', err);
  // process.exit(-1); // Let Docker restart the container
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
