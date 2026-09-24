/**
 * ★ 09-24 AI Provider —— 本项目所有 LLM 调用的唯一入口（AI 双轨约定的落地）
 *
 * ══ 这个文件要解决三件事 ══
 * ① **去重**：改造前 server.js 里有三份几乎一样的 fetch(deepseek) 代码
 *    （aiBrain 问答 / llmPlan 操作员计划 / llmMinutes 纪要），超时、降级、
 *    错误处理各写各的，改一处忘两处。现在三处共用 `askLLM`。
 * ② **密钥托管**：一处取值，三处来源，优先级清晰——
 *      process.env.DEEPSEEK_API_KEY  >  项目根 .env  >  sfu/config.json 的 ai.key
 *    ⚠️ 安全性：**密钥永不出网到浏览器**——/config.json 只下发 `aiEnabled: true/false`
 *    这种布尔值，任何地方都不回显 key 本身（连末四位都不给，防止日志/截图泄露）。
 * ③ **AI 双轨**：有 key 走 DeepSeek，无 key / 超时 / 限流 / 余额不足 → 调调用方给的
 *    `mock()` 兜底，返回值带 `mock: true`，调用方据此打 [Mock] 标记。
 *    "故障绝不能拖垮会议"——AI 是本项目的锦上添花，不是会议的关键路径。
 *
 * ══ 零依赖铁律 ══
 * 只用 Node 内置模块（fs / path）+ 内置 fetch（Node 18+）。不装 openai sdk、不装 dotenv。
 * `.env` 解析器自己写 12 行——这本身就是教学点：dotenv 做的事就这么点。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_MODEL = 'deepseek-chat';
const DEFAULT_BASE_URL = 'https://api.deepseek.com';

// deepseek-chat 官方单价（元 / 百万 tokens，2025 年公开价；调价后改这里或用 config.json 的 ai.price 覆盖）
const DEFAULT_PRICE = { prompt: 2, completion: 8 };

/* ── 用量账本（进程内累计；/metrics 会以 Prometheus 格式吐出）──
 * ▎为什么记账：AI 不是免费的。演示一晚纪要 < 1 元的说法必须**能被验证**，
 *   而"能不能说出这次调用花了多少钱/多少 token"正是工程化与玩具项目的分水岭。 */
const stats = { calls: 0, ok: 0, errors: 0, mock: 0, promptTokens: 0, completionTokens: 0, totalMs: 0, lastError: null, lastOkAt: 0 };

// ── 极简 .env 解析器（KEY=VALUE / # 注释 / 去掉包裹引号；已存在的环境变量不被覆盖）──
function loadDotEnv(file) {
  try {
    if (!fs.existsSync(file)) return;
    for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  } catch (e) { /* .env 不可读不影响运行 */ }
}

// 项目根 .env（本文件在 sfu/ai/ 下 → 上溯两级）
loadDotEnv(path.join(__dirname, '..', '..', '.env'));

// sfu/config.json：与 server.js 读的是同一个文件；这里只读 ai 段，读失败就当没配
function readConfigAi() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
    return (cfg && typeof cfg.ai === 'object' && cfg.ai) || {};
  } catch (e) {
    return {};
  }
}

function getApiKey() {
  const cfgAi = readConfigAi();
  return String(process.env.DEEPSEEK_API_KEY || cfgAi.key || '').trim();
}

