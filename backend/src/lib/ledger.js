// Ledger helpers. Every balance change is a pair of prepared statements:
// one UPDATE on balances and one INSERT into the append-only ledger_entries.
// Callers combine them in a single env.DB.batch([...]) so the change is atomic.
// The CHECK constraints on balances make an overdraft abort the whole batch.

export const HOUSE_ID = 1;

export function move(db, { userId, asset, available = 0, locked = 0, kind, refType = null, refId = null, now }) {
  return [
    db
      .prepare(
        'UPDATE balances SET available = available + ?1, locked = locked + ?2 WHERE user_id = ?3 AND asset = ?4',
      )
      .bind(available, locked, userId, asset),
    db
      .prepare(
        `INSERT INTO ledger_entries (user_id, asset, delta, locked_delta, kind, ref_type, ref_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      )
      .bind(userId, asset, available, locked, kind, refType, refId, now),
  ];
}

export function notify(db, userId, title, body, now) {
  return db
    .prepare('INSERT INTO notifications (user_id, title, body, created_at) VALUES (?1, ?2, ?3, ?4)')
    .bind(userId, title, body, now);
}

export function audit(db, { actorId = null, action, target = null, meta = null, ip = null, now }) {
  return db
    .prepare('INSERT INTO audit_log (actor_id, action, target, meta, ip, created_at) VALUES (?1,?2,?3,?4,?5,?6)')
    .bind(actorId, action, target, meta ? JSON.stringify(meta) : null, ip, now);
}

/** Maps D1 constraint failures raised inside a batch to a short reason. */
export function constraintReason(err) {
  const msg = String((err && err.message) || err);
  if (/CHECK constraint failed/i.test(msg)) return 'insufficient_funds';
  if (/UNIQUE constraint failed/i.test(msg)) return 'duplicate';
  return null;
}
