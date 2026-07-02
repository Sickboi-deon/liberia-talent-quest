const db = require('./db');

async function getCurrentSeasonId() {
  const { rows } = await db.query('SELECT id FROM seasons WHERE is_current = TRUE LIMIT 1');
  return rows[0]?.id || null;
}

async function getCurrentSeason() {
  const { rows } = await db.query('SELECT * FROM seasons WHERE is_current = TRUE LIMIT 1');
  return rows[0] || null;
}

// Returns the most recent season whose number is lower than the current season.
// Used for fallback when the current season has no data yet.
async function getPreviousSeason() {
  const current = await getCurrentSeason();
  if (!current) return null;
  const { rows } = await db.query(
    'SELECT * FROM seasons WHERE number < $1 ORDER BY number DESC LIMIT 1',
    [current.number]
  );
  return rows[0] || null;
}

async function getPreviousSeasonId() {
  const prev = await getPreviousSeason();
  return prev?.id || null;
}

module.exports = { getCurrentSeasonId, getCurrentSeason, getPreviousSeason, getPreviousSeasonId };
