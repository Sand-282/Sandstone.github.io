import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';

// Execute real route source against SQLite, using the generated migrations and
// an in-memory R2 adapter. No provider credentials or network requests are used.
const sql = new DatabaseSync(':memory:');
for (const file of (await readdir(new URL('../drizzle/', import.meta.url))).filter((name) => name.endsWith('.sql')).sort()) {
  sql.exec(await readFile(new URL(`../drizzle/${file}`, import.meta.url), 'utf8'));
}
const db = {
  prepare(statement) {
    let values = [];
    return {
      bind(...params) { values = params; return this; },
      async first() { return sql.prepare(statement).get(...values) ?? null; },
      async all() { return { results: sql.prepare(statement).all(...values) }; },
      async run() { const result = sql.prepare(statement).run(...values); return { success: true, meta: { changes: Number(result.changes) } }; },
    };
  },
  async batch(statements) {
    sql.exec('BEGIN');
    try { const result = []; for (const statement of statements) result.push(await statement.run()); sql.exec('COMMIT'); return result; }
    catch (error) { sql.exec('ROLLBACK'); throw error; }
  },
};
const objects = new Map();
const storage = {
  async put(key, body) { objects.set(key, await new Response(body).arrayBuffer()); },
  async delete(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key); },
  async get(key) { return objects.has(key) ? { body: objects.get(key) } : null; },
};
const origin = 'https://commissions.example.test';
const pages = 'https://sand-282.github.io';
const password = randomBytes(32).toString('base64url');
const testEnv = { DB: db, BUCKET: storage, AUTH_MODE: 'standalone', ADMIN_EMAIL: 'owner@example.test', ADMIN_PASSWORD: password, PAGES_ORIGIN: pages, SITE_URL: origin };
globalThis.__standaloneSecurityEnv = testEnv;
const actualFetch = globalThis.fetch;
const ActualRequest = globalThis.Request;
// Workers accepts streaming request bodies; Node requires the equivalent
// duplex hint when the real multipart parser reconstructs the bounded stream.
globalThis.Request = class extends ActualRequest {
  constructor(input, init) { super(input, init?.body instanceof ReadableStream ? { ...init, duplex: 'half' } : init); }
};
globalThis.fetch = async () => { throw new Error('Security tests must never contact a provider.'); };

