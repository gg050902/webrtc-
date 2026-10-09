/* 一次性改造（跑完即删）：登录卡重排 —— 品牌头 / 图标前缀输入框 / 密码可见切换 / 次要入口成行。
 * ▎只动结构与样式：**所有 id 一个没改**（authUser/authPass/authName/authAvatars/
 *   authLoginBtn/authRegisterBtn/authGuestBtn/authDeskBtn/authMsg），
 *   client.js 第 2.5 步与冒烟测试都是按 id 找元素的，改了就会静默失联。
 * 每条替换要求命中恰好一次。 */
const fs = require('fs');
const p = 'sfu/public/index.html';
let s = fs.readFileSync(p, 'utf8');
const svg = (i) => `<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${i}</svg>`;
const I = {
  person: svg('<circle cx="12" cy="8" r="3.4"/><path d="M5.8 19.6c0-3.2 2.8-5.6 6.2-5.6s6.2 2.4 6.2 5.6"/>'),
  lock: svg('<rect x="5" y="10.5" width="14" height="9.5" rx="2.2"/><path d="M8.2 10.5V8a3.8 3.8 0 0 1 7.6 0v2.5"/><path d="M12 14v2.6"/>'),
  smile: svg('<circle cx="12" cy="12" r="8.5"/><path d="M9 10h.01M15 10h.01M8.5 14.5a4.5 4.5 0 0 0 7 0"/>'),
  eye: svg('<path d="M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.6"/>'),
  eyeOff: svg('<path d="M4 4l16 16"/><path d="M9.6 6.9A9.6 9.6 0 0 1 12 6.5c6 0 9.5 5.5 9.5 5.5a17 17 0 0 1-3.2 3.8"/><path d="M6.3 8.4A16.7 16.7 0 0 0 2.5 12s3.5 5.5 9.5 5.5c1.3 0 2.4-.2 3.4-.6"/>'),
  screen: svg('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8.5 20h7M12 16v4"/>'),
};
const reps = [
  [`      <div class="auth-caps">Simple Meeting over Mediasoup</div>
      <div class="auth-title">云会议</div>
      <div class="auth-sub">登录后昵称会显示给全房间；也可以游客进入，随时可注册</div>
      <input id="authUser" class="room-input auth-input" placeholder="用户名（2~16 位，中英文/数字/下划线）" maxlength="16" />
      <input id="authPass" class="room-input auth-input" type="password" placeholder="密码（至少 6 位）" maxlength="32" />
      <input id="authName" class="room-input auth-input" placeholder="昵称（可选，注册时保存）" maxlength="16" />`,
   `      <!-- 品牌头：印章 + 双语排版本来是顶栏的语言，第一屏反而没有——别人打开链接
           看到的第一眼应该先是"这是个什么产品"，再才是"要我填什么" -->
      <div class="auth-brand">
        <span class="auth-seal" aria-hidden="true">會</span>
        <div class="auth-brand-txt">
          <div class="auth-caps">Simple Meeting over Mediasoup</div>
          <div class="auth-title">云会议</div>
        </div>
      </div>
      <div class="auth-sub">登录后昵称会显示给全房间；也可以游客进入，随时可注册</div>
      <!-- 输入框前缀换线性图标：三行输入原本只靠 placeholder 区分，
           而 placeholder 一输入就消失——图标是那个"不会消失的说明" -->
      <div class="auth-field">
        ${I.person}
        <input id="authUser" class="room-input auth-input" placeholder="用户名（2~16 位，中英文/数字/下划线）" maxlength="16" autocomplete="username" />
      </div>
      <div class="auth-field">
        ${I.lock}
        <input id="authPass" class="room-input auth-input" type="password" placeholder="密码（至少 6 位）" maxlength="32" autocomplete="current-password" />
        <button id="authPassEye" class="auth-eye" type="button" title="显示 / 隐藏密码">${I.eye}${I.eyeOff}</button>
      </div>
      <div class="auth-field">
        ${I.smile}
        <input id="authName" class="room-input auth-input" placeholder="昵称（可选，注册时保存）" maxlength="16" />
      </div>`],
  [`        <button id="authGuestBtn" class="auth-guest">游客进入（不登录）→</button>
      <!-- ★ 09-30 借鉴 billd-desk：远程控制设备码直连入口（不用先开会） -->
      <button id="authDeskBtn" class="auth-guest">${I.screen}<span>用设备码远程控电脑</span></button>`,
   `        <!-- 两个次要出口收成一行：它们和"登录/注册"不是一个层级，
           各占一整行会把主操作稀释掉（第一眼看到四个同等分量的按钮 = 一个都没有） -->
      <div class="auth-links">
        <button id="authGuestBtn" class="auth-guest"><span>游客进入（不登录）</span></button>
        <span class="auth-or" aria-hidden="true">或</span>
        <!-- ★ 09-30 借鉴 billd-desk：远程控制设备码直连入口（不用先开会） -->
        <button id="authDeskBtn" class="auth-guest">${I.screen}<span>用设备码控电脑</span></button>
      </div>`],
];
let bad = 0;
for (const [f] of reps) {
  const n = s.split(f).length - 1;
  if (n !== 1) { console.error(`命中 ${n} 次：${f.slice(0, 60).replace(/\n/g, '↵')}`); bad++; }
}
if (bad) process.exit(1);
for (const [f, t] of reps) s = s.replace(f, t);
fs.writeFileSync(p, s);
console.log('登录卡结构已重排');
