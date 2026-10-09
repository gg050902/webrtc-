/* ════════════════════════════════════════════════════════════════
 * sw.js —— Service Worker（G4 移动端/PWA，client.js 第 32 步注册）
 *
 * ▎这个文件到底在干什么？（先看这一段）
 *
 * PWA（渐进式 Web 应用）的"外壳"：让会议页面可以被浏览器**安装到桌面/主屏**
 * （manifest.webmanifest 负责名字和图标），并在**静态资源层面**离线可用——
 * 断网时再打开页面，壳子（页面/样式/脚本）还能渲染出来，而不是浏览器的
 * 恐龙离线页。音视频和聊天当然不能离线（那要活的服务器），所以：
 *
 *   ① 安装（install）：预热"不变的"静态文件进 Cache Storage；
 *   ② 拦截（fetch）  ：按资源性质分两路策略（见下）；
 *   ③ 三条纪律：
 *      - socket.io 的请求绝不碰——那是信令长连接/轮询，缓存了就完了；
 *      - 页面导航（document 请求）走 network-first，网络挂了才用缓存的 index.html 兜底；
 *      - 缓存名带版本号——activate 时自动清掉旧版本缓存。
 *
 * ════════════════════════════════════════════════════════════════
 * ★ 09-24 重修（真机踩到的坑，值得单独讲清楚）
 * ════════════════════════════════════════════════════════════════
 *
 * ▎现象：改了 client.js / style.css，刷新页面死活不生效。服务器明明发了
 *   `Cache-Control: no-store`，DevTools 里也是 200，可页面跑的还是旧代码。
 *
 * ▎根因：**Service Worker 完全不看 HTTP 缓存头**。它有自己的 Cache Storage，
 *   上一版 sw.js 把 './client.js'、'./style.css'、'./workbench.html' 一起
 *   预热进缓存，然后 cache-first 返回——于是 HTTP 层的 no-store 被整层绕过。
 *   更麻烦的是：SW 只在 **sw.js 自身字节变化** 时才会重装，业务代码天天改、
 *   sw.js 一动不动，旧缓存就一直管着页面（注释里那句"记得 bump 版本号"
 *   是寄希望于人的纪律，而纪律是会被忘掉的——这次就忘了）。
 *
 * ▎修法：不再用"一刀切 cache-first"，改成**按资源性质分两路**：
 *
 *   ┌ 不变的（vendor 类库、图标、manifest）→ cache-first
 *   │   socket.io.min.js / mediasoup-client.js 是下载下来就不会改的第三方包，
 *   │   又恰好是最大的两个文件（几百 KB）。它们 cache-first 既省流量又稳，
 *   │   且"永远不会过期"这件事是真的。
 *   │
 *   └ 会变的（client.js / style.css / index.html / workbench.html）→ network-first
 *       在线时永远拿最新的（这才能"改完刷新即见"）；请求失败（断网）才回落到
 *       缓存副本，离线外壳依然可用。代价是多一次条件请求——演示项目零压力，
 *       换来的是"改了就是改了"，值。
 *
 * ▎于是版本号的语义也变清楚了：
 *   改 client.js / style.css / 页面 → **不用** bump 版本（network-first 保证最新）；
 *   只有**新增或更换 vendor 里的文件**时才需要 bump SW_CACHE_VERSION
 *   （让旧缓存整体作废、重新预热）。这条规则比"每次都记得 bump"可靠得多。
 *
 * ▎和零依赖铁律的关系：Service Worker 是浏览器原生 API，零新依赖。
 * ▎教学提示：SW 一旦注册就常驻。调试时 DevTools → Application → Service Workers
 *   可以 Unregister；或者直接给地址加 `?nosw=1`（client.js 里有这个逃生舱，
 *   会当场注销所有 SW 并清空 Cache Storage，用来快速排除"是不是缓存的锅"）。
 * ════════════════════════════════════════════════════════════════ */

// 缓存版本号：只有更换 vendor/ 里的文件（或图标）时才需要 bump
const SW_CACHE_VERSION = 'meeting-v2';
const CACHE_NAME = `hui-meeting-${SW_CACHE_VERSION}`;

// ① 不变的资源：cache-first + 安装时预热（第三方类库 + 图标 + manifest）
const IMMUTABLE_ASSETS = [
  './manifest.webmanifest',
  './icons/icon-1024.png',
  './vendor/socket.io.min.js',
  './vendor/mediasoup-client.js',
];

