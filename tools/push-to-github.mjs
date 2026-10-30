// 不用装 git，直接调 GitHub API 把整个项目推上去
//
// 用法：
//   node tools/push-to-github.mjs --repo 你的用户名/仓库名 --token ghp_xxx [--branch main] [--dry]
//
// 令牌权限：经典令牌勾 repo；细粒度令牌给 Contents: Read and write。
// 会自动跳过 .env / data / .dev.vars / .wrangler / .preview / node_modules 等。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (name, fallback = '') => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

const repo = arg('repo');
const token = arg('token') || process.env.GITHUB_TOKEN || '';
const branch = arg('branch', 'main');
const dry = args.includes('--dry');
const message = arg('message', '日记本：Cloudflare 版（Worker + KV + R2 预签名）');

if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
  console.error('用法：node tools/push-to-github.mjs --repo 用户名/仓库名 --token <token> [--branch main] [--dry]');
  process.exit(1);
}
if (!token) {
  console.error('缺少 --token（或环境变量 GITHUB_TOKEN）');
  process.exit(1);
}

const SKIP_DIRS = new Set(['node_modules', 'data', '.preview', '.wrangler', 'backups', '.git', '.hallmark', '.taste-skill']);
const SKIP_FILES = new Set(['.env', '.dev.vars', 'package-lock.json']);
const MAX_FILE = 5 * 1024 * 1024;

function walk(dir, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...walk(path.join(dir, entry.name), rel));
    } else if (entry.isFile()) {
      if (SKIP_FILES.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const size = fs.statSync(full).size;
      if (size > MAX_FILE) {
        console.warn(`跳过（超过 5MB）：${rel}`);
        continue;
      }
      out.push({ rel, full, size });
    }
  }
  return out;
}

const api = async (method, url, body) => {
  const res = await fetch(`https://api.github.com${url}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'riji-deploy',
      'x-github-api-version': '2022-11-28',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const hint = res.status === 401 ? '（令牌无效或过期）' : res.status === 403 ? '（权限不够，经典令牌要勾 repo）' : '';
    throw new Error(`${method} ${url} → ${res.status} ${hint} ${data?.message || text.slice(0, 200)}`);
  }
  return data;
};

const files = walk(root);
const total = files.reduce((s, f) => s + f.size, 0);
console.log(`准备推送 ${files.length} 个文件，共 ${(total / 1024 / 1024).toFixed(2)} MB → ${repo} (${branch})`);
for (const f of files.slice(0, 8)) console.log(`  ${f.rel}  ${(f.size / 1024).toFixed(1)} KB`);
if (files.length > 8) console.log(`  … 还有 ${files.length - 8} 个`);

if (dry) {
  console.log('\n（--dry 只列出文件，没有真的推送）');
  process.exit(0);
}

const [owner, name] = repo.split('/');

// 1) 看仓库里有没有已有提交
let parentSha = null;
try {
  const ref = await api('GET', `/repos/${owner}/${name}/git/ref/heads/${branch}`);
  parentSha = ref.object.sha;
  console.log(`\n目标分支已有提交 ${parentSha.slice(0, 7)}，会在此之上提交`);
} catch (err) {
  if (!String(err.message).includes('404')) throw err;
  console.log('\n目标分支还是空的，创建第一个提交');
}

// 2) 逐个大文件建 blob（GitHub 也接受内联 base64，但这样更稳）
const blobs = [];
for (const [i, f] of files.entries()) {
  const content = fs.readFileSync(f.full).toString('base64');
  const blob = await api('POST', `/repos/${owner}/${name}/git/blobs`, { content, encoding: 'base64' });
  blobs.push({ path: f.rel, sha: blob.sha });
  if ((i + 1) % 10 === 0 || i === files.length - 1) console.log(`  已上传 ${i + 1}/${files.length}`);
}

// 3) 建 tree / commit / 更新分支
const tree = await api('POST', `/repos/${owner}/${name}/git/trees`, {
  tree: blobs.map((b) => ({ path: b.path, mode: '100644', type: 'blob', sha: b.sha })),
});
const commit = await api('POST', `/repos/${owner}/${name}/git/commits`, {
  message,
  tree: tree.sha,
  parents: parentSha ? [parentSha] : [],
});
if (parentSha) {
  await api('PATCH', `/repos/${owner}/${name}/git/refs/heads/${branch}`, { sha: commit.sha });
} else {
  await api('POST', `/repos/${owner}/${name}/git/refs`, { ref: `refs/heads/${branch}`, sha: commit.sha });
}

console.log(`\n✓ 推送完成：https://github.com/${repo}/tree/${branch}`);
console.log(`  提交 ${commit.sha.slice(0, 7)}（${files.length} 个文件）`);
