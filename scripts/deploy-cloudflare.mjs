import { appendFileSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const WORKER_NAME = 'sandstone-commissions';
export const DATABASE_NAME = 'sandstone-commissions-db';
export const BUCKET_NAME = 'sandstone-commissions-uploads';
export const GMAIL_BRIDGE_URL = 'https://script.google.com/macros/s/AKfycby5D5hzA9zQASCYQequPhgaRfTnQh9LFg3fSu68pezLMj-7YVQVjcM5_CVg8i5C3-1k6g/exec';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLACEHOLDER_UUID = '00000000-0000-4000-8000-000000000000';

export function readSettings(env = process.env) {
  const token = env.CLOUDFLARE_API_TOKEN?.trim();
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const password = env.ADMIN_PASSWORD;
  if (!token) throw new Error('Add the CLOUDFLARE_API_TOKEN repository secret before publishing the commission system.');
  if (!/^[a-f0-9]{32}$/i.test(accountId ?? '')) throw new Error('Add a valid CLOUDFLARE_ACCOUNT_ID repository secret (the 32-character account ID).');
  if (typeof password !== 'string' || password.trim().length < 14 || password.length > 256) {
    throw new Error('Add ADMIN_PASSWORD as a repository secret: use a unique password of 14–256 characters.');
  }
  const adminEmail = env.ADMIN_EMAIL?.trim() || 'cjgsinclare@gmail.com';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail) || adminEmail.length > 254) throw new Error('ADMIN_EMAIL must be a valid owner email address.');
  const pagesInput = env.PUBLIC_PAGES_ORIGIN?.trim() || 'https://sand-282.github.io';
  let pages;
  try { pages = new URL(pagesInput); } catch { throw new Error('PUBLIC_PAGES_ORIGIN must be an HTTPS origin.'); }
  if (pages.protocol !== 'https:' || pages.username || pages.password || pages.pathname !== '/' || pages.search || pages.hash) {
    throw new Error('PUBLIC_PAGES_ORIGIN must be an HTTPS origin without a path, credentials, query, or fragment.');
  }
  const emailFrom = env.EMAIL_FROM?.trim() || '';
  const resendKey = env.RESEND_API_KEY?.trim() || '';
  if (Boolean(emailFrom) !== Boolean(resendKey)) throw new Error('For email delivery, add both EMAIL_FROM and RESEND_API_KEY, or leave both unset.');
  if (emailFrom && (emailFrom.length > 320 || /[\r\n]/.test(emailFrom) || !emailFrom.includes('@'))) throw new Error('EMAIL_FROM must be an address on your verified sending domain.');
  return { token, accountId, password, adminEmail, pagesOrigin: pages.origin, emailFrom, resendKey };
}

