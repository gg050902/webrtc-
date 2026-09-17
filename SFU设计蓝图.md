# 🏗️ SFU 架构蓝图 —— 从 Mesh 切到 Mediasoup（动手前必读）

> **这份文档回答三个问题：为什么要切 SFU、切完的"前后端各是什么"、怎么一步步落地。**
> 教学概念版见 `LEARN.md` 第 2.11 节；本文是**行动版**（架构 + 信令协议 + 目录规划 + 分阶段验收）。
>
> ✅ **实现状态（2026-09-08 更新）：本蓝图已在 `sfu/` 目录落地**——Mesh 版原样保留在根目录，
> SFU 版独立运行在 3001 端口，两版互不干扰。落地时按"教学优先"把中间管理模块合并进
> `sfu/server.js` 单文件（分区注释 A~E），对照根目录 `server.js` 读最顺；蓝图 4.3 的
> 多模块目录可作为将来拆分的参考。信令协议按第 6.3 节实现，事件总表在 `sfu/protocol.js`。
> 运行与验证见第 12 节"已落地版本的跑法"。

---

## 1. 先说结论：这份蓝图帮你切到"腾讯会议同款"架构

| 项 | 现状（Mesh 版，已 ✅） | 目标（SFU 版，本文） |
|---|---|---|
| 连接方式 | 每人连所有人（P2P 直连） | 每人只连服务器，服务器转发 |
| 人数上限 | 3（带宽墙） | 服务器带宽说了算（demo 8~10 人） |
| 服务端 | 只传信令（邮局） | 信令 + **媒体中转（mediasoup）** |
| 前端媒体 | 浏览器原生 RTCPeerConnection | `mediasoup-client`（概念仍是 WebRTC） |
| 简历叙事 | "我会 Mesh" | "我实现了 Mesh 并升级到 SFU 架构"（架构级） |

**可以复用的老代码（别扔掉）**：房间号生成/回收、入会密码、日志面板、聊天 UI、
`getStats` 监控思路、index.html / style.css 布局——SFU 只是换了"媒体怎么走"。

---

## 2. 为什么是 mediasoup（选型，面试要能答）

| 候选 | 评价 |
|---|---|
| **mediasoup**（推荐） | Node 原生、API 覆盖 SFU 全部原语（Worker/Router/Transport/Producer/Consumer），
  业界事实标准之一（声网前身团队相关、生态大）；**文档示例多，能边抄边懂** |
| LiveKit / ion-sfu | 封装更好用，但"自动帮你做了太多"，教学上黑盒化 |
| 云厂商 SDK（声网/腾讯云） | 演示最省事，但面试问到底层就是黑盒，简历减分 |
| 自己用 Node 手写转发 | 不可行：服务器端没有浏览器那套 RTCPeerConnection（libwebrtc 绑定工程量巨大） |

**结论**：要"能讲原理"就选 mediasoup——它逼你把 Worker/Router/Transport/Producer/Consumer
每一个都亲手建一遍，正好是面试要讲的东西。

### mediasoup 落地前的前置条件（缺一不可）
1. 能联网执行 `npm install mediasoup mediasoup-client`（客户端包还要单独打 vendor，见 6.2）；
2. Node.js ≥ 16（当前环境 v24 ✅）；mediasoup 安装时会编译/下载 worker 二进制，
   Windows 偶发需要 VS Build Tools 或走官方预编译包（报错就搜 mediasoup windows prebuilt）；
3. 媒体走 UDP，若部署到云服务器要放行 mediasoup 的 RTC 端口段（见第 10 节）。

---

## 3. 目标架构总览（一张图看懂 SFU 全家桶）

```
浏览器 1（主讲人）                浏览器 2（听众）              浏览器 3（听众）
┌──────────────────┐            ┌──────────────────┐        ┌──────────────────┐
│ mediasoup-client │            │ mediasoup-client │        │ mediasoup-client │
│  Transport A     │            │  Transport B     │        │  Transport C     │
│   ├ Producer 摄像头            │   ├ Producer 摄像头          │   ├ Producer 摄像头
│   ├ Producer 屏幕(可选)         │   └ Consumer ←──────────────┼── Consumer ←───┐
│   └ Consumer ←─────────────────┼── Consumer ←──┐             │                │
└─────────┬────────┘            └───────┬────────┘             └───────┬────────┘
          │ 信令 socket.io              │                              │
          ▼                              ▼                              ▼
┌────────────────────────────── Node 服务器（这一层现在变大了）──────────────────┐
│  socket.io：房间管理(复用房间号+密码) + transport/send/recv 协商事件             │
│  mediasoup Worker（一个）                                                      │
│    └─ Router「房间 123456」         ← 每个会议房间一个 Router（媒体隔离）        │
│         ├─ WebRtcTransport A ── Producer A(摄像头) ／ Consumer 给 B、C          │
│         ├─ WebRtcTransport B ── Producer B(摄像头) ／ Consumer 给 A、C          │
│         └─ WebRtcTransport C ── Producer C(摄像头) ／ Consumer 给 A、B          │
└──────────────────────────────────────────────────────────────────────────────┘
  转发 = mediasoup 内部把 Producer 的 RTP 包复制给所有订阅它的 Consumer（选择性转发）
```