function getSettings() {
  const cfgAi = readConfigAi();
  return {
    model: cfgAi.model || process.env.DEEPSEEK_MODEL || DEFAULT_MODEL,
    baseUrl: String(cfgAi.baseUrl || process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    timeoutMs: Number(cfgAi.timeoutMs) || Number(process.env.DEEPSEEK_TIMEOUT_MS) || 30000,
    price: Object.assign({}, DEFAULT_PRICE, cfgAi.price || {}),
  };
}

/** 是否配置了真 LLM（用于 /config.json 下发——只给布尔值，不给 key）
 *
 * ★ 09-24 补：AI_FORCE_MOCK=1 时**一律走本地兜底**，无论有没有 key。
 *   为什么需要这个开关？（这是"测试确定性"的必修课）
 *     自动化测试里断言"AI 任务在 2.5 秒内完成并交还控制权" —— 走真 LLM 时，
 *     同样一句话的网络往返可能是 1.8 秒也可能 9 秒（模型负载、限流、长尾延迟）。
 *     于是测试会时绿时红 —— 这种"flaky test"比测试失败更糟糕：
 *     它会让团队学会"红了重跑一次就行"，真出问题时没人当回事。
 *   正确做法：**测试只测自己的代码，不测外部服务的速度**。真 LLM 的连通性
 *   另有 test-ai.js 的 LLM 轨道专门验证（那个是"探活"，不是"断言性能"）。
 */
function aiEnabled() {
  if (process.env.AI_FORCE_MOCK === '1') return false;
  return !!getApiKey();
}

/**
 * 统一的 LLM 对话入口。
 * @param {Array<{role:string,content:string}>} messages OpenAI 风格三角色消息
 * @param {Object} opts
 *   - temperature / maxTokens / timeoutMs / label（记账用标签）
 *   - json: true → 自动剥掉 ```json 代码块围栏（LLM 输出 JSON 时的常见脏数据）
 *   - mock: (reason:string) => string —— 必填兜底：无 key 或调用失败时用它生成答案
 * @returns {{text:string, mock:boolean, ms:number, usage:Object, reason?:string}}
 */
async function askLLM(messages, opts = {}) {
  const settings = getSettings();
  const started = Date.now();
  const fail = (reason) => {
    const text = typeof opts.mock === 'function' ? String(opts.mock(reason) || '') : '';
    stats.mock++;
    return { text, mock: true, ms: Date.now() - started, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, reason };
  };

  const key = getApiKey();
  if (!key) return fail('no-key');

  stats.calls++;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(opts.timeoutMs) || settings.timeoutMs);
  try {
    const res = await fetch(`${settings.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: opts.model || settings.model,
        messages,
        temperature: opts.temperature === undefined ? 0.3 : opts.temperature,
        max_tokens: Number(opts.maxTokens) || 800,
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const reason = `HTTP ${res.status}${body ? ' ' + body.slice(0, 160) : ''}`;
      stats.errors++;
      stats.lastError = reason;
      return fail(reason);
    }
    const data = await res.json();
    let text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!text) {
      stats.errors++;
      return fail('empty-completion');
    }
    if (opts.json) text = String(text).replace(/```(?:json)?/g, '').trim();
    const usage = (data && data.usage) || {};
    stats.ok++;
    stats.lastOkAt = Date.now();
    stats.promptTokens += Number(usage.prompt_tokens) || 0;
    stats.completionTokens += Number(usage.completion_tokens) || 0;
    stats.totalMs += Date.now() - started;
    return {
      text: String(text).trim(),
      mock: false,
      ms: Date.now() - started,
      usage: {
        promptTokens: Number(usage.prompt_tokens) || 0,
        completionTokens: Number(usage.completion_tokens) || 0,
        totalTokens: Number(usage.total_tokens) || 0,
      },
    };
  } catch (err) {
    // 网络异常 / 超时 / DNS / 余额不足都在这一层兜住——AI 故障绝不上抛到会议信令
    const reason = err && err.name === 'AbortError' ? 'timeout' : String((err && err.message) || err);
    stats.errors++;
    stats.lastError = reason;
    return fail(reason);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 流式对话（打字机效果的底座）。
 * ▎为什么单独开一个函数：DeepSeek 的 stream=true 是 SSE 增量帧，解析逻辑与一次性 JSON
 *   完全不同；而"AI 一边想一边吐字"和"憋 10 秒后整段出现"是两种产品体验——后者在
 *   会议场景下会被当成"卡住了"。这里用 for-await 读 ReadableStream，逐段回调，
 * ▎这里用 for-await 逐块读 ReadableStream：每解析出一个 delta 就回调一次，
 *   由调用方（server.js）立刻转发成 ai-stream 事件抛给浏览器，形成逐字渲染。
 * ▎失败/降级路径保留一模一样的回调节奏（Mock 文本也分片喂出），
 *   这样前端的渲染路径始终只有一条——不需要为降级写第二套 UI 逻辑。
 * @returns {{text:string, mock:boolean, usage:Object, ms:number, reason?:string}}
 */
async function streamLLM(messages, opts = {}, onDelta) {
  const started = Date.now();
  const settings = getSettings();
  const report = (piece) => { if (typeof onDelta === 'function' && piece) onDelta(piece); };
  const fail = async (reason) => {
    const text = typeof opts.mock === 'function' ? String(opts.mock(reason) || '') : '';
    stats.mock++;
    // Mock 也 pretending to type（分片喂出），保证前端渲染路径只有一条
    for (let i = 0; i < text.length; i += 12) { report(text.slice(i, i + 12)); await new Promise((r) => setTimeout(r, 12)); }
    return { text, mock: true, ms: Date.now() - started, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, reason };
  };

  // ★ 09-24：测试轨道强制 Mock（不走网络，结果确定）——见 aiEnabled() 的说明
  if (process.env.AI_FORCE_MOCK === '1') return fail('forced-mock');
  const key = getApiKey();
  if (!key) return fail('no-key');

  stats.calls++;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(opts.timeoutMs) || settings.timeoutMs);
  try {
    const res = await fetch(`${settings.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: opts.model || settings.model,
        messages,
        temperature: opts.temperature === undefined ? 0.3 : opts.temperature,
        max_tokens: Number(opts.maxTokens) || 800,
        stream: true,
      }),
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => '');
      const reason = `HTTP ${res.status}${body ? ' ' + body.slice(0, 160) : ''}`;
      stats.errors++;
      stats.lastError = reason;
      return fail(reason);
    }
    let full = '';
    let usage = {};
    let buf = '';
    const decoder = new TextDecoder();
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';                       // 末行可能是不完整的半帧，留到下一轮
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const payload = t.slice(5).trim();
        if (payload === '[DONE]') continue;
        let delta = '';
        try {
          const j = JSON.parse(payload);
          if (j.usage) usage = j.usage;
          delta = (j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content) || '';
        } catch (e) { /* 半帧/非 JSON 数据行跳过 */ }
        if (delta) { full += delta; report(delta); }
      }
    }
    if (!full) { stats.errors++; return fail('empty-stream'); }
    stats.ok++;
    stats.lastOkAt = Date.now();
    stats.promptTokens += Number(usage.prompt_tokens) || 0;
    stats.completionTokens += Number(usage.completion_tokens) || 0;
    stats.totalMs += Date.now() - started;
    return {
      text: full.trim(), mock: false, ms: Date.now() - started,
      usage: {
        promptTokens: Number(usage.prompt_tokens) || 0,
        completionTokens: Number(usage.completion_tokens) || 0,
        totalTokens: Number(usage.total_tokens) || 0,
      },
    };
  } catch (err) {
    const reason = err && err.name === 'AbortError' ? 'timeout' : String((err && err.message) || err);
    stats.errors++;
    stats.lastError = reason;
    return fail(reason);
  } finally {
    clearTimeout(timer);
  }
}

/** 估算累计花费（元）——不是账单，是给"成本可控"这件事一个可验证的数字 */
function estimateCostCny() {
  const p = getSettings().price;
  return (stats.promptTokens / 1e6) * p.prompt + (stats.completionTokens / 1e6) * p.completion;
}

function getStats() {
  return Object.assign({}, stats, { costCny: Number(estimateCostCny().toFixed(6)), enabled: aiEnabled() });
}

module.exports = { askLLM, streamLLM, aiEnabled, getStats, getApiKey, getSettings, DEFAULT_MODEL, DEFAULT_BASE_URL };