const urls = new Map();
async function moduleUrl(path) {
  if (urls.has(path)) return urls.get(path);
  let source = ts.transpileModule(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  source = source.replace(/import\s*\{\s*env\s*\}\s*from\s*["']cloudflare:workers["'];/, 'const env = globalThis.__standaloneSecurityEnv;');
  for (const [specifier, target] of [['./commission-validation', 'lib/commission-validation.ts'], ['./commissions', 'lib/commissions.ts'], ['@/lib/commission-validation', 'lib/commission-validation.ts'], ['@/lib/commissions', 'lib/commissions.ts'], ['@/lib/commission-files', 'lib/commission-files.ts']]) {
    if (source.includes(`"${specifier}"`) || source.includes(`'${specifier}'`)) source = source.replaceAll(`"${specifier}"`, JSON.stringify(await moduleUrl(target))).replaceAll(`'${specifier}'`, JSON.stringify(await moduleUrl(target)));
  }
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  urls.set(path, url); return url;
}
const lib = await import(await moduleUrl('lib/commissions.ts'));
const auth = await import(await moduleUrl('app/api/admin/auth/route.ts'));
const session = await import(await moduleUrl('app/api/session/route.ts'));
const requests = await import(await moduleUrl('app/api/requests/route.ts'));
const site = await import(await moduleUrl('app/api/site/route.ts'));
const access = await import(await moduleUrl('app/api/access/route.ts'));
const detail = await import(await moduleUrl('app/api/requests/[id]/route.ts'));
const messages = await import(await moduleUrl('app/api/requests/[id]/messages/route.ts'));
const files = await import(await moduleUrl('app/api/files/[id]/route.ts'));
const content = await import(await moduleUrl('app/api/admin/site/route.ts'));
const ownerHeaders = { 'oai-authenticated-user-id': 'forged-owner', 'oai-authenticated-user-email': testEnv.ADMIN_EMAIL };
const context = (id) => ({ params: Promise.resolve({ id }) });
function request(path, { method = 'GET', body, form, headers = {}, requestOrigin = origin, cookie, ip = randomUUID() } = {}) {
  return new Request(`${origin}${path}`, { method, headers: { 'cf-connecting-ip': ip, ...(method !== 'GET' ? { origin: requestOrigin } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : form });
}
const cookiePair = (response) => response.headers.get('set-cookie').split(';')[0];
const asJson = (response) => response.json();
function submission(email = `${randomUUID()}@example.test`, attachment = false) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ name: 'Security test client', email, title: 'Commission security fixture', description: 'An isolated fixture for validating standalone commission access.', budget: '', timeline: '', assets: '', consent: 'true', website: '', idempotencyKey: randomUUID().replaceAll('-', '') })) form.set(key, value);
  if (attachment) form.append('files', new Blob(['Private client attachment']), 'private.txt');
  return form;
}
let checks = 0, ownerCookie, clientCookie, first, second;
async function check(name, operation) { await operation(); checks++; process.stdout.write(`PASS ${name}\n`); }
try {
  await check('Standalone ignores forged Sites identity on session and private listing', async () => {
    const who = await asJson(await session.GET(request('/api/session', { headers: ownerHeaders })));
    assert.equal(who.role, 'anonymous'); assert.equal(who.authentication, 'password');
    assert.equal(who.ADMIN_PASSWORD, undefined); assert.equal(who.ownerEmail, undefined);
    assert.equal((await requests.GET(request('/api/requests', { headers: ownerHeaders }))).status, 401);
    assert.equal((await content.PUT(request('/api/admin/site', { method: 'PUT', body: {}, headers: ownerHeaders }))).status, 403);
  });
  await check('Owner login requires backend same-origin and denies Pages CSRF', async () => {
    for (const requestOrigin of [pages, 'https://evil.example', 'null']) {
      const response = await auth.POST(request('/api/admin/auth', { method: 'POST', body: { email: testEnv.ADMIN_EMAIL, password }, requestOrigin }));
      assert.equal(response.status, 403); assert.equal(response.headers.get('access-control-allow-origin'), null);
    }
    assert.equal((await auth.POST(request('/api/admin/auth', { method: 'POST', body: { email: testEnv.ADMIN_EMAIL, password }, headers: { 'sec-fetch-site': 'cross-site' } }))).status, 403);
    assert.equal(sql.prepare('SELECT count(*) AS count FROM admin_sessions').get().count, 0);
  });
  await check('Wrong credentials receive one generic response and create no session', async () => {
    const wrongEmail = await auth.POST(request('/api/admin/auth', { method: 'POST', body: { email: 'other@example.test', password } }));
    const wrongPassword = await auth.POST(request('/api/admin/auth', { method: 'POST', body: { email: testEnv.ADMIN_EMAIL, password: 'wrong' } }));
    assert.equal(wrongEmail.status, 401); assert.equal(wrongPassword.status, 401);
    assert.deepEqual(await wrongEmail.json(), await wrongPassword.json());
    assert.equal(sql.prepare('SELECT count(*) AS count FROM admin_sessions').get().count, 0);
  });
  await check('Five attempts per 15-minute bucket are checked before valid credentials', async () => {
    const ip = randomUUID();
    for (let i = 0; i < 5; i++) assert.equal((await auth.POST(request('/api/admin/auth', { method: 'POST', ip, body: { email: testEnv.ADMIN_EMAIL, password: 'wrong' } }))).status, 401);
    const sixth = await auth.POST(request('/api/admin/auth', { method: 'POST', ip, body: { email: testEnv.ADMIN_EMAIL, password } }));
    assert.equal(sixth.status, 429); assert.equal(sixth.headers.get('set-cookie'), null);
  });
  await check('Weak or missing provider password cannot establish owner access', async () => {
    testEnv.ADMIN_PASSWORD = 'short';
    assert.equal(lib.adminConfigured(), false);
    assert.equal((await auth.POST(request('/api/admin/auth', { method: 'POST', body: { email: testEnv.ADMIN_EMAIL, password: 'short' } }))).status, 503);
    testEnv.ADMIN_PASSWORD = password;
  });
  await check('Successful login stores only a random token hash with 12-hour expiry', async () => {
    const response = await auth.POST(request('/api/admin/auth', { method: 'POST', body: { email: ' OWNER@example.test ', password } }));
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { loggedIn: true });
    assert.match(response.headers.get('set-cookie'), /Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200/);
    ownerCookie = cookiePair(response);
    const token = ownerCookie.split('=')[1], row = sql.prepare('SELECT * FROM admin_sessions').get();
    assert.match(token, /^[\w-]{43}$/); assert.equal(row.hash, await lib.hash(token)); assert.notEqual(row.hash, token);
    assert.equal(row.owner_email, testEnv.ADMIN_EMAIL); assert.ok(Math.abs(Date.parse(row.expires_at) - Date.now() - 43200000) < 5000);
    assert.equal((await asJson(await session.GET(request('/api/session', { cookie: ownerCookie })))).role, 'admin');
    assert.equal((await requests.GET(request('/api/requests', { cookie: ownerCookie }))).status, 200);
  });
  await check('Public GET CORS reflects only the exact Pages allowlist without credentials', async () => {
    const allowed = await site.GET(request('/api/site', { headers: { origin: pages } }));
    assert.equal(allowed.status, 200); assert.equal(allowed.headers.get('access-control-allow-origin'), pages);
    assert.equal(allowed.headers.get('access-control-allow-credentials'), null); assert.match(allowed.headers.get('vary'), /Origin/);
    for (const denied of ['https://evil.example', 'https://sand-282.github.io.evil.example', 'null']) assert.equal((await site.GET(request('/api/site', { headers: { origin: denied } }))).headers.get('access-control-allow-origin'), null);
  });
  await check('Preflight allows public route method and Content-Type only', async () => {
    const allowed = await requests.OPTIONS(request('/api/requests', { method: 'OPTIONS', requestOrigin: pages, headers: { 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } }));
    assert.equal(allowed.status, 204); assert.equal(allowed.headers.get('access-control-allow-methods'), 'POST'); assert.equal(allowed.headers.get('access-control-allow-credentials'), null);
    assert.equal((await site.OPTIONS(request('/api/site', { method: 'OPTIONS', requestOrigin: pages, headers: { 'access-control-request-method': 'GET' } }))).status, 204);
    for (const headers of [{ 'access-control-request-method': 'DELETE' }, { 'access-control-request-method': 'POST', 'access-control-request-headers': 'oai-authenticated-user-email' }]) {
      const denied = await requests.OPTIONS(request('/api/requests', { method: 'OPTIONS', requestOrigin: pages, headers }));
      assert.equal(denied.status, 403); assert.equal(denied.headers.get('access-control-allow-origin'), null);
    }
  });
  await check('Anonymous Pages submission saves files and returns a backend private link', async () => {
    const response = await requests.POST(request('/api/requests', { method: 'POST', requestOrigin: pages, headers: { 'sec-fetch-site': 'cross-site' }, form: submission(undefined, true) }));
    assert.equal(response.status, 201, await response.clone().text()); assert.equal(response.headers.get('access-control-allow-origin'), pages);
    assert.equal(response.headers.get('set-cookie'), null); assert.equal(response.headers.get('access-control-allow-credentials'), null);
    first = await response.json(); assert.match(first.portalUrl, new RegExp(`^${origin}/portal#access=[\\w-]{43}$`));
    assert.equal(first.email.state, 'unconfigured');
    const receipt = sql.prepare("SELECT body FROM email_outbox WHERE request_id=? AND kind='request-client'").get(first.request.id);
    assert.ok(receipt.body.includes(first.portalUrl)); assert.ok(!receipt.body.includes(origin + origin));
  });
  await check('Allowed Pages receives validation errors; untrusted form origins are denied', async () => {
    const invalid = submission(); invalid.set('consent', 'false');
    const validation = await requests.POST(request('/api/requests', { method: 'POST', requestOrigin: pages, form: invalid }));
    assert.equal(validation.status, 400); assert.equal(validation.headers.get('access-control-allow-origin'), pages);
    const untrusted = await requests.POST(request('/api/requests', { method: 'POST', requestOrigin: 'https://evil.example', form: submission() }));
    assert.equal(untrusted.status, 403); assert.equal(untrusted.headers.get('access-control-allow-origin'), null);
  });
  await check('Portal exchanges access links first-party and cannot exchange from Pages', async () => {
    const token = new URL(first.portalUrl).hash.slice('#access='.length);
    assert.equal((await access.POST(request('/api/access', { method: 'POST', requestOrigin: pages, body: { token } }))).status, 403);
    const response = await access.POST(request('/api/access', { method: 'POST', body: { token } }));
    assert.equal(response.status, 200); clientCookie = cookiePair(response);
    const who = await asJson(await session.GET(request('/api/session', { cookie: clientCookie })));
    assert.equal(who.role, 'client'); assert.equal(who.clientRequestId, first.request.id);
  });
  await check('Client cookies remain scoped; request files and owner actions stay private', async () => {
    const response = await requests.POST(request('/api/requests', { method: 'POST', form: submission() }));
    assert.equal(response.status, 201); second = await response.json();
    const own = await detail.GET(request(`/api/requests/${first.request.id}`, { cookie: clientCookie }), context(first.request.id));
    assert.equal(own.status, 200); const data = await own.json(); assert.equal(data.notifications, undefined); assert.equal(data.files.length, 1);
    assert.equal((await detail.GET(request(`/api/requests/${second.request.id}`, { cookie: clientCookie }), context(second.request.id))).status, 404);
    assert.equal((await detail.GET(request(`/api/requests/${first.request.id}`, { headers: ownerHeaders }), context(first.request.id))).status, 404);
    const fileId = data.files[0].id;
    assert.equal((await files.GET(request(`/api/files/${fileId}`, { headers: ownerHeaders }), context(fileId))).status, 404);
    const download = await files.GET(request(`/api/files/${fileId}`, { cookie: clientCookie }), context(fileId));
    assert.equal(download.status, 200); assert.equal(await download.text(), 'Private client attachment');
    assert.equal((await detail.PATCH(request(`/api/requests/${first.request.id}`, { method: 'PATCH', cookie: clientCookie, body: { status: 'accepted' } }), context(first.request.id))).status, 403);
  });
  await check('Owner acceptance and both chat directions work with standalone sessions', async () => {
    const id = first.request.id;
    assert.equal((await detail.PATCH(request(`/api/requests/${id}`, { method: 'PATCH', requestOrigin: pages, cookie: ownerCookie, body: { status: 'accepted' } }), context(id))).status, 403);
    assert.equal((await detail.PATCH(request(`/api/requests/${id}`, { method: 'PATCH', cookie: ownerCookie, body: { status: 'accepted' } }), context(id))).status, 200);
    for (const [cookie, body] of [[clientCookie, 'Client message'], [ownerCookie, 'Owner response']]) {
      assert.equal((await messages.POST(request(`/api/requests/${id}/messages`, { method: 'POST', cookie, body: { body, idempotencyKey: randomUUID() } }), context(id))).status, 201);
    }
    const data = await asJson(await detail.GET(request(`/api/requests/${id}`, { cookie: clientCookie }), context(id)));
    assert.deepEqual(new Set(data.messages.map((item) => item.sender)), new Set(['client', 'admin']));
    const privateRead = await requests.GET(request('/api/requests', { cookie: ownerCookie, headers: { origin: pages } }));
    assert.equal(privateRead.headers.get('access-control-allow-origin'), null);
  });
  await check('Expiry and owner changes invalidate saved admin cookies', async () => {
    testEnv.ADMIN_EMAIL = 'new-owner@example.test';
    assert.equal((await lib.identity(request('/api/session', { cookie: ownerCookie }))).role, 'anonymous');
    testEnv.ADMIN_EMAIL = 'owner@example.test';
    sql.prepare('UPDATE admin_sessions SET expires_at=?').run(new Date(Date.now() - 1000).toISOString());
    assert.equal((await lib.identity(request('/api/session', { cookie: ownerCookie }))).role, 'anonymous');
    const login = await auth.POST(request('/api/admin/auth', { method: 'POST', body: { email: testEnv.ADMIN_EMAIL, password } }));
    assert.equal(login.status, 200); ownerCookie = cookiePair(login);
  });
  await check('Owner logout revokes the server session and preserves the client session', async () => {
    assert.equal((await auth.DELETE(request('/api/admin/auth', { method: 'DELETE', cookie: ownerCookie, requestOrigin: pages }))).status, 403);
    const logout = await auth.DELETE(request('/api/admin/auth', { method: 'DELETE', cookie: `${ownerCookie}; ${clientCookie}` }));
    assert.equal(logout.status, 200); assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
    assert.equal((await lib.identity(request('/api/session', { cookie: ownerCookie }))).role, 'anonymous');
    assert.equal((await lib.identity(request('/api/session', { cookie: clientCookie }))).role, 'client');
    assert.equal((await requests.GET(request('/api/requests', { cookie: ownerCookie }))).status, 401);
  });
  await check('Sites default remains compatible and password sign-in is unavailable there', async () => {
    delete testEnv.AUTH_MODE;
    const who = await asJson(await session.GET(request('/api/session', { headers: ownerHeaders })));
    assert.equal(who.role, 'admin'); assert.equal(who.authentication, 'chatgpt');
    assert.equal((await auth.POST(request('/api/admin/auth', { method: 'POST', body: { email: testEnv.ADMIN_EMAIL, password } }))).status, 404);
    assert.equal((await site.GET(request('/api/site', { headers: { origin: pages } }))).headers.get('access-control-allow-origin'), null);
    testEnv.AUTH_MODE = 'standalone';
  });
  await check('Unknown auth mode fails closed and malformed allowlist cannot enable CORS', async () => {
    testEnv.AUTH_MODE = 'unexpected';
    assert.equal((await session.GET(request('/api/session', { headers: ownerHeaders }))).status, 503);
    testEnv.AUTH_MODE = 'standalone'; testEnv.PAGES_ORIGIN = 'https://sand-282.github.io/';
    const denied = await site.GET(request('/api/site', { headers: { origin: pages } }));
    assert.equal(denied.status, 503); assert.equal(denied.headers.get('access-control-allow-origin'), null);
    testEnv.PAGES_ORIGIN = pages;
  });
} finally {
  globalThis.fetch = actualFetch; globalThis.Request = ActualRequest; delete globalThis.__standaloneSecurityEnv; sql.close();
}
process.stdout.write(`\n${checks} standalone security checks passed. No live email or provider requests were made.\n`);
