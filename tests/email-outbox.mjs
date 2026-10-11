import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Exercise the real delivery function with an in-memory DB adapter and a mocked
// HTTP provider. No credentials or network access are used by this runner.
const compile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const validation = compile(await readFile(new URL('../lib/commission-validation.ts', import.meta.url), 'utf8'));
const validationUrl = `data:text/javascript;base64,${Buffer.from(validation).toString('base64')}`;
let source = compile(await readFile(new URL('../lib/commissions.ts', import.meta.url), 'utf8'));
source = source.replace(/import\s*\{\s*env\s*\}\s*from\s*["']cloudflare:workers["'];/, 'const env = globalThis.__commissionMailTestEnv;');
source = source.replace(/from\s*["']\.\/commission-validation["']/g, `from ${JSON.stringify(validationUrl)}`);

let record;
const database = {
  prepare(sql) {
    let values = [];
    return {
      bind(...params) { values = params; return this; },
      async first() {
        if (sql.startsWith('UPDATE email_outbox SET state=\'sending\'')) {
          const [now, id, staleLease] = values;
          if (!record || record.id !== id || !( ['pending', 'failed', 'unconfigured'].includes(record.state) || (record.state === 'sending' && record.last_attempt_at < staleLease))) return null;
          record.state = 'sending'; record.attempts++; record.last_attempt_at = now;
          return { ...record };
        }
        if (sql.startsWith('SELECT state FROM email_outbox')) return record ? { state: record.state } : null;
        throw new Error(`Unexpected read: ${sql}`);
      },
      async run() {
        if (sql.startsWith('UPDATE email_outbox SET state=\'sent\'')) {
          record.state = 'sent'; record.provider_id = values[0]; record.sent_at = values[1]; record.body = ''; record.error = null;
        } else if (sql.startsWith('UPDATE email_outbox SET state=\'failed\'')) {
          record.state = 'failed'; record.error = values[0]; record.next_attempt_at = values[1];
        } else throw new Error(`Unexpected update: ${sql}`);
        return { success: true };
      },
    };
  },
};
const testEnv = { DB: database, ADMIN_EMAIL: 'owner@example.test', RESEND_API_KEY: 'mock-key-for-unit-tests-only', EMAIL_FROM: 'sandstone <commissions@example.test>' };
globalThis.__commissionMailTestEnv = testEnv;
const actualFetch = globalThis.fetch;
const { deliverMail } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const fresh = (state = 'pending') => ({ id: 'local-email-test', recipient: 'client@example.test', subject: 'Test commission notification', body: 'Private commission message', reply_to: 'owner@example.test', state, attempts: 0, last_attempt_at: null, sent_at: null, provider_id: null, error: null });
let checks = 0;
async function test(name, run) { await run(); checks++; process.stdout.write(`PASS ${name}\n`); }

try {
  await test('Successful email validates provider confirmation and clears private body', async () => {
    record = fresh(); let calls = 0;
    globalThis.fetch = async (url, options) => {
      calls++; assert.equal(url, 'https://api.resend.com/emails'); assert.equal(options.method, 'POST');
      assert.equal(options.headers.Authorization, 'Bearer mock-key-for-unit-tests-only');
      assert.equal(options.headers['Idempotency-Key'], 'bedrock-local-email-test');
      assert.deepEqual(JSON.parse(options.body), { from: testEnv.EMAIL_FROM, to: [record.recipient], subject: record.subject, text: record.body, reply_to: record.reply_to });
      return Response.json({ id: 'mock-provider-id' });
    };
    assert.equal((await deliverMail(record.id)).state, 'sent');
    assert.equal(record.state, 'sent'); assert.equal(record.provider_id, 'mock-provider-id'); assert.equal(record.body, ''); assert.ok(record.sent_at);
    assert.equal((await deliverMail(record.id)).state, 'sent'); assert.equal(calls, 1, 'Delivered outbox records must not be sent twice');
  });

  await test('Provider rejection retains the message and schedules a truthful retry', async () => {
    record = fresh();
    globalThis.fetch = async () => Response.json({ message: 'Test rejection' }, { status: 429 });
    assert.equal((await deliverMail(record.id)).state, 'failed');
    assert.equal(record.body, 'Private commission message'); assert.equal(record.sent_at, null); assert.equal(record.attempts, 1);
    assert.match(record.error, /429/); assert.ok(Date.parse(record.next_attempt_at) > Date.now());
  });

  await test('A response without a provider ID cannot be reported as sent', async () => {
    record = fresh(); globalThis.fetch = async () => Response.json({});
    assert.equal((await deliverMail(record.id)).state, 'failed'); assert.equal(record.sent_at, null); assert.notEqual(record.body, '');
  });

  await test('Network failure keeps durable content and retry uses the same provider key', async () => {
    record = fresh(); const keys = [];
    globalThis.fetch = async (_url, options) => { keys.push(options.headers['Idempotency-Key']); throw new Error('Mock response lost'); };
    assert.equal((await deliverMail(record.id)).state, 'failed');
    globalThis.fetch = async (_url, options) => { keys.push(options.headers['Idempotency-Key']); return Response.json({ id: 'mock-retry-provider-id' }); };
    assert.equal((await deliverMail(record.id)).state, 'sent'); assert.deepEqual(keys, ['bedrock-local-email-test', 'bedrock-local-email-test']);
  });

  await test('An active delivery lease prevents concurrent duplicate sends', async () => {
    record = fresh('sending'); record.last_attempt_at = new Date().toISOString();
    globalThis.fetch = async () => { throw new Error('Active lease must not reach provider'); };
    assert.equal((await deliverMail(record.id)).state, 'sending'); assert.equal(record.attempts, 0);
  });

  await test('A delivery interrupted over two minutes ago can be recovered', async () => {
    record = fresh('sending'); record.last_attempt_at = new Date(Date.now() - 180_000).toISOString();
    globalThis.fetch = async () => Response.json({ id: 'mock-recovered-provider-id' });
    assert.equal((await deliverMail(record.id)).state, 'sent'); assert.equal(record.attempts, 1);
  });

  await test('Missing configuration never contacts the provider or claims success', async () => {
    record = fresh('unconfigured'); delete testEnv.RESEND_API_KEY;
    globalThis.fetch = async () => { throw new Error('Unconfigured delivery must not reach provider'); };
    assert.equal((await deliverMail(record.id)).state, 'unconfigured'); assert.equal(record.state, 'unconfigured'); assert.equal(record.attempts, 0); assert.equal(record.sent_at, null);
  });
} finally {
  globalThis.fetch = actualFetch;
  delete globalThis.__commissionMailTestEnv;
}
process.stdout.write(`\n${checks} email-outbox checks passed with a mocked provider. No live email was sent.\n`);
