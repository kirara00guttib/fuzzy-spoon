// 把「日记本」一键部署到阿里云/腾讯云的 Ubuntu 服务器
//
//   node tools/remote-deploy.mjs --host 47.95.28.226 --pass '你的root密码'
//   可选：--user root --port 22 --dir /opt/riji --app-port 5173
//
// 做的事：装 Node 20 → 上传代码 → 写 .env（监听 0.0.0.0）→ systemd 守护
//        → ufw 放行 → 每天自动备份 data/ → 启动 → 健康检查
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'ssh2';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (n, d = '') => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const HOST = arg('host');
const USER = arg('user', 'root');
const PASS = arg('pass') || process.env.DEPLOY_PASS || '';
const PORT = Number(arg('port', '22'));
const DIR = arg('dir', '/opt/riji');
const APP_PORT = Number(arg('app-port', '5173'));

if (!HOST || !PASS) {
  console.error("用法：node tools/remote-deploy.mjs --host <IP> --pass '<root密码>'");
  process.exit(1);
}

const conn = new Client();
const log = (...a) => console.log(...a);

function sh(cmd, { quiet = false, timeout = 600000 } = {}) {
  return new Promise((resolve) => {
    conn.exec(cmd, { pty: false }, (err, stream) => {
      if (err) return resolve({ code: -1, out: '', err: String(err) });
      let out = '';
      let errOut = '';
      let done = false;
      const finish = (code) => {
        if (done) return;
        done = true;
        if (!quiet && out.trim()) log(out.trimEnd());
        resolve({ code, out, err: errOut });
      };
      const timer = setTimeout(() => finish(-2), timeout);
      stream.on('close', (code) => {
        clearTimeout(timer);
        finish(code);
      });
      stream.on('data', (d) => {
        out += d.toString();
        if (!quiet) process.stdout.write(d);
      });
      stream.stderr.on('data', (d) => {
        errOut += d.toString();
      });
    });
  });
}

const SKIP_DIRS = new Set(['node_modules', 'data', '.preview', '.wrangler', '.git', 'backups', '.hallmark', '.taste-skill']);
const SKIP_FILES = new Set(['.env', '.dev.vars', 'package-lock.json']);

function collect(dir, prefix = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) out.push(...collect(path.join(dir, e.name), rel));
    } else if (!SKIP_FILES.has(e.name)) {
      out.push({ rel, full: path.join(dir, e.name) });
    }
  }
  return out;
}

function sftpPut(sftp, local, remote) {
  return new Promise((resolve, reject) => sftp.fastPut(local, remote, (e) => (e ? reject(e) : resolve())));
}

