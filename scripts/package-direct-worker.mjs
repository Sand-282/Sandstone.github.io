import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const server = path.join(root, 'dist/server');
const client = path.join(root, 'dist/client');
const output = path.join(root, 'backend-dist');
const types = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.html': 'text/html; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };

async function files(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) result.push(...await files(path.join(directory, entry.name), relative + '/'));
    else if (entry.isFile()) result.push(relative);
    else throw new Error(`Unsupported build entry: ${relative}`);
  }
  return result.sort();
}

export async function packageWorker({ databaseId, bucketName, siteUrl } = {}) {
  if (!/^[a-f0-9-]{36}$/i.test(databaseId ?? '') || databaseId.startsWith('00000000')) throw new Error('A real D1 database ID is required.');
  const url = new URL(siteUrl);
  if (url.protocol !== 'https:' || url.origin !== siteUrl || url.username || url.password) throw new Error('Use the verified HTTPS Worker origin.');
  if (bucketName && !/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(bucketName)) throw new Error('Invalid upload bucket name.');
  const config = JSON.parse(await readFile(path.join(server, 'wrangler.json'), 'utf8'));
  if (config.main !== 'index.js' || config.services?.length) throw new Error('Unexpected production build configuration.');
  const modules = [];
  for (const name of await files(server)) {
    if (/\.(?:m?js)$/.test(name)) modules.push({ name, content: await readFile(path.join(server, name), 'utf8') });
  }
  const assets = Object.create(null);
  for (const name of await files(client)) {
    if (name.startsWith('.') || name === '_headers') continue;
    const mime = types[path.extname(name)];
    if (!mime) throw new Error(`Unsupported asset format: ${name}`);
    const bytes = await readFile(path.join(client, name));
    const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    assets['/' + name] = { content, mime, etag: '"' + createHash('sha256').update(bytes).digest('hex') + '"' };
  }
  const assetsModule = `const assets = ${JSON.stringify(assets)};\nexport function staticResponse(request) {\n const url = new URL(request.url); const asset = assets[url.pathname];\n if (!asset || !['GET','HEAD'].includes(request.method)) return null;\n const headers = {'Content-Type':asset.mime,'X-Content-Type-Options':'nosniff','ETag':asset.etag,'Cache-Control':url.pathname.startsWith('/_next/static/')?'public, max-age=31536000, immutable':'public, max-age=300'};\n if(request.headers.get('if-none-match')===asset.etag) return new Response(null,{status:304,headers});\n return new Response(request.method==='HEAD'?null:asset.content,{headers});\n}\n`;
  const entry = `import app from './index.js';\nimport { staticResponse } from './sandstone-assets.js';\nexport default { fetch(request,env,ctx) { const asset=staticResponse(request); if(asset) return asset; return app.fetch(request,{...env,ASSETS:{fetch(input){const req=input instanceof Request?input:new Request(input);return staticResponse(req)||new Response('Not found',{status:404});}}},ctx); } };\n`;
  modules.push({ name: 'sandstone-assets.js', content: assetsModule }, { name: 'sandstone-entry.js', content: entry });
  const bindings = [
    { type: 'd1', name: 'DB', database_id: databaseId },
    ...(bucketName ? [{ type: 'r2_bucket', name: 'BUCKET', bucket_name: bucketName }] : []),
    ...Object.entries({ AUTH_MODE: 'standalone', FILE_STORAGE: bucketName ? 'r2' : 'd1', ADMIN_EMAIL: 'cjgsinclare@gmail.com', PAGES_ORIGIN: 'https://sand-282.github.io', SITE_URL: siteUrl }).map(([name,text]) => ({ type:'plain_text', name, text })),
  ];
  const metadata = { main_module:'sandstone-entry.js', compatibility_date:config.compatibility_date, compatibility_flags:config.compatibility_flags, bindings, keep_bindings:['secret_text'], tags:['sandstone-commissions'], observability:{enabled:false} };
  await mkdir(output, { recursive:true });
  await writeFile(path.join(output,'direct-worker.json'), JSON.stringify({ metadata, modules }));
  console.log(`Prepared ${modules.length} modules and ${Object.keys(assets).length} static assets. No credentials included.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await packageWorker({ databaseId:process.argv[2], siteUrl:process.argv[3], bucketName:process.argv[4] });
}
