// 造一点假数据看排版（只在本地用，最后会清掉）
import fs from 'node:fs';
import path from 'node:path';

const base = process.argv[2] || 'http://127.0.0.1:5173';
const login = await fetch(`${base}/api/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'superneko111', password: 'miaomiaomiao@lxj' }),
});
const cookie = login.headers.getSetCookie()[0].split(';')[0];
const H = { 'content-type': 'application/json', cookie };
const post = async (p, body) => {
  const res = await fetch(base + p, { method: 'POST', headers: H, body: JSON.stringify(body) });
  return res.json();
};

const notes = [
  '今天在楼下看到一只橘猫，蹲在花坛边上晒太阳，跟你一个表情。',
  '早上出门太急，忘了跟你说路上小心。现在补上。',
  '我数了数，我们已经一起看过七次日落。',
];
for (const text of notes) await post('/api/notes', { text });

const files = ['.preview/sprites.png', '.preview/probe-login2.png', '.preview/probe-app-time.png'];
const photoIds = [];
for (const [i, f] of files.entries()) {
  if (!fs.existsSync(f)) continue;
  const buf = fs.readFileSync(f);
  const type = 'image/png';
  const pre = await post('/api/uploads/presign', { contentType: type });
  const put = await fetch(base + pre.uploadUrl, { method: 'PUT', headers: { 'content-type': type, cookie }, body: buf });
  if (!put.ok) {
    console.log('upload failed', await put.text());
    continue;
  }
  const info = await post('/api/photos', { key: pre.key, w: 1440, h: 900, size: buf.length, type, caption: `第 ${i + 1} 张测试照片` });
  photoIds.push(info.photo.id);
}

await post('/api/moments', {
  date: new Date().toISOString().slice(0, 10),
  text: '下班路上买了两杯奶茶，一杯放你桌上，一杯我自己喝掉了。',
  mood: '开心',
  photoIds: photoIds.slice(0, 2),
  bgm: { title: '午后散步', url: 'https://music.163.com/' },
});
await post('/api/moments', {
  date: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
  text: '今天有点累，但是想到晚上能跟你说话，好像就不累了。',
  mood: '累但幸福',
  photoIds: [],
  bgm: null,
});

for (const e of [
  { date: '2026-11-11', title: '第一次一起过生日', yearly: true, hue: 'gold', note: '蛋糕要草莓味的' },
  { date: '2026-10-01', title: '去海边的那天', yearly: true, hue: 'teal', note: '' },
]) {
  await post('/api/events', e);
}

await post('/api/tracks', { title: '风起地的风', url: 'https://music.163.com/#/search/m/?s=风起地' });
console.log('seed done: notes', notes.length, 'photos', photoIds.length);
