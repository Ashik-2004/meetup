import crypto from 'node:crypto';
import { createDatabase } from './db.js';

const [capability, emailArg] = process.argv.slice(2);
if (!['coordinator', 'moderator'].includes(capability) || !emailArg) {
  console.error('Usage: npm run provision:access -- <coordinator|moderator> <account-email>');
  process.exit(2);
}

const db = createDatabase();
try {
  const email = emailArg.trim().toLowerCase();
  const user = db.prepare('SELECT id, role FROM users WHERE email = ?').get(email);
  if (!user) throw new Error('No registered account has that email.');

  const provision = db.transaction(() => {
    let changed = 0;
    if (capability === 'coordinator') {
      changed = db.prepare("UPDATE users SET role = 'coordinator' WHERE id = ? AND role <> 'coordinator'").run(user.id).changes;
    } else {
      changed = db.prepare('INSERT OR IGNORE INTO moderators (user_id, provisioned_at) VALUES (?, ?)').run(user.id, new Date().toISOString()).changes;
    }
    if (changed) db.prepare(`INSERT INTO audit_log (id, actor_user_id, actor_type, action, entity_type, entity_id, details, created_at)
      VALUES (?, NULL, 'offline_operator', ?, 'user', ?, ?, ?)`)
      .run(crypto.randomUUID(), `access.provisioned.${capability}`, user.id, JSON.stringify({ capability }), new Date().toISOString());
    return changed;
  });
  const changed = provision();
  console.log(changed ? `Provisioned ${capability} access for the registered account.` : `The account already has ${capability} access.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  db.close();
}
