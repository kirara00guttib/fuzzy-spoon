// 在服务器上执行一条命令（维护用）
//   node tools/remote-sh.mjs --host 47.95.28.226 --pass 'xxx' --cmd 'systemctl status riji --no-pager'
import { Client } from 'ssh2';

const args = process.argv.slice(2);
const arg = (n, d = '') => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const HOST = arg('host');
const USER = arg('user', 'root');
const PASS = arg('pass') || process.env.DEPLOY_PASS || '';
const PORT = Number(arg('port', '22'));
const CMD = arg('cmd');

if (!HOST || !PASS || !CMD) {
  console.error("用法：node tools/remote-sh.mjs --host <IP> --pass '<密码>' --cmd '<命令>'");
  process.exit(1);
}

const conn = new Client();
conn
  .on('ready', () => {
    conn.exec(CMD, (err, stream) => {
      if (err) {
        console.error(err.message);
        conn.end();
        return;
      }
      stream.on('close', (code) => {
        conn.end();
        process.exitCode = code || 0;
      });
      stream.on('data', (d) => process.stdout.write(d));
      stream.stderr.on('data', (d) => process.stderr.write(d));
    });
  })
  .on('error', (err) => {
    console.error('SSH 失败：', err.message);
    process.exitCode = 1;
  })
  .connect({ host: HOST, port: PORT, username: USER, password: PASS, readyTimeout: 20000 });
