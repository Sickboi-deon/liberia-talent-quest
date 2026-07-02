const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false
});

pool.on('error', (err) => {
  console.error('[db] Idle client error:', err.message);
});

const db = {
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect()
};

module.exports = db;
