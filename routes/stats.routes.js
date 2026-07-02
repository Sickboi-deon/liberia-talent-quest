const express = require('express');
const router  = express.Router();
const db      = require('../lib/db');

// Public — all-time LTQ aggregate stats (used by the about page impact section)
router.get('/', async (_req, res) => {
  const { rows } = await db.query(`
    SELECT
      (SELECT COUNT(*)               FROM contestants)                                                  AS total_contestants,
      (SELECT COUNT(*)               FROM votes)                                                        AS total_votes,
      (SELECT COUNT(DISTINCT county) FROM contestants WHERE county IS NOT NULL AND county <> '')        AS total_counties,
      (SELECT COUNT(*)               FROM seasons    WHERE status IN ('active','archived'))             AS total_seasons,
      (SELECT COUNT(*)               FROM categories WHERE active = TRUE)                               AS total_categories
  `);
  const r = rows[0];
  res.json({
    contestants: Number(r.total_contestants),
    votes:       Number(r.total_votes),
    counties:    Number(r.total_counties),
    seasons:     Number(r.total_seasons),
    categories:  Number(r.total_categories)
  });
});

module.exports = router;
