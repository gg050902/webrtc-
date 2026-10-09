/* ═══════════════════════════════════════════════════════════════════════════
 *  sfu/golden.js —— 真人语音金标准（录制与账本），`bench:asr-golden` 的输入侧
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ▎为什么要有这个文件（它服务的是一件此前根本没法回答的事）
 *   语音这条线一直卡在一个死结上：**准确率的天花板不知道在哪**。
 *     · 路线图 H3 写着"词级天花板（大木车 / 洗地皮 / 庭审会）等用户拍板"，
 *       可三条路（云端 / 更大本地模型 / 靠近麦克风）没有一张对照表，拍不了；
 *     · H8b 与所有 dB 阈值"不敢动"，因为动完只能看 blob% 变没变，看不出听对没听对。
 *   而所有自动化证据都建立在**合成语音**上（System.Speech 的中文音色 + Chromium 假麦克风）。
 *   合成语音有两处结构性失真：它每句都写着「小明」（结构上测不出误唤醒），
 *   而且它的电平节奏与真人不同——10-03 那次"自测 1.4s vs 真会中位 3.9s"就是这两者给的
 *   **相反答案**。所以：要判断"这套语音到底能不能真人用"，必须有一份**真人念的、
 *   带标准答案的**音频。这个文件就是那份数据的采集与存储层。
 *
 * ▎一句话的取舍，写在前面
 *   这个页面**不是会议功能**，是开发者的采集工具：只有管理员能用（requireAdmin），
 *   产物落在 `sfu/voice-golden/`（已进 .gitignore——那是本人说过的话与录音，不该进仓库），
 *   而且它**不进 Service Worker 缓存**（走 /api/ 前缀的 NETWORK_ONLY）。
 *
 * ▎为什么句子清单放这里而不是前端
 *   同一批句子有两个读者：录制页（要照着念）与 `bench-asr-golden.js`（没有真人录音时
 *   要用同一批句子合成兜底）。前端抄一份、脚本抄一份，就会出现"录的句子和跑的句子不是
 *   同一批"——那两份 CER 表根本不可比。所以句子只有这一处（坑 47），前端经 /api/golden 取。
 *
 * ▎为什么存 WAV 而不是浏览器给的 WEBM
 *   转写引擎只吃 16k/单声道/16bit PCM（`sfu/ai/asr.js:383` 那条契约）。
 *   录制时就用 ffmpeg 转成 WAV 存盘，好处是**金标准一旦录下就与浏览器行为解耦**：
 *   下次换引擎、换机器、改阈值，喂进去的是同一份字节，读数才可比。
 *
 * ▎零依赖：Node 内置 fs/path + 仓库里已在用的 ffmpeg（探测与二进制路径由调用方传入，
 *   本模块不自己再探一次——`FFMPEG_BIN` 的唯一来源是 server.js，坑 47）。
 * ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

/* ★ 目录可整体改到临时位置（与 DB_FILE / FILES_DIR 同一条测试隔离纪律）：
 *   真人金标准是"本人语音 + 句子原文"，回归测试绝不能往真实目录里写——
 *   本项目已经因为账号测试直接写 users.json 攒下过 61 个垃圾账号。
 *   测试跑完还会自证一句"真实目录没被创建/没被改"（test:sfu 里有那条断言）。 */
const GOLDEN_DIR = process.env.GOLDEN_DIR
  ? path.resolve(process.env.GOLDEN_DIR)
  : path.join(__dirname, 'voice-golden');
const WAV_DIR = path.join(GOLDEN_DIR, 'wav');
const MANIFEST = path.join(GOLDEN_DIR, 'manifest.jsonl');

/** 单条录音的字节上限（浏览器 webm/opus，30s 一句远不到；这条防的是乱刷）。 */
const MAX_CLIP_BYTES = 8 * 1024 * 1024;
/** 金标准总条数上限：30 句 × 2 档距离 = 60，留一倍余量给重录。 */
const MAX_CLIPS = 140;

/* ── 句子清单（唯一来源）──────────────────────────────────────────────
 * ▎每句都对应一个**在这台机器上真翻过车**的形态。选句理由必须写在这里：
 *   下次有人加句子，如果写不出"为什么加这句"，那它就是在给电池凑数——
 *   而"电池只覆盖我想到过的说法"正是坑 106 量出 54% 泛化缺口的那个病。 */
