// 临时探针（本次会话自测用，跑完删）：只看 desk-connect 的 ack 形态
const { io } = require('C:/Users/27418/Desktop/webrtc/node_modules/socket.io-client');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const PORT = 3021;
const URL = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const proc = spawn(process.execPath, [path.join(__dirname, '..', 'sfu', 'server.js')], {
  env: { ...process.env, PORT: String(PORT), SFU_NO_HTTPS: '1', AI_FORCE_MOCK: '1',
    DB_FILE: path.join(os.tmpdir(), `probe-${Date.now()}.db`),
    USERS_FILE_LEGACY: path.join(os.tmpdir(), 'definitely-not-there.json'),
    AI_OP_STEP_MS: '20' },
  cwd: path.join(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'],
});
proc.stdout.on('data', (d) => process.stdout.write('[srv] ' + d));
proc.stderr.on('data', (d) => process.stdout.write('[srv!] ' + d));

function client() {
  return new Promise((res, rej) => {
    const s = io(URL, { transports: ['websocket'], reconnection: false });
    s.on('connect', () => res({ s, id: s.id }));
    s.on('connect_error', rej);
  });
}

(async () => {
  for (let i = 0; i < 60; i++) { await sleep(250); if (await fetch(URL + '/config.json').then((r) => r.ok).catch(() => false)) break; }
  const AG = await client();
  const reg = await new Promise((res) => AG.s.emit('desk-register', { name: 'probe', connectPassword: 'pw123' }, res));
  console.log('REG ACK =', JSON.stringify(reg));
  const CODE = reg.data.deviceCode;
  const CTL = await client();
  CTL.s.on('desk-granted', (p) => console.log('GRANTED =', JSON.stringify(p)));
  AG.s.on('remote-request', () => {
    AG.s.emit('remote-answer', { to: CTL.id, ok: true, durationMs: 0 });
  });
  const c1 = await new Promise((res) => CTL.s.emit('desk-connect', { deviceCode: CODE, password: 'pw123' }, res));
  console.log('CONNECT ACK =', JSON.stringify(c1));
  await sleep(800);
  AG.s.disconnect(); CTL.s.disconnect();
  proc.kill();
  process.exit(0);
})().catch((e) => { console.error('probe err', e); proc.kill(); process.exit(1); });
