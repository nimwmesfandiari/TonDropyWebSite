import { ok, readJson, pageParams } from '../lib/http.js';

export function register(r) {
  r.get('/notifications', async (c) => {
    const { limit, before } = pageParams(c.url, { defaultLimit: 30 });
    const [list, unread] = await c.env.DB.batch([
      c.env.DB
        .prepare('SELECT id, title, body, is_read, created_at FROM notifications WHERE user_id = ?1 AND (?2 IS NULL OR id < ?2) ORDER BY id DESC LIMIT ?3')
        .bind(c.user.id, before, limit),
      c.env.DB.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?1 AND is_read = 0').bind(c.user.id),
    ]);
    return ok({
      unread: unread.results[0].n,
      notifications: list.results.map((n) => ({
        id: n.id, title: n.title, body: n.body, read: n.is_read === 1, createdAt: n.created_at,
      })),
    });
  }, { auth: true });

  r.post('/notifications/read', async (c) => {
    const body = await readJson(c.request);
    if (Array.isArray(body.ids) && body.ids.length > 0) {
      const ids = body.ids.filter((n) => Number.isInteger(n)).slice(0, 100);
      if (ids.length) {
        const marks = ids.map((_, i) => `?${i + 2}`).join(',');
        await c.env.DB.prepare(`UPDATE notifications SET is_read = 1 WHERE user_id = ?1 AND id IN (${marks})`)
          .bind(c.user.id, ...ids)
          .run();
      }
    } else {
      await c.env.DB.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?1').bind(c.user.id).run();
    }
    return ok({ done: true });
  }, { auth: true });
}
