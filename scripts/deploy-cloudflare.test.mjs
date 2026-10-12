import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { BUCKET_NAME, DATABASE_NAME, WORKER_NAME, cloudflareApi, deploy, readSettings } from './deploy-cloudflare.mjs';

const databaseId = '12345678-1234-4234-9234-123456789abc';
const env = { CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CLOUDFLARE_API_TOKEN: 'test-cloudflare-token-never-real', ADMIN_PASSWORD: 'test-only-password-123456', PUBLIC_PAGES_ORIGIN: 'https://sand-282.github.io' };

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sandstone-hosting-test-'));
  mkdirSync(path.join(root, 'dist/server'), { recursive: true });
  mkdirSync(path.join(root, 'dist/client'), { recursive: true });
  mkdirSync(path.join(root, 'drizzle'));
  writeFileSync(path.join(root, 'dist/server/index.js'), 'export default {};');
  writeFileSync(path.join(root, 'drizzle/0000_fixture.sql'), 'CREATE TABLE fixture (id TEXT);');
  writeFileSync(path.join(root, 'dist/server/wrangler.json'), JSON.stringify({ name: 'starter', main: 'index.js', no_bundle: true, assets: { directory: '../client' }, vars: {}, d1_databases: [{ binding: 'DB', database_id: '00000000-0000-4000-8000-000000000000' }], r2_buckets: [{ binding: 'BUCKET', bucket_name: 'starter-r2' }], services: [] }));
  return root;
}

function removeFixture(root) {
  const resolved = path.resolve(root);
  const tempRoot = path.resolve(os.tmpdir());
  if (path.dirname(resolved) !== tempRoot || !path.basename(resolved).startsWith('sandstone-hosting-test-')) throw new Error('Refusing to remove a directory outside this test fixture.');
  rmSync(resolved, { recursive: true, force: true });
}

function mockTransport({ existing = false, publicBucket = false, publicRequests = false } = {}) {
  const calls = [];
  const transport = async (url, options) => {
    if (new URL(url).hostname.endsWith('.workers.dev')) {
      const route = new URL(url).pathname;
      if (route === '/api/site') return { ok: true, headers: new Headers({ 'access-control-allow-origin': 'https://sand-282.github.io' }), json: async () => ({ readiness: { database: true, uploads: true, admin: true } }) };
      if (route === '/api/session') return { ok: true, json: async () => ({ authentication: 'password', adminConfigured: true }) };
      if (route === '/api/requests') return { status: publicRequests ? 200 : 401 };
      assert.fail(`Unexpected application route: ${route}`);
    }
    const endpoint = new URL(url).pathname.replace(`/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}`, '');
    calls.push({ method: options.method, endpoint, body: options.body });
    let result;
    if (endpoint === '/workers/subdomain') result = { subdomain: 'my-cloudflare-account' };
    else if (endpoint === '/d1/database' && options.method === 'GET') result = existing ? [{ name: DATABASE_NAME, uuid: databaseId }] : [];
    else if (endpoint === '/d1/database' && options.method === 'POST') result = { name: DATABASE_NAME, uuid: databaseId };
    else if (endpoint === '/r2/buckets' && options.method === 'GET') result = { buckets: existing ? [{ name: BUCKET_NAME }] : [] };
    else if (endpoint === '/r2/buckets' && options.method === 'POST') result = { name: BUCKET_NAME };
    else if (endpoint.endsWith('/domains/managed')) result = { enabled: publicBucket };
    else if (endpoint.endsWith('/domains/custom')) result = { domains: [] };
    else assert.fail(`Unexpected API call: ${options.method} ${endpoint}`);
    return { ok: true, status: 200, json: async () => ({ success: true, result }) };
  };
  return { transport, calls };
}

test('missing credentials and short password stop before any remote action', async () => {
  let called = false;
  await assert.rejects(deploy({ env: {}, transport: () => { called = true; }, log: () => {} }), /CLOUDFLARE_API_TOKEN/);
  assert.equal(called, false);
  assert.throws(() => readSettings({ ...env, ADMIN_PASSWORD: 'too-short' }), /ADMIN_PASSWORD/);
  assert.throws(() => readSettings({ ...env, ADMIN_PASSWORD: 'a'.repeat(13) }), /ADMIN_PASSWORD/);
  assert.equal(readSettings({ ...env, ADMIN_PASSWORD: 'a'.repeat(14) }).password.length, 14);
  assert.throws(() => readSettings({ ...env, PUBLIC_PAGES_ORIGIN: 'https://sand-282.github.io/Sandstone.github.io/' }), /without a path/);
  assert.throws(() => readSettings({ ...env, EMAIL_FROM: 'commissions@example.test' }), /both EMAIL_FROM and RESEND_API_KEY/);
});

