// 一条命令重做像素精灵：把 tools/sprite-extract/ 里的两张图
// 交给无头 Edge 去背景/缩放/收色板，然后写成 public/js/sprite-data.js
//
// 用法：node tools/extract-sprites.mjs [cat宽] [dog宽]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'tools', 'sprite-extract');
const tmp = path.join(root, 'public', '.tmp');
const out = path.join(root, '.preview', 'sprite-src.json');
const catW = process.argv[2] || '26';
const dogW = process.argv[3] || '28';

fs.mkdirSync(tmp, { recursive: true });
fs.mkdirSync(path.join(root, '.preview'), { recursive: true });
for (const f of ['cat.webp', 'dog.webp', 'convert.html', 'convert.js']) {
  fs.copyFileSync(path.join(src, f), path.join(tmp, f));
}

const url = `http://127.0.0.1:5173/.tmp/convert.html?catW=${catW}&dogW=${dogW}`;
const res = spawnSync(
  process.execPath,
  [
    path.join(root, 'tools', 'probe.mjs'),
    '--url',
    url,
    '--out',
    path.join(root, '.preview', 'convert.png'),
    '--width',
    '900',
    '--height',
    '700',
    '--wait',
    '2800',
    '--eval',
    'window.__done',
    '--save',
    out,
  ],
  { encoding: 'utf8' },
);

fs.rmSync(tmp, { recursive: true, force: true });
if (res.stdout) process.stdout.write(res.stdout.replace(/\n{2,}/g, '\n'));

// probe 会因为「favicon 404」这类无关告警返回非 0，只要结果文件写出来了就算成功
let data;
try {
  data = JSON.parse(fs.readFileSync(out, 'utf8'));
} catch {
  console.error(res.stderr || '提取失败：没拿到结果');
  process.exit(1);
}
if (data.error) {
  console.error('提取失败：', data.error);
  process.exit(1);
}

const js = `// 由 tools/extract-sprites.mjs 从两张 AI 像素画里提取出来的精灵（去背景、缩到像素网格、收 14 色）。
// 想换图：把新图放到 tools/sprite-extract/ 里命名成 cat.webp / dog.webp，再跑一次 node tools/extract-sprites.mjs

export const CAT_ART = ${JSON.stringify(data.cat, null, 2)};

export const DOG_ART = ${JSON.stringify(data.dog, null, 2)};
`;
fs.writeFileSync(path.join(root, 'public', 'js', 'sprite-data.js'), js, 'utf8');
console.log(`✓ 猫 ${data.cat.w}×${data.cat.h}，狗 ${data.dog.w}×${data.dog.h} → public/js/sprite-data.js`);