// ② 会变的资源：network-first，缓存仅作断网兜底（业务代码 / 样式 / 页面）
//    这些也是"预热"一份，但只在网络不可用时才被读到
//    ★ 2026-10-06 加 countup.js：新写的业务代码**必须**落进这一路。
//      落到下面那条 cache-first 就等于把坑 40 重新挖一遍——改了不生效、
//      而且 SW 只在自身字节变化时才重装，"记得加一下"这种纪律一定会被忘掉。
//      （冒烟里有一条结构断言钉住这件事：sfu/public 下除 vendor 与 sw.js 之外的
//        每个 .js 都必须出现在下面两个清单里。）
const VOLATILE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './client.js',
  './countup.js',
  // ★ 2026-10-07 第 51 步：共享文件的渲染内核（docx/xlsx/pptx/md/csv 全靠它）。
  //   新写的业务 JS **必须**落进这一路，落到 cache-first 就等于把坑 40 重挖一遍。
  './fileview.js',
  './workbench.html',
];

// 用路径名判断一个请求属于哪一路（request.url 要看 pathname，不能直接字符串比）
const VOLATILE_PATHS = new Set([
  '/', '/index.html', '/style.css', '/client.js', '/countup.js', '/fileview.js', '/workbench.html',
]);

/* ---- ① 安装：预热缓存 ----
 * skipWaiting：新 SW 一装好就立刻接管页面（不等所有标签页关闭）——
 * 演示项目要"刷新即最新"，不能等旧版本自然退休。
 *
 * 注意两套资源用不同的容错：
 *   · 不变的 → addAll 严格模式（vendor 文件 404 了，说明打包坏了，就该装不上）；
 *   · 会变的 → allSettled 宽容模式（离线兜底副本而已，缺一份不该导致 SW 装不上）。 */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.all([
        cache.addAll(IMMUTABLE_ASSETS),
        Promise.allSettled(VOLATILE_ASSETS.map((u) => cache.add(u))),
      ]))
      .then(() => self.skipWaiting())
  );
});

/* ---- ② 激活：清掉旧版本缓存 ----
 * 遍历所有缓存，名字不是当前版本的整批删除（换版本 = 缓存自动失效）。
 * 这一次的 v1 → v2 就是靠这里把那份"含旧 client.js"的缓存整体清掉的。 */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim()) // 立刻接管已打开的标签页
  );
});

/* ---- ③ 拦截请求：按资源性质分流 ---- */
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // 只管 GET：POST（字幕归档 /api/captions 等）永远直连网络
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 纪律一：socket.io 的长连接/轮询绝不缓存，直接放行给网络
  if (url.pathname.startsWith('/socket.io')) return;

  /* ★ 09-24 G8：动态/受保护接口一律**不进 SW**（直接放行给网络）。
   * ▎为什么要单独列这一条，而不是让它落到下面的 cache-first？
   *   ① /api/rooms 是观测面板每 2s 轮询的**实时快照**。落到 cache-first 后，
   *      第一次 200 就被缓存，之后永远命中缓存 → 面板"卡死在第一帧"，数据不再更新。
   *   ② 这些路径现在加了管理员门禁。把带 token 拿到的 200 响应缓存下来，
   *      会让"退出登录后本浏览器还能看到旧数据"（同设备，非跨用户，但依然不对）。
   *   ③ /config.json 里的 ICE/TURN 是配置下发口，缓存了改配置就不生效。
   */
  const NETWORK_ONLY_PREFIXES = ['/api/', '/metrics', '/recordings/', '/minutes/', '/config.json'];
  if (NETWORK_ONLY_PREFIXES.some((p) => url.pathname === p || url.pathname.startsWith(p))) return;

  // 纪律二：跨域请求（比如 DeepSeek API、TURN 探测）不归本站 SW 管
  if (url.origin !== self.location.origin) return;

  // 页面导航：network-first —— 在线拿最新页面；断网时用缓存的 index.html 兜底
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req, './index.html'));
    return;
  }

  // 会变的静态资源：network-first（"改完刷新即见"靠的就是这一路）
  if (VOLATILE_PATHS.has(url.pathname)) {
    event.respondWith(networkFirst(req, null));
    return;
  }

  // 其余（vendor 类库、图标…）：cache-first，命中直接回，未命中走网络并回写
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((resp) => {
        // 只缓存成功响应（404/500 不进缓存）
        if (resp && resp.status === 200) {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
        }
        return resp;
      });
    })
  );
});

/* network-first 的公共实现：
 *   先按请求拿最新的（拿到就顺手更新缓存副本），失败才回落到缓存；
 *   连缓存都没有时，若有 fallback（导航请求用 index.html 兜底）就用它，
 *   否则返回一个明确的网络错误——总比让 respondWith 拿到 undefined 崩掉强。 */
async function networkFirst(req, fallback) {
  try {
    const resp = await fetch(req);
    if (resp && resp.status === 200) {
      const copy = resp.clone();
      caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
    }
    return resp;
  } catch (err) {
    const cached = await caches.match(req);
    if (cached) return cached;
    if (fallback) {
      const shell = await caches.match(fallback);
      if (shell) return shell;
    }
    return Response.error();
  }
}