const SENTENCES = [
  { text: '小明，帮我记一下明天下午三点的评审会。', why: '唤醒词 + 时间 + 已知翻车词（评审会→庭审会）' },
  { text: '产品评审会定在十月十号，全员参加。', why: '中文数字写法 + 会议动作词（既要/记要 那组别字的来源）' },
  { text: '压测报告由张伟负责，周五之前提交。', why: '人名 + 待办抽取的主语边界（坑 42 那类贪婪切词）' },
  { text: '服务器起负载了，把 GPU 显存先降下来。', why: '中英混排 + 「起负载」曾被切成两句' },
  { text: '今天天气真不错，拍卖呀。', why: '噪声幻觉 riff 的对照句（不能被判成噪声丢掉）' },
  { text: '把白板打开，再把实时字幕关掉。', why: '一句话两个房间动作（组合指令的执行顺序）' },
  { text: '这条记录一下，回头我跟进。', why: '「记录」曾被误判成"开录制"而明确拒绝（坑 107，出现 11 次）' },
  { text: '大木车是不是要换成洗地皮？', why: '用户真实抱怨里的两个词级错，刻意留着量模型上限' },
  { text: '这段音频峰值只有 -56 分贝，坐得远也能听清吗？', why: '安静麦克风场景（10-05d 那把尺子的病灶）' },
  { text: '会议结束前把纪要生成一下，发我一份。', why: '纪要意图 + 动作型指令（"答应了但没做"那一类）' },
];

/** 两个距离档：录两遍，一次正常坐好，一次明显坐远/侧头。 */
const DISTANCES = [
  { key: 'near', label: '正常距离（30~40cm）', hint: '像平时开会那样对着笔记本念' },
  { key: 'far', label: '坐远 / 侧头（60cm+）', hint: '故意离远一点或侧一点——那是你实际开会的位置' },
];

function ensureDirs() {
  fs.mkdirSync(WAV_DIR, { recursive: true });
}

