import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const origin = new URL(process.env.TEST_BASE_URL || 'http://localhost:5173').origin;
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) {
  throw new Error('Integration tests create local sample requests. Only a loopback preview is supported.');
}
// A reserved documentation address isolates each local run's rate-limit fixtures.
const localTestIp = `192.0.2.${Math.floor(Math.random() * 253) + 1}`;

class Browser {
  cookies = new Map();
  async request(path, { method = 'GET', json, form, headers = {}, sameOrigin = true } = {}) {
    const requestHeaders = new Headers(headers);
    requestHeaders.set('cf-connecting-ip', localTestIp);
    if (this.cookies.size) requestHeaders.set('cookie', [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; '));
    if (method !== 'GET' && sameOrigin) requestHeaders.set('origin', origin);
    if (json !== undefined) requestHeaders.set('content-type', 'application/json');
    const response = await fetch(new URL(path, origin), {
      method,
      headers: requestHeaders,
      body: json !== undefined ? JSON.stringify(json) : form,
      redirect: 'manual',
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const split = pair.indexOf('=');
      const name = pair.slice(0, split);
      const value = pair.slice(split + 1);
      if (/max-age=0/i.test(cookie)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const contentType = response.headers.get('content-type') || '';
    const bytes = Buffer.from(await response.arrayBuffer());
    const body = contentType.includes('application/json') ? JSON.parse(bytes.toString('utf8')) : bytes.toString('utf8');
    return { status: response.status, headers: response.headers, body, bytes };
  }
}

const runId = randomUUID();
let passed = 0;
async function test(name, operation) {
  try {
    await operation();
    passed++;
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    process.stderr.write(`FAIL ${name}: ${error.message}\n`);
    throw error;
  }
}

function status(result, expected) {
  assert.equal(result.status, expected, JSON.stringify(result.body));
}

function key() { return randomUUID().replaceAll('-', ''); }

function submission({ name = `QA client ${runId}`, email = `qa-${runId}@example.test`, idempotencyKey = key(), file = true } = {}) {
  const form = new FormData();
  for (const [field, value] of Object.entries({
    name, email, title: `QA commission ${runId}`, description: 'A local integration fixture for custom Bedrock scripting and behaviour.',
    budget: 'Discuss after review', timeline: 'No deadline', assets: 'Client provides their own assets', consent: 'true', website: '', idempotencyKey,
  })) form.set(field, value);
  if (file) form.append('files', new Blob(['QA text attachment'], { type: 'text/plain' }), 'reference.txt');
  return form;
}

function success(result) { assert.ok(result.status >= 200 && result.status < 300, `${result.status}: ${JSON.stringify(result.body)}`); }
function unsent(result) {
  assert.equal(result.body.email?.state, 'unconfigured', JSON.stringify(result.body));
  assert.ok(result.body.email.notifications.length > 0, 'Expected stored notification records');
  assert.ok(result.body.email.notifications.every((mail) => mail.state === 'unconfigured'));
}

const anonymous = new Browser();
const admin = new Browser();
const client = new Browser();
const other = new Browser();
const firstKey = key();
let commission;
let declined;
let privatePath;
let attachment;
let initialContent;

await test('Anonymous identity and owner authorization', async () => {
  const session = await anonymous.request('/api/session'); success(session);
  assert.equal(session.body.role, 'anonymous');
  status(await anonymous.request('/api/admin/email'), 403);
  status(await anonymous.request('/api/admin/email', { headers: { 'oai-authenticated-user-id': 'forged', 'oai-authenticated-user-email': 'seedy@sites.test' } }), 403);
});

await test('Local owner sign-in and disabled email safety gate', async () => {
  const login = await admin.request('/signin-with-chatgpt?return_to=/admin');
  assert.ok([302, 303].includes(login.status));
  const session = await admin.request('/api/session'); success(session);
  assert.equal(session.body.role, 'admin');
  assert.equal(session.body.emailConfigured, false, 'Tests require email delivery disabled. Do not run against real email credentials.');
  const mail = await admin.request('/api/admin/email'); success(mail);
  assert.equal(mail.body.configured, false, 'Tests require email delivery disabled. Do not run against real email credentials.');
});

await test('Origin and cross-site write checks', async () => {
  status(await anonymous.request('/api/requests', { method: 'POST', form: submission(), sameOrigin: false }), 403);
  status(await anonymous.request('/api/requests', { method: 'POST', form: submission(), headers: { origin: 'https://external.example' }, sameOrigin: false }), 403);
  status(await anonymous.request('/api/requests', { method: 'POST', form: submission(), headers: { 'sec-fetch-site': 'cross-site' } }), 403);
});

await test('Commission and attachment persist with honest email state', async () => {
  const result = await client.request('/api/requests', { method: 'POST', form: submission({ idempotencyKey: firstKey }) });
  success(result); unsent(result);
  commission = result.body.request;
  privatePath = result.body.portalUrl;
  assert.equal(commission.status, 'pending');
  assert.match(privatePath, /^\/portal#access=[A-Za-z0-9_-]{43}$/);
  assert.match(result.headers.get('set-cookie'), /HttpOnly.*SameSite=Lax/);
  const detail = await client.request(`/api/requests/${commission.id}`); success(detail);
  assert.equal(detail.body.files.length, 1);
  assert.equal(detail.body.files[0].name, 'reference.txt');
  assert.equal(detail.body.notifications, undefined, 'Clients must not receive owner outbox details');
  attachment = detail.body.files[0];
});

await test('Submission retry does not duplicate records or notifications', async () => {
  const result = await client.request('/api/requests', { method: 'POST', form: submission({ idempotencyKey: firstKey }) });
  success(result);
  assert.equal(result.body.request.id, commission.id);
  unsent(result);
  const detail = await admin.request(`/api/requests/${commission.id}`); success(detail);
  assert.equal(detail.body.files.length, 1);
  assert.equal(detail.body.notifications.length, 2, 'One owner notification and one client receipt expected');
  const conflicting = submission({ idempotencyKey: firstKey }); conflicting.set('title', 'Conflicting changed submission');
  status(await client.request('/api/requests', { method: 'POST', form: conflicting }), 409);
  const changedBytes = submission({ idempotencyKey: firstKey, file: false });
  changedBytes.append('files', new Blob(['QB text attachment'], { type: 'text/plain' }), 'reference.txt');
  status(await client.request('/api/requests', { method: 'POST', form: changedBytes }), 409);
});

await test('Commission listing stays scoped and hides internal access data', async () => {
  status(await anonymous.request('/api/requests'), 401);
  const own = await client.request('/api/requests'); success(own);
  assert.deepEqual(own.body.requests.map((request) => request.id), [commission.id]);
  assert.equal(own.body.requests[0].idempotency_key, undefined);
  assert.equal(own.body.requests[0].payload_hash, undefined);
  const all = await admin.request('/api/requests'); success(all);
  assert.ok(all.body.requests.some((request) => request.id === commission.id));
});

await test('Private commission and attachment authorization', async () => {
  status(await anonymous.request(`/api/requests/${commission.id}`), 404);
  status(await anonymous.request(attachment.url), 404);
  const ownFile = await client.request(attachment.url); success(ownFile);
  assert.equal(ownFile.body, 'QA text attachment');
  assert.equal(ownFile.headers.get('x-content-type-options'), 'nosniff');
  assert.match(ownFile.headers.get('content-disposition'), /^attachment;/);
  const ownerFile = await admin.request(attachment.url); success(ownerFile);
  assert.equal(ownerFile.body, ownFile.body);
});

await test('Pending chat and client administrative actions are denied', async () => {
  status(await client.request(`/api/requests/${commission.id}/messages`, { method: 'POST', json: { body: 'Chat is not accepted yet', idempotencyKey: key() } }), 409);
  status(await client.request(`/api/requests/${commission.id}`, { method: 'PATCH', json: { status: 'accepted' } }), 403);
  const detail = await admin.request(`/api/requests/${commission.id}`); success(detail);
  assert.equal(detail.body.messages.length, 0);
  assert.equal(detail.body.notifications.length, 2);
});

await test('Separate clients cannot see or write to each other', async () => {
  const result = await other.request('/api/requests', { method: 'POST', form: submission({ name: 'QA other client', email: `other-${runId}@example.test`, file: false }) });
  success(result); unsent(result); declined = result.body.request;
  status(await other.request(`/api/requests/${commission.id}`), 404);
  status(await other.request(attachment.url), 404);
  status(await client.request(`/api/requests/${declined.id}`), 404);
  status(await other.request(`/api/requests/${commission.id}/messages`, { method: 'POST', json: { body: 'Unauthorized message', idempotencyKey: key() } }), 404);
});

await test('Owner accepts request; acceptance notification is stored', async () => {
  status(await admin.request(`/api/requests/${commission.id}`, { method: 'PATCH', json: { status: 'accepted' }, headers: { origin: 'https://external.example' }, sameOrigin: false }), 403);
  const result = await admin.request(`/api/requests/${commission.id}`, { method: 'PATCH', json: { status: 'accepted', note: 'QA accepted for discussion' } });
  success(result); unsent(result);
  const detail = await client.request(`/api/requests/${commission.id}`); success(detail);
  assert.equal(detail.body.request.status, 'accepted');
  assert.equal(detail.body.request.note, 'QA accepted for discussion');
  const again = await admin.request(`/api/requests/${commission.id}`, { method: 'PATCH', json: { status: 'accepted', note: 'QA accepted for discussion' } }); success(again);
  assert.equal(again.body.email.state, 'unchanged');
});

await test('Owner decline and invalid lifecycle transitions', async () => {
  status(await admin.request(`/api/requests/${declined.id}`, { method: 'PATCH', json: { status: 'active' } }), 409);
  const result = await admin.request(`/api/requests/${declined.id}`, { method: 'PATCH', json: { status: 'declined', note: 'QA decline fixture' } }); success(result); unsent(result);
  status(await other.request(`/api/requests/${declined.id}/messages`, { method: 'POST', json: { body: 'Declined chats stay closed', idempotencyKey: key() } }), 409);
  status(await admin.request(`/api/requests/${declined.id}`, { method: 'PATCH', json: { status: 'accepted' } }), 409);
});

await test('Both chat directions persist and notify the other party', async () => {
  const messageKey = key();
  const payload = { body: 'QA client message with a saved notification', idempotencyKey: messageKey };
  const clientMessage = await client.request(`/api/requests/${commission.id}/messages`, { method: 'POST', json: payload }); success(clientMessage); unsent(clientMessage);
  const retry = await client.request(`/api/requests/${commission.id}/messages`, { method: 'POST', json: payload }); success(retry);
  unsent(retry);
  status(await client.request(`/api/requests/${commission.id}/messages`, { method: 'POST', json: { ...payload, body: 'Changed body with the same message key' } }), 409);
  const ownerMessage = await admin.request(`/api/requests/${commission.id}/messages`, { method: 'POST', json: { body: 'QA owner reply with a saved notification', idempotencyKey: key() } }); success(ownerMessage); unsent(ownerMessage);
  const detail = await admin.request(`/api/requests/${commission.id}`); success(detail);
  assert.deepEqual(detail.body.messages.map((message) => message.sender), ['client', 'admin']);
  assert.equal(detail.body.notifications.length, 5, 'Request, receipt, acceptance and two chat notifications expected');
  const messageNotifications = detail.body.notifications.filter((mail) => mail.kind.includes('message'));
  assert.equal(messageNotifications.length, 2);
  assert.ok(messageNotifications.some((mail) => mail.recipient === 'seedy@sites.test'));
  assert.ok(messageNotifications.some((mail) => mail.recipient === commission.email));
  assert.ok(detail.body.notifications.every((mail) => mail.state === 'unconfigured' && mail.sentAt === null));
});

await test('Recovery is generic and never signs in an unverified email', async () => {
  const known = await anonymous.request('/api/access/recover', { method: 'POST', json: { email: commission.email } }); success(known);
  const unknown = await anonymous.request('/api/access/recover', { method: 'POST', json: { email: `unknown-${runId}@example.test` } }); success(unknown);
  assert.deepEqual(known.body, unknown.body, 'Recovery must not reveal whether an email exists');
  assert.equal(known.body.emailConfigured, false);
  assert.equal(known.headers.get('set-cookie'), null);
  assert.equal(unknown.headers.get('set-cookie'), null);
  const session = await anonymous.request('/api/session'); success(session); assert.equal(session.body.role, 'anonymous');
});

await test('Mail retry requires the owner and a configured provider', async () => {
  status(await client.request('/api/admin/email', { method: 'POST', json: {} }), 403);
  status(await admin.request('/api/admin/email', { method: 'POST', json: {} }), 503);
});

await test('Invalid attachments are rejected before request creation', async () => {
  const forged = submission({ file: false }); forged.append('files', new Blob(['This is not PNG data'], { type: 'image/png' }), 'forged.png');
  status(await anonymous.request('/api/requests', { method: 'POST', form: forged }), 400);
  const executable = submission({ file: false }); executable.append('files', new Blob(['MZ'], { type: 'application/octet-stream' }), 'program.exe');
  status(await anonymous.request('/api/requests', { method: 'POST', form: executable }), 400);
});

await test('Client logout and private-link exchange establish scoped sessions', async () => {
  success(await client.request('/api/access', { method: 'DELETE' }));
  const afterLogout = await client.request('/api/session'); success(afterLogout); assert.equal(afterLogout.body.role, 'anonymous');
  const token = new URL(privatePath, origin).hash.slice('#access='.length);
  status(await client.request('/api/access', { method: 'POST', json: { token }, sameOrigin: false }), 403);
  const access = await client.request('/api/access', { method: 'POST', json: { token } }); success(access);
  assert.match(access.headers.get('set-cookie'), /HttpOnly.*SameSite=Lax/);
  const session = await client.request('/api/session'); success(session); assert.equal(session.body.role, 'client');
  success(await client.request(`/api/requests/${commission.id}`));
  status(await client.request(`/api/requests/${declined.id}`), 404);
  const invalid = await anonymous.request('/api/access', { method: 'POST', json: { token: 'a'.repeat(43) } });
  assert.ok([400, 401, 403, 404].includes(invalid.status), JSON.stringify(invalid.body));
});

await test('Public content and image updates are owner-only', async () => {
  const content = await anonymous.request('/api/site'); success(content); initialContent = content.body;
  status(await client.request('/api/admin/site', { method: 'PUT', json: initialContent }), 403);
  const deniedForm = new FormData(); deniedForm.set('file', new Blob(['image'], { type: 'image/png' }), 'image.png');
  status(await client.request('/api/admin/images', { method: 'POST', form: deniedForm }), 403);
  const svg = new FormData(); svg.set('file', new Blob(['<svg xmlns="http://www.w3.org/2000/svg"></svg>'], { type: 'image/svg+xml' }), 'unsafe.svg');
  status(await admin.request('/api/admin/images', { method: 'POST', form: svg }), 400);
  const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6c0kAAAAASUVORK5CYII=', 'base64');
  const image = new FormData(); image.set('file', new Blob([pngBytes], { type: 'image/png' }), 'qa-project.png');
  const upload = await admin.request('/api/admin/images', { method: 'POST', form: image }); success(upload);
  const imageUrl = upload.body.file.url;
  assert.match(imageUrl, /^\/api\/files\//);
  const publicImage = await anonymous.request(imageUrl); success(publicImage); assert.equal(publicImage.headers.get('content-type'), 'image/png');
  assert.deepEqual(publicImage.bytes, pngBytes, 'Image bytes must survive upload and storage unchanged');
  try {
    const edited = { ...initialContent, brand: 'QA BEDROCK', projects: [{ id: key(), title: 'QA sample project', category: 'Scripting', description: 'Temporary automated verification project.', image: imageUrl, accent: 'green' }] };
    success(await admin.request('/api/admin/site', { method: 'PUT', json: edited }));
    const reread = await anonymous.request('/api/site'); success(reread);
    assert.equal(reread.body.brand, edited.brand);
    assert.equal(reread.body.projects[0].image, imageUrl);
  } finally {
    success(await admin.request('/api/admin/site', { method: 'PUT', json: initialContent }));
  }
});

await test('Owner manages active commissions and revokes client access', async () => {
  const active = await admin.request(`/api/requests/${commission.id}`, { method: 'PATCH', json: { status: 'active' } }); success(active); unsent(active);
  assert.equal(active.body.request.status, 'active');
  const completed = await admin.request(`/api/requests/${commission.id}`, { method: 'PATCH', json: { status: 'completed' } }); success(completed); unsent(completed);
  assert.equal(completed.body.request.status, 'completed');
  status(await admin.request(`/api/requests/${commission.id}`, { method: 'PATCH', json: { status: 'active' } }), 409);
  const revoked = await admin.request(`/api/requests/${commission.id}`, { method: 'DELETE' }); success(revoked);
  assert.equal(revoked.body.revoked, true);
  status(await client.request(`/api/requests/${commission.id}`), 404);
  status(await client.request(attachment.url), 404);
  const token = new URL(privatePath, origin).hash.slice('#access='.length);
  const access = await client.request('/api/access', { method: 'POST', json: { token } });
  assert.ok([400, 401, 403, 404].includes(access.status));
});

process.stdout.write(`\n${passed} integration checks passed against ${origin}.\n`);
process.stdout.write(`Local QA fixtures: ${commission.id}, ${declined.id}. Public content restored. No email provider configured.\n`);

