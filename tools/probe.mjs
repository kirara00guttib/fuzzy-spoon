// 用 Edge 的 CDP 打开页面、抓控制台报错、按指定尺寸截图
// 用法：node tools/probe.mjs --url http://127.0.0.1:5173/ --out .preview/p.png [--width 1440 --height 900] [--eval "js"] [--wait 1200]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const arg = (name, fallback = '') => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

const url = arg('url', 'http://127.0.0.1:5173/');
const out = arg('out', '.preview/probe.png');
const width = Number(arg('width', '1440'));
const height = Number(arg('height', '900'));
const evalJs = arg('eval', '');
const waitMs = Number(arg('wait', '1400'));
const port = Number(arg('port', '9223'));
const fullPage = args.includes('--full');
const saveTo = arg('save', '');

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => fs.existsSync(p));

if (!EDGE) {
  console.error('找不到 msedge.exe');
  process.exit(1);
}

const profile = path.join(process.env.TEMP || '.', `edge-probe-${port}`);
const child = spawn(
  EDGE,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--hide-scrollbars',
    '--mute-audio',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    'about:blank',
  ],
  { stdio: 'ignore', detached: false },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getTarget() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page;
    } catch {
      /* 还没起来 */
    }
    await sleep(200);
  }
  throw new Error('Edge 的调试端口没起来');
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method) {
      listeners.forEach((fn) => fn(msg));
    }
  });
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });
  return {
    ready,
    send(method, params = {}) {
      const msgId = ++id;
      return new Promise((resolve, reject) => {
        pending.set(msgId, { resolve, reject });
        ws.send(JSON.stringify({ id: msgId, method, params }));
        setTimeout(() => {
          if (pending.has(msgId)) {
            pending.delete(msgId);
            reject(new Error(`${method} 超时`));
          }
        }, 20000);
      });
    },
    on(fn) {
      listeners.add(fn);
    },
    close() {
      ws.close();
    },
  };
}

const errors = [];
const logs = [];

try {
  const target = await getTarget();
  const cdp = connect(target.webSocketDebuggerUrl);
  await cdp.ready;

  cdp.on((msg) => {
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      errors.push(`${d.text} ${d.exception?.description || ''}`.trim());
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ');
      logs.push(`[${msg.params.type}] ${text}`);
      if (msg.params.type === 'error') errors.push(text);
    }
    if (msg.method === 'Log.entryAdded') {
      const e = msg.params.entry;
      logs.push(`[log:${e.level}] ${e.text}`);
      if (e.level === 'error') errors.push(e.text);
    }
  });

  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 600,
  });
  await cdp.send('Page.navigate', { url });
  await sleep(waitMs);

  if (evalJs) {
    const res = await cdp.send('Runtime.evaluate', {
      expression: evalJs,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res.exceptionDetails) errors.push(`eval: ${res.exceptionDetails.text} ${res.exceptionDetails.exception?.description || ''}`);
    if (res.result && res.result.value !== undefined) {
      if (saveTo) {
        fs.mkdirSync(path.dirname(saveTo), { recursive: true });
        fs.writeFileSync(saveTo, JSON.stringify(res.result.value, null, 1));
        console.log('已保存 eval 结果 → ' + saveTo);
      } else {
        console.log('eval =>', JSON.stringify(res.result.value).slice(0, 400));
      }
    }
    await sleep(900);
  }

  let clip;
  if (fullPage) {
    const metrics = await cdp.send('Page.getLayoutMetrics');
    const size = metrics.cssContentSize;
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height: Math.ceil(size.height),
      deviceScaleFactor: 1,
      mobile: width < 600,
    });
    await sleep(400);
  }
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', clip });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log(`截图 ${out} ${width}×${height}`);
  if (logs.length) console.log('--- 控制台 ---\n' + logs.slice(-40).join('\n'));
  if (errors.length) {
    console.log('--- 报错 ---\n' + errors.join('\n'));
    process.exitCode = 2;
  } else {
    console.log('没有报错');
  }
  cdp.close();
} catch (err) {
  console.error('probe 失败：', err.message);
  process.exitCode = 1;
} finally {
  setTimeout(() => {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
    process.exit(process.exitCode || 0);
  }, 300);
}