### 概念词典（面试默写级）

| 词 | 一句话 | 谁建它 |
|---|---|---|
| `Worker` | mediasoup 的核心工作进程（跑 C++），一台服务器一般一个 | 服务器 |
| `Router` | 一个"会议房间"的媒体中枢，房间之间媒体完全隔离 | 服务器（每房间一个） |
| `WebRtcTransport` | 浏览器 ↔ 服务器的一条**媒体通道**（承载音视频/数据） | 服务器建好回给浏览器，浏览器 connect |
| `Producer` | 我**上传**的一路媒体（摄像头/屏幕/麦克风各一路） | 浏览器调 produce，服务器收 |
| `Consumer` | 我**订阅**到的一路媒体（某个别人的某一路） | 服务器按需建，通知浏览器接收 |
| `DataProducer/DataConsumer` | 聊天等数据的 SFU 版通道（本蓝图阶段 3 之前先用 socket.io 广播） | 同 Producer/Consumer |

---

## 4. 后端是什么（Node 侧，改动核心）

### 4.1 新增依赖
```
mediasoup        # SFU 引擎（唯一真正的新增重型依赖）
socket.io        # 已有，继续当信令（复用房间号 + 密码逻辑）
```

### 4.2 服务端职责清单（新旧对照）
| 职责 | Mesh 版（现在） | SFU 版（目标） |
|---|---|---|
| 静态页面托管 | server.js A 段 | 照搬 |
| 房间号生成/回收/密码 | server.js B/C 段 | **照搬**（rooms Map、三关校验原样复用） |
| offer/answer/ICE 转发 | C 段定向转发 | **删除**（浏览器不再直连，改成下面的协商事件） |
| Worker 生命周期 | 无 | 启动 1 个 Worker；异常自动重启 |
| Router 管理 | 无 | 建房时建 Router、房空时关 Router |
| Transport 管理 | 无 | 每人入房建 1~2 条 WebRtcTransport，离开销毁 |
| Producer/Consumer 管理 | 无 | 记每个用户的 producer 列表；有新 Producer 广播给房间其他人去订阅 |
| 转发 | 无（P2P） | 交给 mediasoup：`consumer 消费 producer` 后自动转发 |

### 4.3 建议目录（SFU 版独立成目录，别和 Mesh 版打架）
```
webrtc/
├── server.js            # ★ Mesh 版信令服务器（保留，npm start 不变）
├── sfu/                 # ★ SFU 版（新，单独跑 node sfu/server.js）
│   ├── server.js        #   入口：http + socket.io + 房间管理（从 server.js 复制改造）
│   ├── worker.js        #   mediasoup Worker 单例 + 自动重启
│   ├── router-manager.js#   房间号 → Router 的映射；建房建 Router / 房空关 Router
│   ├── transport-manager.js # 每个 socket 的 transport / producer / consumer 记账
│   ├── protocol.js      #   信令事件名与载荷的"总表"（对照协议，防两边对不上）
│   └── public/          #   前端（index.html / style.css 复制自 public/，小改）
│       ├── client.js    #   SFU 版浏览器逻辑（第 3 节导读）
│       └── vendor/mediasoup-client.js  # 本地打包的客户端库（见 6.2）
```
> 端口：SFU 版用 `PORT=3001`（`node sfu/server.js`），避免和 Mesh 版 `npm start`(3000) 撞车。
> 想"一个入口两个模式"也可以，但教学上**分开两个目录更容易对照**，先分后合。

---

## 5. 前端是什么（浏览器侧，改动核心）

### 5.1 一句话
> 前端不再自己 `new RTCPeerConnection` 去连别人，而是用 **mediasoup-client**
> 向服务器要"媒体通道"，上传自己、订阅别人。

### 5.2 前端要做的四件事（对照后端）

| 阶段 | 前端动作 | 对应概念 |
|---|---|---|
| ① 拿"房间能力" | 发 `get-router-rtp-capabilities` → 服务器回该房间 Router 支持哪些编码 | 先对齐能力，后面 produce 才不白干 |
| ② 建媒体通道 | 发 `create-webrtc-transport`（要发要收都行）→ 服务器建好 Transport 把参数发回 → 浏览器 `transport.connect()` | 双向通道已就绪 |
| ③ 上传（发） | 对本地流的每路音/视频 `transport.produce({ track })` | 我成为 Producer |
| ④ 订阅（收） | 服务器广播"有人新开了一路"→ 我发 `create-consumer` → 拿到 Consumer 的 track 塞进 `<video>` | 我成为 Consumer |

