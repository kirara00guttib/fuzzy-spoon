// 一条命令从两张「多宫格」像素画里切出食物和培养阶段的素材，写成 public/js/food-data.js
// 用法：node tools/extract-foods.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'tools', 'sprite-extract');
const tmp = path.join(root, 'public', '.tmp');
const outJson = path.join(root, '.preview', 'food-src.json');

fs.mkdirSync(tmp, { recursive: true });
fs.mkdirSync(path.join(root, '.preview'), { recursive: true });
for (const f of ['food.webp', 'stages.webp', 'slice.html', 'slice.js']) {
  fs.copyFileSync(path.join(src, f), path.join(tmp, f));
}

const specs = encodeURIComponent('food.webp:24|stages.webp:26');
const url = `http://127.0.0.1:5173/.tmp/slice.html?specs=${specs}`;
const res = spawnSync(
  process.execPath,
  [path.join(root, 'tools', 'probe.mjs'), '--url', url, '--out', path.join(root, '.preview', 'slice.png'),
    '--width', '900', '--height', '700', '--wait', '3000', '--eval', 'window.__done', '--save', outJson],
  { encoding: 'utf8' },
);
fs.rmSync(tmp, { recursive: true, force: true });
if (res.stdout) process.stdout.write(res.stdout.split('\n').filter((l) => !/报错|log:/.test(l)).join('\n'));

let data;
try {
  data = JSON.parse(fs.readFileSync(outJson, 'utf8'));
} catch {
  console.error(res.stderr || '切图失败：没拿到结果');
  process.exit(1);
}
if (data.error) {
  console.error('切图失败：', data.error);
  process.exit(1);
}

// 第一张：5×3 = 15 个吃的；第二张：3 个阶段素材（蛋 / 箱子 / 种子）
const FOOD_META = [
  ['burger', '汉堡'], ['pizza', '披萨'], ['pizzaSlice', '披萨角'], ['fries', '薯条'], ['cola', '可乐'],
  ['bun', '小面包'], ['lollipop', '棒棒糖'], ['friedEgg', '煎蛋'], ['skewer', '烤串'], ['candy', '糖果'],
  ['roastChicken', '烤鸡'], ['cake', '蛋糕'], ['cupcake', '纸杯蛋糕'], ['croissant', '可颂'], ['bubbleTea', '珍珠奶茶'],
];
const foods = (data['food.webp'] || [])
  .map((art, i) => (art ? { id: FOOD_META[i][0], name: FOOD_META[i][1], ...art } : null))
  .filter(Boolean);

const stageArt = data['stages.webp'] || [];
const stages = {
  egg: stageArt[0] || null,
  box: stageArt[1] || null,
  seed: stageArt[2] || null,
};

const js = `// 由 tools/extract-foods.mjs 从两张像素画里切出来的素材（去白底 → 缩到像素网格 → 收 12 色）。
// 想换图：把新图放进 tools/sprite-extract/ 命名成 food.webp / stages.webp，再跑一次 node tools/extract-foods.mjs

export const FOODS = ${JSON.stringify(foods)};

export const STAGES = ${JSON.stringify(stages)};
`;
fs.writeFileSync(path.join(root, 'public', 'js', 'food-data.js'), js, 'utf8');
console.log(`✓ 食物 ${foods.length} 个，阶段素材 ${Object.entries(stages).filter(([, v]) => v).length} 个 → public/js/food-data.js`);
console.log('  食物：' + foods.map((f) => f.name).join(' '));
console.log('  阶段：' + Object.entries(stages).map(([k, v]) => `${k}(${v ? v.w + '×' + v.h : '无'})`).join(' '));