conn
  .on('ready', async () => {
    try {
      log('\n=== 1. 检查系统 ===');
      await sh('cat /etc/os-release | head -2; uname -m; nproc; free -m | head -2; df -h / | tail -1', { quiet: false });

      log('\n=== 2. 安装 Node 20（已有就跳过）===');
      const nodeOk = await sh('command -v node && node -v', { quiet: true });
      if (!nodeOk.out.includes('v2')) {
        await sh('apt-get update -qq && apt-get install -y -qq curl ca-certificates >/dev/null 2>&1; true', { quiet: true });
        await sh('curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1', { quiet: true });
        await sh('apt-get install -y -qq nodejs >/dev/null 2>&1', { quiet: true });
      }
      const ver = await sh('node -v && npm -v', { quiet: true });
      log('   ' + ver.out.trim().replace(/\n/g, ' / '));
      if (!ver.out.includes('v')) throw new Error('Node 安装失败');

      log('\n=== 3. 准备目录 ===');
      await sh(`mkdir -p ${DIR}/data/uploads ${DIR}/backups`);
      log('   ' + DIR);

      log('\n=== 4. 上传代码 ===');
      const files = collect(root);
      const sftp = await new Promise((resolve, reject) => {
        conn.sftp((e, s) => (e ? reject(e) : resolve(s)));
      });
      let n = 0;
      for (const f of files) {
        const remote = path.posix.join(DIR, f.rel);
        await sh(`mkdir -p ${path.posix.dirname(remote)}`, { quiet: true });
        await sftpPut(sftp, f.full, remote);
        n += 1;
        if (n % 20 === 0 || n === files.length) log(`   ${n}/${files.length}`);
      }

      log('\n=== 5. 写 .env 与 systemd ===');
      const localEnv = fs.existsSync(path.join(root, '.env')) ? fs.readFileSync(path.join(root, '.env'), 'utf8') : '';
      const envLines = localEnv
        .split(/\r?\n/)
        .filter((l) => l.trim() && !l.startsWith('#'))
        .map((l) => {
          const [k] = l.split('=');
          if (k === 'HOST') return 'HOST=0.0.0.0';
          if (k === 'PORT') return `PORT=${APP_PORT}`;
          if (k === 'COOKIE_SECURE') return 'COOKIE_SECURE=0';
          return l;
        });
      if (!envLines.some((l) => l.startsWith('HOST='))) envLines.push('HOST=0.0.0.0');
      const envText = envLines.join('\n') + '\n';
      fs.writeFileSync(path.join(root, '.tmp-server-env'), envText);
      await sftpPut(sftp, path.join(root, '.tmp-server-env'), path.posix.join(DIR, '.env'));
      fs.rmSync(path.join(root, '.tmp-server-env'), { force: true });
      const perms = await sh(`chmod 600 ${DIR}/.env && chmod -R 755 ${DIR}/public ${DIR}/server ${DIR}/worker 2>/dev/null; true`, { quiet: true });

      const unit = `[Unit]
Description=riji (日记本)
After=network.target

[Service]
Type=simple
WorkingDirectory=${DIR}
ExecStart=/usr/bin/node server/index.mjs
Restart=always
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
`;
      fs.writeFileSync(path.join(root, '.tmp-riji.service'), unit);
      await sftpPut(sftp, path.join(root, '.tmp-riji.service'), '/etc/systemd/system/riji.service');
      fs.rmSync(path.join(root, '.tmp-riji.service'), { force: true });
      await sh('systemctl daemon-reload && systemctl enable riji >/dev/null 2>&1 && systemctl restart riji', { quiet: true });
      log('   systemd 已就绪');

      log('\n=== 6. 防火墙放行 ===');
      const ufw = await sh('command -v ufw && ufw status | head -2', { quiet: true });
      if (ufw.out.includes('Status: active')) {
        await sh(`ufw allow ${APP_PORT}/tcp >/dev/null && ufw allow 22/tcp >/dev/null; true`, { quiet: true });
        log(`   ufw 已放行 ${APP_PORT}`);
      } else {
        log('   ufw 未启用，跳过（阿里云还要在控制台安全组放行）');
      }

      log('\n=== 7. 每日备份 ===');
      const cron = `17 3 * * * cd ${DIR} && /usr/bin/node tools/backup.mjs >> ${DIR}/backups/backup.log 2>&1`;
      await sh(`(crontab -l 2>/dev/null | grep -v 'tools/backup.mjs'; echo "${cron}") | crontab -`, { quiet: true });
      log('   每天 03:17 备份到 ' + DIR + '/backups');

      log('\n=== 8. 迁移本机数据 ===');
      const localStore = path.join(root, 'data', 'store.json');
      if (fs.existsSync(localStore)) {
        const remoteStore = path.posix.join(DIR, 'data', 'store.json');
        const exists = await sh(`test -f ${remoteStore} && echo yes || echo no`, { quiet: true });
        if (exists.out.trim() === 'no') {
          await sftpPut(sftp, localStore, remoteStore);
          log('   已把本机 data/store.json 传过去');
        } else {
          log('   服务器上已有数据，跳过（避免覆盖）');
        }
      }

      log('\n=== 9. 健康检查 ===');
      await sh('sleep 2; systemctl is-active riji; curl -s http://127.0.0.1:' + APP_PORT + '/api/health; echo', { quiet: false });

      log('\n=== 完成 ===');
      log(`   服务器上：http://${HOST}:${APP_PORT}`);
      log('   还需要去阿里云控制台「安全组」放行 ' + APP_PORT + ' 端口，外部才能访问。');
      conn.end();
    } catch (err) {
      console.error('\n部署失败：', err.message || err);
      conn.end();
      process.exitCode = 1;
    }
  })
  .on('error', (err) => {
    console.error('SSH 连接失败：', err.message);
    process.exitCode = 1;
  })
  .connect({ host: HOST, port: PORT, username: USER, password: PASS, readyTimeout: 30000 });
