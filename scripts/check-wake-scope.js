#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
 *  check-wake-scope.js —— 「没叫到名字，AI 就不该开口」的真浏览器回归
 * ═══════════════════════════════════════════════════════════════════════════
 * ▎触发这件事的缺陷（2026-10-06 用户原话）：
 *   「这是一个正常的会议，如果不提到小明的名字小明不应该说话，只有叫到小明的时候
 *    小明才会说话思考回答」——而他自己那场会 21 句转写只有 4 句提到名字，AI 答了 18 次。
 * ▎服务端那一轨有 test:asr / test:asr-live 钉着；**浏览器这一轨**（服务器转写不可用时
 *   退回 Web Speech，唤醒判断在 client.js 的 emitCaption 里）此前只有一条
 *   "两张正则表逐字相同"的静态断言。静态相同 ≠ 行为相同：
 *   判据换成分层实现后，浏览器那份若忘了跟着改，界面上不会有任何异常，
 *   只是"同一句话在两条链路上一条会答、一条不答"（坑 47 的跨运行时版）。
 * ▎所以这里量三件事，一层比一层硬：
 *   ① 页面加载的是**本轮**的 client.js（没有指纹就是在测缓存，坑 40）；
 *   ② 页面的 `aiWakeHere` 与服务端 `Asr.shouldWake` 在**同一批真实句子**上逐句一致；
 *   ③ 直接调页面的 `emitCaption`，看它**到底发不发 `ai-ask`**——
 *     前两条测的是判据，这一条测的是行为（判据对了、没接上=白改，坑 41/56）。
 * ▎跑法：npm run check:wake（默认指本机 3001；另起测试服务器时用 CHECK_URL 指过去） */
const path = require('path');
const { Cdp } = require(path.join(__dirname, '..', 'agent', 'cdp.js'));
const Asr = require(path.join(__dirname, '..', 'sfu', 'ai', 'asr.js'));