test('first deployment uses real resource IDs and installs secrets before code', async () => {
  const root = fixture();
  const mock = mockTransport();
  const commands = [];
  const logs = [];
  try {
    const resources = await deploy({ env, root, transport: mock.transport, runner: async (args, options) => { commands.push({ args, options }); }, log: message => logs.push(message) });
    assert.equal(resources.siteUrl, `https://${WORKER_NAME}.my-cloudflare-account.workers.dev`);
    assert.equal(mock.calls.filter(call => call.method === 'POST').length, 1);
    assert.ok(!mock.calls.some(call => call.endpoint.startsWith('/r2/')));
    assert.deepEqual(commands.map(command => command.args[0]), ['secret', 'd1', 'deploy']);
    assert.equal(commands[0].options.quiet, true);
    assert.deepEqual(JSON.parse(commands[0].options.input), { ADMIN_PASSWORD: env.ADMIN_PASSWORD });
    assert.ok(commands[1].args.includes('--remote'));
    const config = JSON.parse(readFileSync(path.join(root, 'dist/server/wrangler.json'), 'utf8'));
    assert.equal(config.d1_databases[0].database_id, databaseId);
    assert.equal(config.d1_databases[0].migrations_dir, '../../drizzle');
    assert.deepEqual(config.r2_buckets, []);
    assert.equal(config.vars.FILE_STORAGE, 'd1');
    assert.equal(config.vars.AUTH_MODE, 'standalone');
    assert.equal(config.vars.SITE_URL, resources.siteUrl);
    assert.equal(config.vars.PAGES_ORIGIN, 'https://sand-282.github.io');
    assert.equal(config.main, 'index.js');
    assert.equal(config.assets.directory, '../client');
    assert.equal(config.no_bundle, true);
    assert.ok(!JSON.stringify(config).includes(env.ADMIN_PASSWORD));
    assert.ok(!logs.join('\n').includes(env.ADMIN_PASSWORD));
    assert.ok(!JSON.stringify(commands.map(command => command.args)).includes(env.ADMIN_PASSWORD));
  } finally { removeFixture(root); }
});

test('later deployments reuse storage without deleting or recreating it', async () => {
  const root = fixture();
  const mock = mockTransport({ existing: true });
  try {
    await deploy({ env, root, transport: mock.transport, runner: async () => {}, log: () => {} });
    assert.equal(mock.calls.filter(call => call.method !== 'GET').length, 0);
  } finally { removeFixture(root); }
});

test('free deployment never activates or uses R2', async () => {
  const root = fixture(); const mock = mockTransport({ existing: true, publicBucket: true });
  try { await deploy({ env, root, transport:mock.transport, runner:async()=>{}, log:()=>{} }); assert.ok(!mock.calls.some(call=>call.endpoint.startsWith('/r2/'))); } finally { removeFixture(root); }
});

test('failed secret upload prevents migrations and application deployment', async () => {
  const root = fixture();
  const mock = mockTransport({ existing: true });
  const commands = [];
  try {
    await assert.rejects(deploy({ env, root, transport: mock.transport, runner: async args => { commands.push(args[0]); throw new Error('Mock secret upload failure'); }, log: () => {} }), /Mock secret upload failure/);
    assert.deepEqual(commands, ['secret']);
  } finally { removeFixture(root); }
});

test('live check rejects a backend that exposes commission records without authentication', async () => {
  const root = fixture();
  const mock = mockTransport({ existing: true, publicRequests: true });
  try {
    await assert.rejects(deploy({ env, root, transport: mock.transport, runner: async () => {}, log: () => {} }), /private-access checks failed/);
  } finally { removeFixture(root); }
});

test('API failure messages omit echoed credentials and response data', async () => {
  const settings = readSettings(env);
  const api = cloudflareApi(settings, async () => ({ ok: false, status: 403, json: async () => ({ success: false, errors: [{ code: 10000, message: env.CLOUDFLARE_API_TOKEN }], secret: env.ADMIN_PASSWORD }) }));
  await assert.rejects(api('GET', '/workers/subdomain'), error => {
    assert.match(error.message, /HTTP 403; codes 10000/);
    assert.ok(!error.message.includes(env.CLOUDFLARE_API_TOKEN));
    assert.ok(!error.message.includes(env.ADMIN_PASSWORD));
    return true;
  });
});