**页面长得和现在几乎一样**：房间面板（房间号+密码）、视频网格、控制栏、聊天栏都能复用；
变的只是"画面数据从哪来"：原来是 `ontrack` 塞 streams，现在是 Consumer 的 track。

### 5.3 前端依赖怎么解决（不违反"不进 CDN"铁律）
`mediasoup-client` 是 npm 包（ESM），浏览器不能直接 `<script src>`。
做法（一次性）：
```bash
cd sfu
npm i mediasoup mediasoup-client
npm i -D esbuild            # 本地打包工具（不引框架）
npx esbuild node_modules/mediasoup-client/lib/index.js \
  --bundle --format=iife --global-name=mediasoupClient \
  --outfile=public/vendor/mediasoup-client.js
```
打包一次后放进 `sfu/public/vendor/`，页面 `<script src="vendor/mediasoup-client.js">`，
**之后完全离线可用**，和现在 socket.io 的本地化思路一致。

### 5.4 DataChannel 聊天怎么办（教学取舍，先讲清楚）
切 SFU 后浏览器之间没有 P2P 连接了，原来的 DataChannel 群聊没有载体。三个选择：

| 方案 | 做法 | 改动量 | 评价 |
|---|---|---|---|
| A（推荐先用） | 聊天改走 **socket.io 广播**（服务器有现成房间） | 最小 | 先专注"媒体切 SFU"，聊天不拖后腿 |
| B（进阶展示） | 走 mediasoup **DataProducer/DataConsumer** | 中等 | 展示完整 SFU 数据面，简历更完整 |
| C | 保留一条 P2P 连接专门聊天 | 大且别扭 | 不推荐（等于又回到 Mesh） |

> 面试话术：*"SFU 后我把聊天从 DataChannel 迁移到服务器广播（或 mediasoup 数据通道），
> 因为媒体都不走 P2P 了，没必要为聊天保留一条直连。"*

---

## 6. 信令协议设计（改前后端前先对齐这份表）

### 6.1 复用的旧事件（不动）
`create-room` / `room-created` / `join-room` / `room-not-found` / `room-wrong-password` /
`room-members` / `new-member` / `peer-left` / `room-full`
→ 房间逻辑原样搬进 `sfu/server.js`，但 `new-member` 的"建 RTCPeerConnection"动作换成"等下重建 Transport/Consumer"。

### 6.2 删除的旧事件
`offer` / `answer` / `ice-candidate` 互发 → **全部不要**（浏览器不直连了）。

### 6.3 新增事件（草拟，落地时以 `sfu/protocol.js` 为准）
| 方向 | 事件 | 载荷 | 服务器动作 |
|---|---|---|---|
| C→S | `get-router-rtp-capabilities` | — | 回该房间 Router 的 `rtpCapabilities` |
| C→S | `create-webrtc-transport` | `{ direction: 'send'/'recv' }` | 在 Router 上建 Transport，回参数 |
| C→S | `transport-connected` | `{ transportId, dtlsParameters }` | `transport.connect()`（DTLS 握手） |
| C→S | `produce` | `{ transportId, kind, rtpParameters }` | 建 Producer，成功后**广播给房间其他人** |
| S→C(其他人) | `new-producer` | `{ producerId, kind, producerPeerId }` | 提醒"有人开新路了，来订阅" |
| C→S | `consume` | `{ transportId, producerId, rtpCapabilities }` | 建 Consumer 回参数 + `resume()` |
| S→C | `consumer-params` / 或 `consume` 直接回 | Consumer 参数（含远端 track 初始化所需） | 浏览器据此收流 |
| C→S | `close-consumer` 等清理 | 参考 peer-left 时服务器统一清理，浏览器端可少发 |

> 建连时机的关键约定（延续"后到者主动"的思想，改成"后到者订阅已有，先到者等新 Producer"）：
> - 新人进房：`room-members` 里已有人 → 对每个老成员的每路 Producer 都去 `consume`；
> - 老成员：等 `new-producer` 广播 → 对新人新开的 Producer 去 `consume`；
> - 谁都不需要发 offer——SFU 的协商被拆成 produce/consume 两段，比 Mesh 更简单直观。

---

## 7. Mesh → SFU 代码改动对照（帮你估工作量）

