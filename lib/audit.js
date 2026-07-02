const db = require('./db');

async function logAction({ actorId, actorRole, actorName, action, entityType, entityId, detail }) {
  try {
    await db.query(
      `INSERT INTO audit_log (actor_id, actor_role, actor_name, action, entity_type, entity_id, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [actorId || null, actorRole || null, actorName || null, action,
       entityType || null, entityId || null, detail || null]
    );
  } catch (err) {
    console.error('[audit]', err.message);
  }
}

module.exports = { logAction };
