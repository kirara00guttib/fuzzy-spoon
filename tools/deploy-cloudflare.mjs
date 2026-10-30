// 一条命令把站点部署到 Cloudflare Workers（KV + R2）
//
//   node tools/deploy-cloudflare.mjs            # 真正部署
//   node tools/deploy-cloudflare.mjs --check    # 只检查登录状态和配置
//
// 前置：
//   1) npx wrangler login            （会打开浏览器让你点 Allow，只需一次）
//   2) .env 里填好 USER1_PASS / USER2_PASS / R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');
const WRANGLER = ['--yes', 'wrangler@3'];

function run(args, { input, quiet = false } = {}) {
  const res = spawnSync('npx', [...WRANGLER, ...args], {
    cwd: root,
    encoding: 'utf8',
    input,
    shell: process.platform === 'win32',
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
  if (!quiet && res.stdout) process.stdout.write(res.stdout);
  if (res.stderr && (res.status !== 0 || !quiet)) process.stderr.write(res.stderr);
  return res;
}

function readEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = readEnvFile(path.join(root, '.env'));
const need = ['USER1_PASS', 'USER2_PASS'];
const r2Keys = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'];
const hasR2 = r2Keys.every((k) => env[k]);
if (!hasR2) console.log('⚠ 没配 R2（照片功能暂时不可用），只部署文字部分。');
const missing = need.filter((k) => !env[k]);
if (missing.length) {
  console.error('❌ .env 里还缺这些，先填好再部署：\n   ' + missing.join('\n   '));
  process.exit(1);
}

// 1) 登录状态
console.log('① 检查 Cloudflare 登录状态…');
const who = run(['whoami'], { quiet: true });
if (who.status !== 0 || /not authenticated|You are not authenticated/i.test(who.stdout + who.stderr)) {
  console.error('❌ 还没登录。先运行：\n   npx wrangler login\n（会弹浏览器，点 Allow 就好）');
  process.exit(1);
}
process.stdout.write(who.stdout.split('\n').slice(0, 6).join('\n') + '\n');

// 2) KV 命名空间
console.log('\n② 准备 KV 命名空间（文字数据）…');
const kvList = run(['kv:namespace', 'list'], { quiet: true });
let kvId = null;
const mine = (kvList.stdout || '').match(/"title"\s*:\s*"riji-store"[\s\S]*?"id"\s*:\s*"([a-f0-9]+)"/);
if (mine) {
  kvId = mine[1];
  console.log('   已有 riji-store：' + kvId);
} else if (!checkOnly) {
  const created = run(['kv:namespace', 'create', 'riji-store'], { quiet: true });
  const m = (created.stdout + created.stderr).match(/id\s*=\s*"([a-f0-9]+)"/);
  if (!m) {
    console.error('❌ 创建 KV 失败：\n' + created.stdout + created.stderr);
    process.exit(1);
  }
  kvId = m[1];
  console.log('   新建 riji-store：' + kvId);
}

// 写回 wrangler.toml
if (kvId) {
  const tomlPath = path.join(root, 'wrangler.toml');
  const toml = fs.readFileSync(tomlPath, 'utf8');
  const next = toml.replace(/id\s*=\s*"[^"]*"/, `id = "${kvId}"`);
  if (next !== toml) {
    fs.writeFileSync(tomlPath, next, 'utf8');
    console.log('   wrangler.toml 里的 KV id 已更新');
  }
}

// 3) R2 桶
if (!hasR2) {
  console.log('\n③ 跳过 R2（没配置）');
} else {
console.log('\n③ 准备 R2 桶…');
const bucket = env.R2_BUCKET;
const buckets = run(['r2', 'bucket', 'list'], { quiet: true });
if ((buckets.stdout || '').includes(bucket)) {
  console.log('   桶已存在：' + bucket);
} else if (!checkOnly) {
  const created = run(['r2', 'bucket', 'create', bucket], { quiet: true });
  if (created.status !== 0 && !/already/i.test(created.stdout + created.stderr)) {
    console.warn('   创建桶没成功（可能账户没开通 R2），错误：\n' + created.stderr);
  } else {
    console.log('   新建桶：' + bucket);
  }
}
}

// 4) 密钥
console.log('\n④ 写入密钥（不会出现在代码里）…');
const secrets = {
  USER1_PASS: env.USER1_PASS,
  USER2_PASS: env.USER2_PASS,
  AUTH_SECRET: env.AUTH_SECRET || crypto.randomUUID() + crypto.randomUUID(),
};
if (hasR2) {
  Object.assign(secrets, {
    R2_ACCOUNT_ID: env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY,
    R2_BUCKET: env.R2_BUCKET,
  });
}
if (checkOnly) {
  console.log('   （--check 模式，不写密钥）');
} else {
  for (const [name, value] of Object.entries(secrets)) {
    const res = run(['secret', 'put', name], { input: value + '\n', quiet: true });
    console.log(`   ${res.status === 0 ? '✓' : '✗'} ${name}`);
  }
}

// 5) 部署
if (checkOnly) {
  console.log('\n✅ 检查通过。去掉 --check 就会真正部署。');
  process.exit(0);
}
console.log('\n⑤ 部署…');
const deploy = run(['deploy']);
if (deploy.status !== 0) {
  console.error('\n❌ 部署失败，看上面的报错。常见原因：wrangler.toml 里的 KV id 没对、账户没开通 R2。');
  process.exit(1);
}

const url = ((deploy.stdout || '') + (deploy.stderr || '')).match(/https:\/\/[\w.-]+\.workers\.dev/);
console.log('\n🎉 上线了' + (url ? '：' + url[0] : ''));
console.log('\n最后一步（只做一次）：去 R2 控制台给桶配 CORS，把上面这个域名加进 AllowedOrigins，否则手机/浏览器直传照片会被拦。');
console.log('   R2 → 你的桶 → Settings → CORS Policy');