| 关注点 | Mesh 版代码 | SFU 版 |
|---|---|---|
| 每人的"连接" | `peers[remoteId] = { pc, video, box }` | 变为 `我自己的 Transport` + 每个远端 Producer 对应一个 Consumer |
| 本地媒体接入 | `pc.addTrack(track)` | `transport.produce({ track })` |
| 远端画面 | `pc.ontrack` → `video.srcObject = stream` | 每个 Consumer 的 track → 拼一个 MediaStream 塞 video |
| 画面增删 | new-member/peer-left 触发 | `new-producer` 来就建 Consumer；peer-left 时服务器关 Transport，前端删框 |
| 共享屏幕 | `replaceTrack` 换轨 | 简单方案：新开一路 Producer（摄像头保持）→ 广播；更接近真实产品 |

---

## 8. 建议先做的 Git 策略

```bash
git checkout -b mesh-final      # ① 当前可用的 Mesh 版打签保存
git checkout -b sfu             # ② 在 sfu/ 新目录干活，互不干扰
```
好处：随时能切回 `mesh-final` 演示；面试可讲"我维护过两版，明白各自的取舍"。

---

## 9. 分阶段落地路线（每一阶段都能跑、能验）

> **前置**：联网装依赖（4.1、5.3）；先 `git checkout -b mesh-final`。

**阶段 0 —— 环境探通（半天）**
- `npm i mediasoup mediasoup-client` + 打 vendor 包；
- 跑 mediasoup 官方示例（`npm run mediasoup-demo` 思路：先让官方 demo 在两个窗口通）；
- 验收：两个 Chrome 窗口能通过本地 mediasoup 互看（此时还不是你的代码）。

**阶段 1 —— 最小 SFU 闭环（1~2 天，核心）**
- 单人建 Router + 自己 Transport + produce 自己（先不订阅别人）；
- 第二人进同一房间：`consume` 第一个人的 Producer 看到对方；
- 验收：A、B 两个窗口互看，日志面板能看到 transport/produce/consume 全流程。

**阶段 2 —— 房间化 + 密码 + 动态进出（1 天）**
- 把 server.js 的房间/密码逻辑搬进 `sfu/server.js`；
- 新人中途加入能订阅到老成员；有人离开 → 服务器清 Transport/Consumer，前端删框；
- 验收：沿用 `npm test` 的思路为 `sfu/protocol.js` 事件补回归测试；3 窗口进出不断流。

**阶段 3 —— 屏幕共享 + 人数放宽 + 监控（1 天）**
- 共享 = 再 produce 一路 screen（不动摄像头）；聊天按 5.4 选方案；
- `MAX_MEMBERS` 提到 8~10，观察本机资源；
- 复用 getStats 思路：读 Consumer/Transport 的统计做网络徽标。

**阶段 4 —— 收尾（半天）**
- README/LEARN/蓝图补丁同步；写"SFU 版 vs Mesh 版"对照小节进简历叙事；
- （可选加分）simulcast/多码率、录制、AI 字幕接入。

---

## 10. 坑与风险清单（提前知道，少走弯路）

1. **安装**：mediasoup 装不上 → 查 Node 版本、Windows 编译工具链（VS Build Tools / python）、
   或用 `--build-from-source=false` 走预编译；**沙箱/无网环境装不了，先在自己电脑装**。
2. **UDP 端口**：mediasoup 默认用随机 UDP 端口做媒体，云服务器要放行并建议固定端口段
   （`worker: { rtcMinPort, rtcMaxPort }`）。
3. **只能 localhost/https 用媒体设备**：和现在一样，本地 3001 没问题，上线要 HTTPS。
4. **Transport 建几个**：简单做**每用户 2 条**（1 收 1 发）或 **1 条双向**都行，
   先选一种写死，别一开始就上复杂矩阵。
5. **Consumer 要 `resume()`**：默认 paused，忘掉 resume 会"看不见别人"（经典坑，日志看不出）。
6. **CPU/内存**：Router/Transport/Consumer 都是真资源，房间空了要 `router.close()`，防泄漏
   （和现在 `rooms.delete()` 是同一个道理）。
7. **别删老版**：Mesh 版是教学基线，删了就没得对照了。

---

## 11. 落地后的验收清单（写完代码逐条打勾）

- [ ] `node sfu/server.js` 起在 3001，控制台打印 Worker 启动、无报错
- [ ] 两个 Chrome 窗口访问 `http://localhost:3001`，创建/加入同一房间后互看
- [ ] 房间设密码 → 无密码/错密码被拒（room-wrong-password 正常）
- [ ] 第三、四窗口加入也能看到所有人（超过 3 人不受限）
- [ ] 屏幕共享 = 第二路 Producer，共享中摄像头仍可看
- [ ] 某人离开 → 其他人画面自动消失、房间空了自动销毁
- [ ] 顶部网络徽标有数值（读 Transport/Consumer 统计）
- [ ] 聊天能发（方案 A 走服务器广播或方案 B 数据通道）
- [ ] Mesh 版 `npm start` + `npm test` 依然全绿（两版共存不互相破坏）