/** 读账本：同一个 id 只保留**最后一次**（重录是常态，不是异常）。 */
function list() {
  if (!fs.existsSync(MANIFEST)) return [];
  const byId = new Map();
  for (const line of fs.readFileSync(MANIFEST, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    let r;
    try { r = JSON.parse(line); } catch (e) { continue; }   // 坏行跳过（append-only 文件的既有口径）
    if (!r || !r.id || !r.text || !r.wav) continue;
    if (!fs.existsSync(path.join(GOLDEN_DIR, r.wav))) continue;  // 台账与磁盘对账：盘上没有就不列出来
    byId.set(r.id, r);
  }
  return [...byId.values()];
}

function appendRecord(rec) {
  ensureDirs();
  fs.appendFileSync(MANIFEST, JSON.stringify(rec) + '\n');
}

/** 账本里丢掉某个 id（重录时用）。
 *  ▸ ★ 2026-10-09 这里曾经差点删掉**新写的那份文件**：重录的顺序是
 *    "转码覆盖同名 wav → 剔旧账 → 记新账"，若在这一步按旧记录 unlink 文件路径，
 *    由于新旧路径同名（wav/<id>.wav），删掉的其实是刚转好的那一份——
 *    于是账本指着一条不存在的 wav，`list()` 的对账又把它过滤掉，
 *    用户看到的就是"我明明重录成功了，列表里却没了"。
 *    文件层的清理只该发生在**id 不再被使用**时；同 id 覆盖场景交给覆盖本身。 */
function dropFromLedger(id) {
  const kept = list().filter((r) => r.id !== id);
  fs.writeFileSync(MANIFEST, kept.map((r) => JSON.stringify(r)).join('\n') + (kept.length ? '\n' : ''));
  return kept.length;
}

/** 彻底删一条（含字节）：留给"清理整批金标准"用，重录路径不许调它。 */
function removeById(id) {
  const items = list();
  const hit = items.find((r) => r.id === id);
  if (!hit) return false;
  try { fs.unlinkSync(path.join(GOLDEN_DIR, hit.wav)); } catch (e) { /* 已经被删/占用 */ }
  dropFromLedger(id);
  return true;
}

/** id 消毒：它最终会变成文件名。白名单而不是黑名单——拼出来的路径只可能是这一种形状。 */
function safeId(raw) {
  const s = String(raw || '').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{0,31}$/.test(s) ? s : '';
}

/**
 * 把浏览器录下来的音频转成 16k/单声道/16bit WAV。
 * @param {object} o
 *   @param {import('http').IncomingMessage} o.req  原始请求体（webm/opus 或 wav 都吃）
 *   @param {string} o.ffmpegBin                    由调用方给（server.js 的 FFMPEG_BIN 是唯一来源）
 *   @param {string} o.id                           已消毒的条目 id
 * @returns {Promise<{wav:string, bytes:number, ms:number}>} wav = 相对 GOLDEN_DIR 的路径
 */
function transcodeClip({ req, ffmpegBin, id }) {
  if (!ffmpegBin) return Promise.reject(Object.assign(new Error('服务器没探测到 ffmpeg，装好再录（npm run doctor 看 A 组）'), { status: 503 }));
  if (!safeId(id)) return Promise.reject(Object.assign(new Error('id 形状不合法（只允许小写字母/数字/-/_）'), { status: 400 }));
  ensureDirs();
  const inPath = path.join(WAV_DIR, `${id}.src.part`);
  const outRel = path.join('wav', `${id}.wav`);
  const outPath = path.join(GOLDEN_DIR, outRel);
  const t0 = Date.now();

  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(inPath);
    let size = 0;
    const fail = (err) => {
      try { req.destroy(); } catch (e) { /* 已经断了 */ }
      setTimeout(() => { try { fs.unlinkSync(inPath); } catch (e) { /* Windows 句柄未释放时下轮再清 */ } }, 60);
      reject(err);
    };
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_CLIP_BYTES) return fail(Object.assign(new Error(`单条录音超过 ${Math.round(MAX_CLIP_BYTES / 1048576)}MB 上限`), { status: 413 }));
      if (!out.write(chunk)) req.pause();
    });
    out.on('drain', () => req.resume());
    out.on('error', (e) => fail(Object.assign(new Error('落盘失败：' + e.message), { status: 500 })));
    out.on('close', () => {
      if (!size) return fail(Object.assign(new Error('收到 0 字节：浏览器没录到东西（麦克风权限？）'), { status: 400 }));
      /* ffmpeg 参数写死 16k/mono/s16le —— 与 sfu/ai/asr.js:383 那条契约同源。
       * 为什么不在引擎侧临时转：金标准要的是"这份字节以后每次跑都一样"，
       * 转换发生一次并落盘，比每次测量都重转一遍更可复现（也更快）。 */
      const p = spawn(ffmpegBin, [
        '-y', '-hide_banner', '-loglevel', 'error', '-i', inPath,
        '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', outPath,
      ], { windowsHide: true });
      let errTail = '';
      p.stderr.on('data', (b) => { errTail = (errTail + b.toString()).slice(-400); });
      p.on('error', (e) => fail(Object.assign(new Error('ffmpeg 起不来：' + e.message), { status: 500 })));
      p.on('close', (code) => {
        try { fs.unlinkSync(inPath); } catch (e) { /* 收尾垃圾，sweepStaleParts 兜底 */ }
        if (code !== 0 || !fs.existsSync(outPath)) {
          return fail(Object.assign(new Error(`转码失败（退出码 ${code}）${errTail ? '：' + errTail.slice(0, 160) : ''}`), { status: 500 }));
        }
        resolve({ wav: outRel.split(path.sep).join('/'), bytes: fs.statSync(outPath).size, ms: Date.now() - t0 });
      });
    });
    req.on('end', () => out.end());
    req.on('aborted', () => fail(Object.assign(new Error('上传中断'), { status: 400 })));
  });
}

/** 启动时清一次上次的 .part（崩溃/断电留下的半截文件；与 sfu/files.js 同一条卫生）。 */
function sweepStaleParts(maxAgeMs = 3600000) {
  let n = 0;
  try {
    if (!fs.existsSync(WAV_DIR)) return 0;
    for (const f of fs.readdirSync(WAV_DIR)) {
      if (!f.endsWith('.part')) continue;
      const p = path.join(WAV_DIR, f);
      try { if (Date.now() - fs.statSync(p).mtimeMs > maxAgeMs) { fs.unlinkSync(p); n++; } } catch (e) { /* 占用就下轮再清 */ }
    }
  } catch (e) { /* 目录还没建：本来就没有垃圾 */ }
  return n;
}

module.exports = {
  GOLDEN_DIR, WAV_DIR, MANIFEST,
  SENTENCES, DISTANCES,
  MAX_CLIP_BYTES, MAX_CLIPS,
  ensureDirs, list, appendRecord, dropFromLedger, removeById, safeId, transcodeClip, sweepStaleParts,
};
