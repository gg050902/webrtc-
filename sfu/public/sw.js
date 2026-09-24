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
 *   ① 安装（install）：把核心静态文件一次性预热进 Cache Storage；
 *   ② 拦截（fetch）  ：所有 GET 请求先问缓存、缓存没有再走网络（cache-first）；
 *   ③ 三条纪律：
 *      - socket.io 的请求绝不碰——那是信令长连接/轮询，缓存了就完了；
 *      - 页面导航（document 请求）走 network-first，网络挂了才用缓存的 index.html 兜底
 *        （保证"壳子离线可用"，又不至于总是旧页面）；
 *      - 缓存名带版本号——部署新版时改 SW_CACHE_VERSION，activate 时自动清掉旧缓存。
 *
 * ▎和零依赖铁律的关系：Service Worker 是浏览器原生 API，零新依赖。
 * ▎教学提示：SW 一旦注册就常驻，调试时 DevTools → Application → Service Workers
 *   可以 Unregister；"改了 sw.js 不生效"多半是旧 SW 还在管页面（skipWaiting 解决）。
 * ════════════════════════════════════════════════════════════════ */

// 缓存版本号：每次发新版静态资源就 bump 这个字符串（旧缓存会在 activate 时整体清掉）
const SW_CACHE_VERSION = 'meeting-v1';
const CACHE_NAME = `hui-meeting-${SW_CACHE_VERSION}`;

// 核心静态文件清单：页面壳 + 样式 + 业务脚本 + 两个本地打包的类库 + 演示工作台 + PWA 三件套
const CORE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './client.js',
  './workbench.html',
  './vendor/socket.io.min.js',
  './vendor/mediasoup-client.js',
  './manifest.webmanifest',
  './icons/icon-1024.png',
];

/* ---- ① 安装：预热缓存 ----
 * skipWaiting：新 SW 一装好就立刻接管页面（不等所有标签页关闭）——
 * 演示项目要"刷新即最新"，不能等旧版本自然退休。 */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

/* ---- ② 激活：清掉旧版本缓存 ----
 * 遍历所有缓存，名字不是当前版本的整批删除（换版本 = 缓存自动失效）。 */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim()) // 立刻接管已打开的标签页
  );
});

/* ---- ③ 拦截请求：cache-first，但知道什么不能碰 ---- */
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // 只管 GET：POST（字幕归档 /api/captions 等）永远直连网络
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 纪律一：socket.io 的长连接/轮询绝不缓存，直接放行给网络
  if (url.pathname.startsWith('/socket.io')) return;

  // 纪律二：跨域请求（比如 DeepSeek API、TURN 探测）不归本站 SW 管
  if (url.origin !== self.location.origin) return;

  // 纪律三：页面导航 network-first —— 在线拿最新页面；断网时用缓存的 index.html 兜底
  //   （这就是"壳子离线可用"：能看到登录页，只是连不上服务器）
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((resp) => {
          // 顺手把最新的页面回写进缓存（下次离线兜底的就是这个版本）
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((c) => c.put('./index.html', copy));
          return resp;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // 其余静态资源：cache-first（命中直接回，未命中走网络并回写缓存）
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
