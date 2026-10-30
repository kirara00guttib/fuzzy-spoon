// 把 .preview/sprite-src.json（浏览器提取出来的像素网格）写成 public/js/sprite-data.js
import fs from 'node:fs';
import path from 'node:path';

const src = JSON.parse(fs.readFileSync('.preview/sprite-src.json', 'utf8'));
if (src.error) {
  console.error('提取失败：', src.error);
  process.exit(1);
}

const js = `// 由 tools/make-sprite-data.mjs 从两张 AI 像素画里提取出来的精灵（去背景、缩到像素网格、收色板）。
// 想换图：把新图放到 .tmp/ 下，跑一次提取脚本即可。

export const CAT_ART = ${JSON.stringify(src.cat, null, 2)};

export const DOG_ART = ${JSON.stringify(src.dog, null, 2)};
`;

fs.mkdirSync('public/js', { recursive: true });
fs.writeFileSync('public/js/sprite-data.js', js, 'utf8');
console.log('写了 public/js/sprite-data.js');
console.log(`猫 ${src.cat.w}×${src.cat.h}，${Object.keys(src.cat.palette).length} 色；狗 ${src.dog.w}×${src.dog.h}，${Object.keys(src.dog.palette).length} 色`);
console.log('\n猫：');
src.cat.rows.forEach((r) => console.log('  ' + r));
console.log('\n狗：');
src.dog.rows.forEach((r) => console.log('  ' + r));
