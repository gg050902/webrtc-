/* ══════════════════════════════════════════════════════════════
 * sfu/ai/pyprobe.js —— "这个 Python 模块到底装没装"的唯一探测实现（★ 2026-10-02）
 *
 * ▎为什么要单独一个文件（与 password.js / jsonc.js 同一条教训）：
 *   同一件事在三个地方各写了一遍——asr.js 探 `import whisper`、asr_qwen_local.js 探
 *   `import qwen_asr`、tts_qwen.js 探 `import qwen_tts`，三份都是
 *   `execFile(python, ['-c', 'import X'], { timeout: 15000 }, err => !err)`。
 *   09-24 那次已经把"探测超时=没装"这个误判在 ffmpeg 上修掉了（坑 37：要区分
 *   "真没装"与"此刻没答上来"），但 Qwen 这两个模块的探测**没跟着改**——
 *   而本机实测 `import qwen_asr` 冷启动要 21.7s、`import qwen_tts` 18.4s
 *   （torch 一族），15s 上限一冷就误判成"没装"，于是：
 *     · 本地 Qwen 引擎悄悄不启用（用户侧表现为"识别还是慢/音色还是机械的"）；
 *     · 更糟的是 warm() 把 boot() 的 false 当成功——启动日志照样打 🔥 已预热（假绿）。
 *   ▎修在一处、三处共用，才是"用结构消除漂移"；只改两个文件 = 第三次还会犯。
 *
 * ▎判据设计（三条，缺一不可）：
 *   ① **区分失败原因**：ENOENT（没有 python）/ ModuleNotFoundError（真没装）/
 *      超时（装了但机器此刻慢）——只有前两种才算"不可用"；
 *   ② **超时重试一次**且第二次给更长预算（冷启动只发生一次，重试基本必中）；
 *   ③ 上限按"能容纳 torch 级导入"来定（默认 90s，可用 PY_IMPORT_MS 覆盖），
 *      并且**不阻塞主流程**——探测在后台跑，期间调用方走兜底引擎（功能永不降级）。
 * ══════════════════════════════════════════════════════════════ */
'use strict';

const { execFile } = require('child_process');

/* 一次 `python -c "import X"` 的探测：返回 { ok, reason }
 * reason：null=成功 | 'enoent'=没有这个解释器 | 'module'=没装这个包 | 'timeout'=太慢 | 'error' */
function tryImport(bin, mod, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    let child;
    try {
      child = execFile(bin, ['-c', `import ${mod}`], { timeout: timeoutMs, windowsHide: true }, (err) => {
        if (!err) return done({ ok: true, reason: null });
        const msg = `${err.code || ''} ${err.message || ''} ${err.stderr || ''}`;
        if (err.code === 'ENOENT') return done({ ok: false, reason: 'enoent' });
        if (/ModuleNotFoundError|ImportError|No module named/i.test(msg)) return done({ ok: false, reason: 'module' });
        if (err.killed || /ETIMEDOUT|timed out/i.test(msg)) return done({ ok: false, reason: 'timeout' });
        done({ ok: false, reason: 'error' });
      });
    } catch (e) {
      done({ ok: false, reason: 'error' });
    }
    if (child && child.on) child.on('error', () => done({ ok: false, reason: 'enoent' }));
  });
}

/* 完整探测：先快后慢各一次；返回 { bin, reason }（bin=null 表示确实不可用）
 * ▎为什么"快一次再慢一次"而不是直接给 90s：绝大多数情况下模块要么装好（第一次几百毫秒
 *   就返回）要么没装（立刻 ModuleNotFound）。只有"冷启动 + 磁盘慢"这一种情况需要第二趟，
 *   把它做成重试而不是默认值，正常路径的启动延迟就不会被拖长。 */
async function probePythonModule(mod, { bins = ['python', 'python3'], fastMs, slowMs } = {}) {
  const fast = Number(process.env.PY_IMPORT_MS) || fastMs || 25000;
  const slow = slowMs || 90000;
  let lastReason = 'enoent';
  for (const bin of bins) {
    let r = await tryImport(bin, mod, fast);
    if (r.ok) return { bin, reason: null };
    if (r.reason === 'timeout') {
      r = await tryImport(bin, mod, slow);          // 冷启动第二趟（多数会成）
      if (r.ok) return { bin, reason: null };
    }
    lastReason = r.reason;
    if (r.reason === 'enoent') continue;             // 这个解释器不存在 → 试下一个
    if (r.reason === 'module') return { bin: null, reason: 'module' }; // 没装就是没装，换解释器意义不大
  }
  return { bin: null, reason: lastReason };
}

/* 给人看的失败原因（日志/doctor 共用一句话，别各写各的） */
function probeReasonText(reason, mod) {
  if (!reason) return '';
  if (reason === 'timeout') return `${mod} 导入超时（机器太慢或首次加载），本次走兜底引擎`;
  if (reason === 'module') return `未安装 ${mod}（pip install ${mod.replace(/_/g, '-')}）`;
  if (reason === 'enoent') return '找不到可用的 python';
  return `${mod} 导入失败（${reason}）`;
}

module.exports = { probePythonModule, tryImport, probeReasonText };
