// 一键备份：把 data/ 里的东西按时间戳复制一份，只留最近 14 份
// 用法：node tools/backup.mjs   或双击 backup.bat
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'data');
const backDir = path.join(root, 'backups');
const KEEP = 14;

if (!fs.existsSync(dataDir)) {
  console.error('没有 data/ 目录，还没用过吧？');
  process.exit(1);
}

const stamp = new Date()
  .toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' })
  .replace(/[-: ]/g, '')
  .slice(0, 13);
const target = path.join(backDir, `backup-${stamp}`);
fs.mkdirSync(target, { recursive: true });

let files = 0;
let bytes = 0;
function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(src, dst);
    else if (entry.isFile()) {
      fs.copyFileSync(src, dst);
      files += 1;
      bytes += fs.statSync(src).size;
    }
  }
}
copyTree(dataDir, target);

console.log(`✓ 备份好了：${target}`);
console.log(`  ${files} 个文件，${(bytes / 1024 / 1024).toFixed(2)} MB`);

// 只留最近 KEEP 份
const olds = fs
  .readdirSync(backDir)
  .filter((n) => n.startsWith('backup-'))
  .sort();
while (olds.length > KEEP) {
  const drop = path.join(backDir, olds.shift());
  fs.rmSync(drop, { recursive: true, force: true });
  console.log(`  清掉旧备份 ${path.basename(drop)}`);
}
console.log(`  备份目录：${backDir}（最多留 ${KEEP} 份）`);
