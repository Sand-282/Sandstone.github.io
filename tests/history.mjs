import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

// Seed bounded local-only fixtures through the real D1 CLI. Email stays disabled.
const origin = new URL(process.env.TEST_BASE_URL || 'http://localhost:5173').origin;
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) throw new Error('History tests only support a loopback preview.');
const cwd = fileURLToPath(new URL('../', import.meta.url));
const fixture = `qa-history-${randomUUID()}`;
const fixtureFile = fileURLToPath(new URL(`../work/${fixture}.sql`, import.meta.url));
const run = promisify(execFile);
const signin = await fetch(`${origin}/signin-with-chatgpt?return_to=/admin`, { redirect: 'manual' });
assert.ok([302, 303].includes(signin.status));
const cookies = signin.headers.getSetCookie().map((cookie) => cookie.split(';')[0]).join('; ');
async function api(path, method = 'GET', body) {
  const response = await fetch(`${origin}${path}`, { method, headers: { cookie: cookies, origin, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  return data;
}
const session = await api('/api/session');
assert.equal(session.role, 'admin'); assert.equal(session.emailConfigured, false, 'Do not run with live email configured.');
let checks = 0;
async function check(name, operation) { await operation(); checks++; process.stdout.write(`PASS ${name}\n`); }
async function sql(statement) {
  await mkdir(new URL('../work/', import.meta.url), { recursive: true });
  await writeFile(fixtureFile, statement, 'utf8');
  const { stdout } = await run(process.execPath, ['--import', './scripts/sites-env.mjs', './node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'DB', '--local', '--config', 'dist/server/wrangler.json', '--persist-to', '.wrangler/state', '--file', fixtureFile, '--json'], { cwd, maxBuffer: 2 * 1024 * 1024 });
  return JSON.parse(stdout);
}
const ids = Array.from({ length: 201 }, (_, index) => `${fixture}-${String(index).padStart(3, '0')}`);
const messages = Array.from({ length: 505 }, (_, index) => ({ id: `${fixture}-message-${String(index + 1).padStart(3, '0')}`, at: new Date(Date.UTC(2026, 0, 1, 0, 0, 0, index + 1)).toISOString(), body: `History message ${index + 1}` }));
try {
  const requestsSql = ids.map((id, index) => `INSERT INTO commission_requests(id,name,email,title,description,status,idempotency_key,payload_hash,created_at,updated_at) VALUES('${id}','History fixture','history@example.test','Local history test','A local-only fixture for history verification.','${index === 0 ? 'active' : 'pending'}','${id}','fixture','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');`).join('\n');
  const messagesSql = messages.map((message) => `INSERT INTO messages(id,request_id,sender,body,idempotency_key,created_at) VALUES('${message.id}','${ids[0]}','client','${message.body}','${message.id}','${message.at}');`).join('\n');
  await sql(`${requestsSql}\n${messagesSql}`);

  await check('Owner request pagination returns every older request without duplicates', async () => {
    const seen = new Set(); let cursor = null; let pages = 0;
    do {
      const data = await api(`/api/requests${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
      assert.ok(data.requests.length <= 200);
      for (const request of data.requests) { assert.ok(!seen.has(request.id), 'A request appeared on more than one page'); seen.add(request.id); }
      cursor = data.nextCursor; pages++; assert.ok(pages < 20, 'Pagination did not terminate');
    } while (cursor);
    assert.ok(pages >= 2);
    assert.ok(ids.every((id) => seen.has(id)), 'An older local fixture was omitted');
  });

  await check('Long chat details retain the newest 500 messages in chronological order', async () => {
    const detail = await api(`/api/requests/${ids[0]}`);
    assert.equal(detail.hasOlderMessages, true); assert.equal(detail.messages.length, 500);
    assert.equal(detail.messages[0].body, 'History message 6'); assert.equal(detail.messages.at(-1).body, 'History message 505');
    assert.deepEqual(detail.messages.map((message) => message.body), messages.slice(5).map((message) => message.body));
    const chat = await api(`/api/requests/${ids[0]}/messages`);
    assert.equal(chat.hasOlderMessages, true); assert.deepEqual(chat.messages, detail.messages);
  });

  await check('A pending note update does not claim the commission is complete', async () => {
    const changed = await api(`/api/requests/${ids[1]}`, 'PATCH', { status: 'pending', note: 'The scope is being reviewed.' });
    assert.equal(changed.request.status, 'pending'); assert.equal(changed.email.state, 'unconfigured');
    const result = await sql(`SELECT subject,body FROM email_outbox WHERE request_id='${ids[1]}';`);
    const rows = result.flatMap((entry) => entry.results);
    assert.equal(rows.length, 1); assert.match(rows[0].subject, /Commission update:/); assert.match(rows[0].body, /There is an update on your commission request/); assert.doesNotMatch(rows[0].body, /now complete/);
  });

  await check('Malformed owner request cursors fail safely', async () => {
    const response = await fetch(`${origin}/api/requests?cursor=not-a-valid-cursor`, { headers: { cookie: cookies } });
    assert.equal(response.status, 400);
  });
} finally {
  // Delete only this run's exact fixture IDs; public content and previous samples remain.
  await sql(`DELETE FROM messages WHERE request_id='${ids[0]}'; DELETE FROM email_outbox WHERE request_id IN ('${ids[0]}','${ids[1]}'); DELETE FROM commission_requests WHERE id IN (${ids.map((id) => `'${id}'`).join(',')});`);
  await unlink(fixtureFile);
}
process.stdout.write(`\n${checks} long-history checks passed. Local fixtures removed. No live email was sent.\n`);