const URL_ = (process.env.CHECK_URL || 'http://localhost:3001/') + '?nosw=1';
const results = [];
const ok = (name, pass, extra) => {
  results.push({ name, pass });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  · ' + extra : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 考卷取自真实账本 sfu/captions/cap-286716-20261006.jsonl（用户抱怨的那一场）：
 * NEG 是**没叫它**的日常发言（旧判据里「小命」那句会误醒），POS 是真叫它的句子。 */
const NEG = [
  '拍卖啊！', '你好。', '能卖吗？', '咳咳。', '爱丽。', '哈哈哈。', '二卡手表。',
  '你把手机放了吧。', '看吧，我。 对呀。', '发送一个小信息。',
  '不是你，这你把游戏是。 寂寞啊！ 他的视觉太灵敏了。',
  '叫啥？别人的哥哥。 李然讲的：“如果不不。” 说小命的话，他是最应该听见话。 对不对？我们。',
  '我买了个小米手机', '救命啊，这个安装包又坏了',
];
const POS = [
  '你好小明', '小明 你的脸子 我们叫吗？', '小明打开打开白板', '关闭白板，小明',
  '小明，帮我记一下明天下午三点的评审会', '你好 小米 下面', '晓明，把纪要生成一下',
];

(async () => {
  const cdp = new Cdp({ headless: true, startUrl: URL_, windowSize: { width: 1440, height: 900 } });
  await cdp.launch();
  await cdp.waitForLoad(15000);
  await sleep(1200);

  /* ① 版本指纹：先证明"我量的是现在这一版"（坑 40 + 57） */
  const fp = await cdp.evaluate(`(async () => {
    const js = await (await fetch('client.js', { cache: 'no-store' })).text();
    return {
      layered: js.includes('AI_WAKE_STRONG_RE') && js.includes('AI_WAKE_AMBIG_RE') && js.includes('AI_WAKE_ADDRESS_RE'),
      usedAtCallSite: /if \\(AI_NICKNAME && aiWakeHere\\(text\\)/.test(js),
      fnThere: typeof aiWakeHere === 'function',
      nick: typeof AI_NICKNAME !== 'undefined' ? AI_NICKNAME : '(无)',
    };
  })()`);
  ok('页面加载的是本轮 client.js（分层判据 + 调用点已换成 aiWakeHere）',
    fp.layered === true && fp.usedAtCallSite === true, `layered=${fp.layered} callSite=${fp.usedAtCallSite}`);
  ok('前提：页面里 aiWakeHere 真的可调用（否则下面测的是桩不是代码）',
    fp.fnThere === true, `typeof=${fp.fnThere ? 'function' : 'no'} 昵称=${fp.nick}`);

  /* ② 跨运行时逐句对表：同一批句子，浏览器与服务端必须同真同假。
   *   静态比"字符串相等"只能保证表一致，保证不了**判据逻辑**一致——
   *   比如浏览器那份将来加了一个 `|| text.length < 4` 之类的旁路，正则表照样相同。 */
  const bat = NEG.concat(POS);
  const pageVerdicts = await cdp.evaluate(`(function(){
    const B = ${JSON.stringify(bat)};
    return B.map((t) => !!aiWakeHere(t));
  })()`);
  const serverVerdicts = bat.map((t) => Asr.shouldWake(t));
  const drift = bat.map((t, i) => ({ t, p: pageVerdicts[i], s: serverVerdicts[i] }))
    .filter((x) => x.p !== x.s);
  ok(`★ 两条链路逐句一致（${bat.length} 句真实句子：浏览器 aiWakeHere ↔ 服务端 shouldWake）`,
    pageVerdicts.length === bat.length && drift.length === 0,
    drift.length ? drift.map((d) => `「${d.t.slice(0, 18)}」page=${d.p} server=${d.s}`).join(' / ') : `${bat.length} 句全同`);

  /* 反过来说清判据本身：负例必须一律不醒、正例必须一律醒。
   * 没有这两条，"两份一致"完全可能是"两份一起错"（假绿，坑 65 的同一条纪律）。 */
  const negWake = NEG.filter((_, i) => pageVerdicts[i]);
  const posMiss = POS.filter((_, i) => !pageVerdicts[NEG.length + i]);
  ok(`真实会议的普通发言在浏览器这一轨也一律不醒（${NEG.length} 句负例，含旧表会误醒的「小命」）`,
    negWake.length === 0, negWake.join(' | '));
  ok(`真叫它的句子一律接住（${POS.length} 句正例，含 小米/晓明 这两种真实误听写法）`,
    posMiss.length === 0, posMiss.join(' | '));

  /* ③ 行为断言：直接调页面的 emitCaption，看它**发不发 ai-ask**。
   *   ▸ 为什么要绕到这一步：上面两句测的是"判出来是什么"，而用户抱怨的是"它开口了"。
   *   ▸ 手法：包住 socket.emit 记账 + 往 lastMembers 里塞一个 isBot 成员（AI 在场的判据），
   *     然后喂一句不带名字的、再喂一句带名字的，比较两次的 ai-ask 记录。
   *   ▸ 只测 emitCaption 不发 ai-ask 这一段，不依赖真实服务器信令（这是纯客户端判据的接线）。 */
  const act = await cdp.evaluate(`(function(){
    const seen = [];
    const s = window.socket || (typeof socket !== 'undefined' ? socket : null);
    if (!s || typeof s.emit !== 'function') return { err: 'no-socket' };
    const orig = s.emit.bind(s);
    s.emit = function (ev, payload) { if (ev === 'ai-ask') seen.push(String((payload && payload.question) || '')); return orig.apply(null, arguments); };
    if (typeof lastMembers === 'object' && lastMembers) {
      lastMembers.push({ id: 'probe-bot', name: 'AI 小明', isBot: true });
    }
    const chatter = '今天天气真不错，拍卖啊。';
    const named = '小明，帮我把这条记一下。';
    try { emitCaption(chatter); } catch (e) { }
    const afterChatter = seen.length;
    try { emitCaption(named); } catch (e) { }
    const afterNamed = seen.length;
    /* 同一句 8s 内重复不许再发一次（客户端那半边的去重闸） */
    try { emitCaption(named); } catch (e) { }
    const afterRepeat = seen.length;
    s.emit = orig;
    return { afterChatter, afterNamed, afterRepeat, got: seen, members: (lastMembers || []).length };
  })()`);
  ok('前提：页面里有可用的 socket 与成员表（否则"没发问"只是没接线）',
    !act.err && typeof act.afterChatter === 'number', JSON.stringify(act).slice(0, 120));
  ok('★ 行为：浏览器轨上一句没叫名字的发言**不会**惊动 AI（0 次 ai-ask）',
    act.afterChatter === 0, `实际发了 ${act.afterChatter} 次 · ${JSON.stringify(act.got || [])}`);
  ok('★ 行为：叫了名字的那句正常发出一次 ai-ask（不许改成"干脆都不发"）',
    act.afterNamed === 1 && String((act.got || [])[0] || '').includes('记一下'),
    `发了 ${act.afterNamed} 次：${JSON.stringify(act.got || [])}`);
  ok('同一句 8s 内重复不许刷屏（去重闸还在）',
    act.afterRepeat === 1, `重复后累计 ${act.afterRepeat} 次`);

  const bad = results.filter((x) => !x.pass).length;
  cdp.kill();
  console.log(bad ? `\n❌ ${bad} 项未过` : '\n🎉 两条链路一致：不叫「小明」，它就不开口');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(`\n❌ 检查失败：${e && e.message}`); process.exit(1); });