export function cloudflareApi(settings, transport = fetch) {
  return async function api(method, endpoint, body) {
    let response;
    try {
      response = await transport(`https://api.cloudflare.com/client/v4/accounts/${settings.accountId}${endpoint}`, {
        method,
        headers: { Authorization: `Bearer ${settings.token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch { throw new Error('Cloudflare could not be reached. Check connectivity and try again.'); }
    let data;
    try { data = await response.json(); } catch { throw new Error(`Cloudflare returned an unreadable response (HTTP ${response.status}).`); }
    if (!response.ok || data.success !== true) {
      const codes = Array.isArray(data.errors) ? data.errors.map(error => Number(error.code)).filter(Number.isFinite).join(', ') : '';
      // Never echo API response bodies: they can contain submitted data or credentials.
      throw new Error(`Cloudflare rejected the ${method} request (HTTP ${response.status}${codes ? `; codes ${codes}` : ''}). Check token permissions and account setup.`);
    }
    return data.result;
  };
}

export async function provisionResources(api) {
  const domain = await api('GET', '/workers/subdomain');
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(domain?.subdomain ?? '')) {
    throw new Error('Choose a workers.dev subdomain in Cloudflare Workers & Pages settings, then run this workflow again.');
  }
  const siteUrl = `https://${WORKER_NAME}.${domain.subdomain}.workers.dev`;
  const databases = await api('GET', `/d1/database?name=${DATABASE_NAME}&per_page=10000`);
  if (!Array.isArray(databases)) throw new Error('Cloudflare returned an unexpected database list.');
  const matches = databases.filter(database => database.name === DATABASE_NAME);
  if (matches.length > 1) throw new Error('More than one matching database exists; select the intended database before publishing.');
  const database = matches[0] ?? await api('POST', '/d1/database', { name: DATABASE_NAME });
  if (!UUID.test(database?.uuid ?? '') || database.uuid === PLACEHOLDER_UUID) throw new Error('Cloudflare did not return a real D1 database ID. Publishing stopped.');
  return { databaseId: database.uuid, siteUrl };
}

export function prepareConfig(settings, resources, root = ROOT) {
  const configPath = path.join(root, 'dist/server/wrangler.json');
  if (!existsSync(configPath)) throw new Error('Build the application first; dist/server/wrangler.json is missing.');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const serverRoot = path.dirname(configPath);
  if (config.main !== 'index.js' || !existsSync(path.join(serverRoot, config.main)) || config.assets?.directory !== '../client' || !existsSync(path.join(root, 'dist/client'))) {
    throw new Error('The generated application entry point or client asset directory changed. Review the build output before publishing.');
  }
  if (config.d1_databases?.length !== 1 || config.d1_databases[0].binding !== 'DB' || config.r2_buckets?.length !== 1 || config.r2_buckets[0].binding !== 'BUCKET') {
    throw new Error('The application must retain exactly the DB and BUCKET hosting bindings. Review .openai/hosting.json and rebuild.');
  }
  if ((config.services?.length ?? 0) !== 0) throw new Error('A local preview service remains in the production build. Review the generated configuration.');
  if (!UUID.test(resources.databaseId) || resources.databaseId === PLACEHOLDER_UUID) throw new Error('A real D1 database ID is required.');
  const migrationsRoot = path.join(root, 'drizzle');
  const migrationFiles = readdirSync(migrationsRoot).filter(file => /^\d+_[A-Za-z0-9_-]+\.sql$/.test(file));
  if (!migrationFiles.length || migrationFiles.length > 100 || migrationFiles.some(file => statSync(path.join(migrationsRoot, file)).size > 2_000_000)) {
    throw new Error('Review the SQL migrations: expected 1–100 numbered files, each under 2 MB.');
  }
  config.name = WORKER_NAME;
  config.topLevelName = WORKER_NAME;
  config.account_id = settings.accountId;
  config.workers_dev = true;
  config.preview_urls = false;
  config.vars = {
    AUTH_MODE: 'standalone',
    FILE_STORAGE: 'd1',
    ADMIN_EMAIL: settings.adminEmail,
    PAGES_ORIGIN: settings.pagesOrigin,
    SITE_URL: resources.siteUrl,
    EMAIL_FROM: settings.emailFrom,
    GMAIL_BRIDGE_URL,
  };
  config.d1_databases = [{ binding: 'DB', database_name: DATABASE_NAME, database_id: resources.databaseId, migrations_dir: '../../drizzle' }];
  config.r2_buckets = []; // Free D1 attachment storage requires no R2 subscription.
  // Only this disposable build output is changed. Source hosting bindings stay intact.
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return configPath;
}

export async function runWrangler(args, { settings, input, quiet = false, root = ROOT } = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'node_modules/wrangler/bin/wrangler.js'), ...args], {
      cwd: root,
      env: { ...process.env, CLOUDFLARE_API_TOKEN: settings.token, CLOUDFLARE_ACCOUNT_ID: settings.accountId, CI: 'true', WRANGLER_SEND_METRICS: 'false', WRANGLER_WRITE_LOGS: 'false', WRANGLER_LOG: 'warn' },
      stdio: ['pipe', quiet ? 'ignore' : 'inherit', quiet ? 'ignore' : 'inherit'],
    });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Cloudflare publishing timed out. Check the Cloudflare dashboard before retrying.')); }, 8 * 60_000);
    child.on('error', () => { clearTimeout(timer); reject(new Error('Could not start Wrangler. Install dependencies with npm ci first.')); });
    child.on('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Wrangler ${args[0]} failed. Review Cloudflare account permissions and the workflow logs.`)); });
    child.stdin.on('error', () => {});
    child.stdin.end(input ?? '');
  });
}

export async function verifyDeployment(settings, resources, transport = fetch) {
  const options = { headers: { Origin: settings.pagesOrigin }, signal: AbortSignal.timeout(20_000), redirect: 'error' };
  let site, session, privateRequests;
  try {
    const siteResponse = await transport(`${resources.siteUrl}/api/site`, options);
    if (!siteResponse.ok || siteResponse.headers.get('access-control-allow-origin') !== settings.pagesOrigin) throw new Error();
    site = await siteResponse.json();
    const sessionResponse = await transport(`${resources.siteUrl}/api/session`, { signal: AbortSignal.timeout(20_000), redirect: 'error' });
    if (!sessionResponse.ok) throw new Error();
    session = await sessionResponse.json();
    privateRequests = await transport(`${resources.siteUrl}/api/requests`, { signal: AbortSignal.timeout(20_000), redirect: 'error' });
  } catch { throw new Error('The application was uploaded, but its live checks could not complete. Check the Cloudflare deployment before connecting GitHub Pages.'); }
  if (site?.readiness?.database !== true || site.readiness.uploads !== true || site.readiness.admin !== true || session?.authentication !== 'password' || session.adminConfigured !== true || ![401, 403].includes(privateRequests.status)) {
    throw new Error('The application was uploaded, but storage, password authentication, or private-access checks failed. Review the deployment before connecting GitHub Pages.');
  }
}

export async function deploy({ env = process.env, transport = fetch, runner = runWrangler, root = ROOT, log = console.log } = {}) {
  const settings = readSettings(env);
  const api = cloudflareApi(settings, transport);
  log('Checking Cloudflare account and reusing or creating commission storage.');
  const resources = await provisionResources(api);
  const configPath = prepareConfig(settings, resources, root);
  const secrets = { ADMIN_PASSWORD: settings.password, ...(settings.resendKey ? { RESEND_API_KEY: settings.resendKey } : {}) };
  log('Installing owner credentials before publishing application code.');
  // stdin avoids command-line arguments, temporary files, and secret-bearing logs.
  await runner(['secret', 'bulk', '--config', configPath], { settings, input: `${JSON.stringify(secrets)}\n`, quiet: true, root });
  log('Applying pending database migrations.');
  await runner(['d1', 'migrations', 'apply', 'DB', '--remote', '--config', configPath], { settings, root });
  log('Publishing the secured application.');
  await runner(['deploy', '--config', configPath], { settings, root });
  log('Checking live storage, owner authentication, and private access.');
  await verifyDeployment(settings, resources, transport);
  log(`Commission system deployed: ${resources.siteUrl}`);
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `backend_url=${resources.siteUrl}\n`);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `## Commission system published\n\n[Open commission system](${resources.siteUrl}) · [Owner sign-in](${resources.siteUrl}/admin)\n\nAdd repository variable **BACKEND_URL** = \`${resources.siteUrl}\`, then rerun **Publish public website**.\n\n${settings.resendKey ? 'Email provider credentials are configured. Send a controlled test to verify delivery.' : 'Email delivery is not configured. Saved requests and private links work; notifications remain unsent.'}\n`);
  return resources;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.includes('--check')) {
      const settings = readSettings();
      console.log(`Required setup is present. Email delivery ${settings.resendKey ? 'has credentials; verify with a controlled test after publishing' : 'remains disabled until both email settings are added'}.`);
    } else await deploy();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Publishing failed.');
    process.exitCode = 1;
  }
}

