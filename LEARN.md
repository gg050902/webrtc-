# 【零基础】先学会读懂这个 WebRTC 项目

> 这份教程从**零开始**，只讲这个项目里用到的语法和概念。
> 学完它 + 对照注释版代码（client.js / server.js），你就"读得懂、讲得出"了。

---

## 第 0 章 总体学习路线（先看，心里有数）

```
① 玩起来（2 分钟）            → 一个窗口创建房间拿号，另一个输号加入，看视频互通 + 看日志
② 学 JS 基础（本章第 1 节）   → 本项目出现的全部语法，速成
③ 学 WebRTC 概念（本章第 2 节）→ 用生活比方讲明白 SDP / ICE / 信令
④ 读注释版代码（第 3 节）     → 从 client.js server.js 各读一遍
⑤ SFU 主版本（第 5 节）       → 跑起来 + 逐文件导读；5.7~5.40 = 每一轮升级的教学记录
⑥ 自测 + 延伸（第 4 节）      → 含 2026-09-12 ~ 09-17 各轮升级的进度清单
```

> 📌 **两条阅读路径**：想"讲清 WebRTC 原理"走 Mesh 对照版（第 2 节概念 + 第 3 节代码）；
> 想"讲得像真产品"走 SFU 主版本（第 5 节，尤其 **5.8~5.19**——D/D+/E/F/C 各档升级的教学讲法；
> **5.33~5.38**——09-24 的账号数据库 / 门禁边界 / 证书 SAN / 优雅退出 / 测试隔离 / 房间内令牌）。

---

## 第 1 节 JS 语法速成（本项目的全部语法，够用）

### 1.1 变量：`const` 和 `let`
```js
const name = '小明';  // const = 定死的值，以后不能改
name = '小红';        // ❌ 报错！const 不能改

let count = 0;        // let = 能改的值
count = 1;            // ✅ 可以改
```
**本项目用法**：`let localStream`, `let pc` 用 let（因为后面要赋值）；
按钮、元素引用那些不改的用 const。

### 1.2 函数：三种叫法（其实本质是一种）
```js
// ① 普通函数（function 开头）
function add(a, b) { return a + b; }

// ② 箭头函数（=> 更简洁，回调里最常见）
const add2 = (a, b) => a + b;

// ③ 回调函数（把函数当参数传给另一个函数，等事件发生时才执行）
btn.addEventListener('click', () => { console.log('有人点了我'); });
```
**本项目用法**：`socket.on('join', () => {...})` —— 服务器来了 join 消息才执行，
这个"() => {...}"就是回调。

### 1.3 异步：`async` / `await`
有些操作要等（比如等用户点"允许摄像头"、等数据从网络传来）。
```js
async function demo() {
  const result = await somethingSlow(); // 停在这里等它完成
  console.log(result);                   // 完成后才执行这一行
}
```
**记忆口诀**：`async` = "我允许自己等待"；`await` = "在这等一下"。
**本项目用法**：`await getUserMedia(...)` 等摄像头；`await pc.createOffer()` 等对方。

### 1.4 对象和属性（WebRTC 里到处都是对象）
```js
const person = { name: '小明', age: 18 };
person.name;   // '小明'  （用 . 取属性）
person.age;    // 18
```
**本项目用法**：`offer.type`, `candidate.candidate`, `localStream.getTracks()`。

### 1.5 模板字符串（反引号 + ${}）
```js
const who = '对方';
console.log(`我现在在等${who}`);   // 输出：我现在在等对方
```
**本项目用法**：`log(\`已进入房间「${roomNumber}」\`);`

### 1.6 常用小技巧（本项目出现过的）
```js
arr[0]        // 取数组第一个元素
arr.split(' ')// 把字符串按空格切成数组，如 "a b c" → ['a','b','c']
arr.length    // 数组长度
elem.disabled = true   // 让按钮变灰不可点
elem.textContent = 'xxx' // 改元素文字
```

**👉 到这里 JS 够用了。** 回到项目里看到不认识的就查这一节。

---

## 第 2 节 WebRTC 概念（用生活比方讲懂）

### 2.1 一句话总结 WebRTC 是啥
> **浏览器内置的"视频通话能力"**：浏览器之间能直接传音视频，不经过服务器。
> 你不用懂编码 H.264、不用搭转发服务器，调浏览器 API 就行。

### 2.2 P2P（点对点）和"中间人"的关系 —— 核心中的核心

想象 A 和 B 约在咖啡馆见面（联网见面）。

- **媒体（咖啡本身）**：A 把咖啡递给 B —— 直接给，不经过任何人。★这是 P2P。
- **但要约成，必须有个中间人先"传话"**：
  - "A：我在 X 咖啡馆，穿红衣服，想见你 B。"  ← **这就是 offer（发起方开口）**
  - "B：收到！我在 Y 咖啡馆附近，你会找到我的。" ← **这是 answer（接听方回应）**

**中间传话的人，就是信令服务器。**
> **通俗定义：信令 = 双方建立连接前的"传话商量"过程。**
> 传话结果就是"我知道了怎么找到你"，然后媒体直接开聊（P2P）。

### 2.3 SDP —— 一张"能力清单"（offer 里装着它）
SDP 是一段长长的文本，讲"我能编什么码（H.264/VP8）、多大的分辨率、什么网络地址"。可以想象成**相亲资料**：
- 我支持打电话 / 视频 / 1080p
- 我的联系方式是……

**offer/answer 模型**（源自电话协议）：
- caller 递上自己的清单 **offer**："我的能力在这。"
- callee 看着清单回 **answer**："这些我都能接受，成交。"
- 两边一对照，达成一致 → 开始传数据。（面试常问这个流程）

### 2.4 ICE + STUN + NAT 穿透 —— "怎么找到对方的路"
**问题**：A 和 B 都在各自家里路由器（NAT）后面，对外只有一个公网地址，
直接联系不到对方的"真正地址"。

比喻：你们住在大楼里，**每户有房号（内网地址），整栋楼只有一个大门（公网地址）**。

**STUN**（问路的）：给 STUN 服务器打电话："我从哪个地址出来的？"
它告诉你："你从 202.96.x.x:54321 出来。"（这叫 srflx 候选）

**ICE**（探路的）：
- 浏览器自动收集所有候选地址（本机内网 host + STUN 问到的公网 srflx）
- 双方把候选**互相对发**（走信令），然后挨个试着连
- 连通的那条就是最终路径（常是本机内网=最快的 host）

| 候选类型 | 含义 | 日志显示 |
|---|---|---|
| host | 本机/局域网地址，最快 | candidate（IP: 192.168.x.x） |
| srflx | STUN 问出的公网地址 | candidate（IP: 公网IP） |
| relay | 走 TURN 中继兜底（打洞失败时） | — |

**▶ 亲手实验**：你的两个窗口都在本机，所以直接走 host（127.0.0.1）就通，
根本不依赖外网。**把它们放到两台设备连不同 WiFi**，才会看到 srflx/relay。

### 2.5 一次完整通话（把上面串起来 + 对应代码位置）

```
[你打开网页]
  getUserMedia()                ← 开摄像头/麦克风        (client.js 第 4 步)
  socket.io 连上服务器           ← 找中间人               (client.js 第 3 步)
[你点「创建房间 / 输房间号加入」]
  create-room / join-room        ← 拿房间号 / 凭号进房     (client.js 第 5 步)
[进房后：新人是 caller，老成员是 callee]
  createPeerFor()               ← 为对方建 P2P 连接对象   (client.js 第 7 步)
  caller: createOffer() → setLocalDescription → 发起方先递清单 (client.js 第 8 步)
  callee: createAnswer() → setLocalDescription → 接听方回清单 (client.js 第 10 步)
  双方通过信令互相发 ICE 地址    ← 找路                   (client.js 第 11 步)
  连通 → onconnectionstatechange → connected             (client.js 第 7 步)
  对方媒体到达 → ontrack → 播放  ← 🎉 看到对方了！        (client.js 第 7 步)
```

---

## 第 2.5 节 从 1对1 到多人会议（Mesh）—— 本次升级的核心

> 现在项目已经升级成"最多 3 人的 Mesh 会议"了。这一节讲清楚**架构对比 + 代码只改了哪几处**。

### 2.5.1 三种多人会议架构（面试必考，PDF 第 10 章）

通讯类软件（腾讯会议/声网/zoom）的多人架构，就三种：

| 架构 | 怎么连 | 带宽开销 | 谁用 | 优点 | 缺点 |
|---|---|---|---|---|---|
| **Mesh**（网状） | 每人连所有人 | N-1 条连接，人越多越炸 | 小规模/教学 demo | 最简单，服务器只传信令 | 3 人以上带宽/CPU 爆炸 |
| **SFU**（选择性转发） | 服务器转发流，每人只连服务器 | 每人只上传 1 份 | **腾讯会议/声网都用这个** | 服务器转发视频包，P2P 无压力；支持大群 | 服务器带宽成本高，要部署 Mediasoup 等 |
| **MCU**（混合） | 服务器先混画面再发 | 服务器重负载 | 老牌会议网 | 客户端最省 | 服务器贵、有延迟，现在少用 |

**记忆点**：拿"咖啡馆聚会"打比方——
- Mesh：每个人都亲自和其他人对话（人一多嘴就忙不过来了）
- SFU：所有人对一个人讲话，那个人再逐句转述给别人（中间商 SFU）
- MCU：中间人有超大会议室，把所有人合成一个画面再放给你们看

> **本次 demo 用 Mesh**：它代码最少、最能讲清"P2P 连接"的本质。
> 真正理解 Mesh 后，理解了 SFU 的"服务器转发"，也只是换个中转对象而已。

### 2.5.2 Mesh 版的信令流程（新增的依赖，必看）

```
[浏览器打开]
  连接服务器 → 打开摄像头
[点「创建房间」或输房间号点「加入房间」]
  ├─ 创建 → 服务器生成 6 位房间号，回 room-created（右上角显示房间号）
  ├─ 加入但房间号不存在 → 服务器回 room-not-found（进不来）
  └─ 成功进房：
      ├─ 我是第 1 个人 → 服务器回 room-members:{members:[]}（没人可连）
      ├─ 我是新人     → 服务器回 room-members:{members:[老成员ID...]}
      │                   ↓ 我对每个老成员主动发 offer（我当 caller）
      │                   ↓ 老成员回 answer、双方互发 ICE → 双向连接
      └─ 我是老成员   → 服务器广播 new-member:{id:新人ID}
                          ↓ 我只 createPeerFor（等新人 offer 上门）
```

**为什么"新人主动、老人被动"？**
防止两个人都抢着发 offer（叫 **glare 冲突**）。约定好了就不乱。

### 2.5.3 服务器（server.js）和 1对1 版差在哪

| 项目 | 1对1 版 | 多人 Mesh 版 |
|---|---|---|
| 撮合方式 | `waitingSocket` 一个等候位 | `rooms` Map + 6 位房间号（第 2.8 节） |
| 加入事件 | `join` | `create-room`（建房拿号）/ `join-room`（凭号加入） |
| 新成员通知 | 直接配对 | 广播 `new-member` + 回 `room-members` |
| 转发 | 直接 `socket.peer` 转 | **定向**：`emit to` 指定收件人，带 `from` |
| 上限 | 固定 2 人 | `MAX_MEMBERS=3`，满了回 `room-full` |

**最关键的代码变化：**
1对1 版转发：`socket.peer.emit('offer', offer);`  →  谁都是我唯一的对方
多人版转发：`io.to(to).emit('offer', { from: myId, offer });`  →  发给"指定的 to"

### 2.5.4 client.js 和 1对1 版差在哪

| 项目 | 1对1 版 | 多人 Mesh 版 |
|---|---|---|
| 连接 | 单个 `pc` | `peers` 字典：`remoteId → {pc, video, box}` |
| 画面 | 页面写死一个 `remoteVideo` | 每个成员**动态创建**一个 `<video>` |
| 加入 | `join` + 等配对 | `join-room` + 新人主动连所有老成员 |
| offer 目标 | 发给唯一对方 | `connectToPeer(remoteId)` 定向发 |
| answer | 存到一个 pc | `peers[from].pc` 存到对应连接 |
| 离开 | 收 peer-left 刷新 | 关对应连接 + 删对应视频框 |

**"字典"就是你这次必须理解的东西**：`peers` 像一本电话簿，
"成员的 id → 他的连接和画面"。因为 3 个人=每人连 2 人=要管理 2 条**独立**的 pc。

---

## 第 2.6 节 屏幕共享（本次新功能 · PDF 第 4.3 / 12 章）

多人会议已经能互通了，这一节升级**最实用**的功能：把屏幕共享给所有人。

### 2.6.1 一句话原理

> **共享屏幕 = 把"视频发送器"的轨道临时换成屏幕流，不重建连接。**

你该记住的关键词是 **replaceTrack（换轨）**。

### 2.6.2 为什么要用 replaceTrack，而不是重新连一次？

WebRTC 里想换共享内容，**不需要**重新握手/重建连接。原因：
- 双方连接早就建好了（pc 还在）
- 只是里面"我发出的视频"这一路要换内容
- 每个 pc 上有个 **sender（发送器）**，它负责把我的一路视频发出去
- 用 `sender.replaceTrack(新轨道)` 告诉它"以后发这个"，浏览器立刻换

这就像你把投影仪换成另一个 HDMI 接口——**投影仪（连接）不用重新买**，只换输入源。

### 2.6.3 关键 API 对照（对应代码注释）

| API | 作用 | 代码位置 |
|---|---|---|
| `getDisplayMedia()` | 让浏览器弹"选哪个窗口/整个屏幕"，得到屏幕流（类似 getUserMedia） | shareBtn 事件 |
| `pc.getSenders()` | 拿到这条连接上所有"我发出的轨道"的发送器列表 | replaceVideoOnAll |
| `.find(s => s.track.kind === 'video')` | 从发送器里找到"视频"那个 | replaceVideoOnAll |
| `sender.replaceTrack(新轨道)` | ★ 换轨：把发出的视频换成新内容 | replaceVideoOnAll |
| `track.onended` | 用户点系统"停止共享"时自动触发 | shareTrack.onended |

### 2.6.4 共享流程（看代码注释，思考顺序）

```
点「共享屏幕」
  getDisplayMedia() → screenStream（选窗口）
  screenTrack.onended = () => stopSharing()   // 防止忘记清理
  对所有 peer：replaceVideoOnAll(screenTrack) // 换轨，大家看到你的屏幕
  localVideo.srcObject = screenStream          // 本地预览也换
再点「停止共享」（或系统停止）
  replaceVideoOnAll(cameraTrack)               // 换回摄像头
  localVideo.srcObject = localStream
```

**面试能讲的升级点**：
- 屏幕共享和摄像头可以**同时开**（一个视频框放屏幕、一个放摄像头）——用第二条 video track 即可
- 生产场景 `getDisplayMedia` 的 `audio:true` 还能把屏幕上放的声音也采集（本 demo 先关掉，简化)
- 本 demo 里"关摄像头"按钮在共享时被禁用（因为摄像头轨暂时不发送）

---

## 第 2.7 节 DataChannel 聊天（本次新功能 · PDF 第 12.5 章）

多人能视频能共享屏幕了，这一节加上**文字聊天**。功能不复杂，但它是你彻底分清
"信令 vs 数据通道"的关键一课，面试很值得讲。

### 2.7.1 一句话原理

> **数据通道 DataChannel = P2P 连接建好之后，同一条隧道里再开一个"文本/数据小门"。**

视频走一条轨道，聊天文字走 DataChannel——**都直接 P2P 传，都不经过服务器**。

### 2.7.2 先分清三件事（重要）

| 概念 | 干什么 | 走哪 | 何时建立的 |
|---|---|---|---|
| **信令**（offer/answer/ICE） | 找对方、对齐能力 | 服务器（还没 P2P） | 建连接前 |
| **媒体流**（视频音频） | 传画面和声音 | P2P 直连 | 建连接时 |
| **DataChannel** | 传文本/文件/控制数据 | P2P 直连 | 建连接时顺便开 |

**面试话术**：*"信令阶段还没找到对方，所以必须经过服务器撮合；一旦 P2P 通了，
实时文本就走 DataChannel——它和音视频在同一连接上，只是协议不同。"*

### 2.7.3 谁建通道、谁收通道？（Mesh 的核心约定）

每一条 P2P 连接上，DataChannel 是"一问一答"：
- **主动建连方**（本 Demo 里是"新人"）调 `pc.createDataChannel('label')`
  自己创建通道——通道的"开通信息"会写进 SDP 一起发给对方
- **对端/接听方**不用主动建，只要挂 `pc.ondatachannel` 事件，
  当通道信息随 answer 到达后，浏览器会在这里"吐"出一条已接好的通道

| 角色 | 动作 | 关键 API |
|---|---|---|
| 新人（主动建连） | `connectToPeer` 里 `pc.createDataChannel('chat...')` | createDataChannel |
| 老成员（接听） | `createPeerFor` 里挂 `pc.ondatachannel` | ondatachannel |

> ⚠️ 主动方必须**在 setLocalDescription / 发 offer 之前**调 createDataChannel，
> 通道才会被写进 SDP 并传送给对方。忘开会一直收不到对方的频道。

### 2.7.4 发送与接收（两端都要监听 onmessage）

```js
// 收：无论你是主动建还是接听方，都给 channel 挂 onmessage
channel.onmessage = (e) => 显示(e.data);

// 发（群聊）：遍历所有已开通的通道，逐个 send
Object.values(channels).forEach(ch => { if (ch.readyState === 'open') ch.send(text); });
```

**两个关键状态判断**：
- `channel.readyState === 'open'` 才表示通道已连好、可以 `send`（否则会报错）
- 画面刚建好、通道还没 open 的那一瞬，消息容易发不出去——所以发送前要判断

### 2.7.5 对应代码（结合注释读）

| 功能 | 在 client.js 的位置 |
|---|---|
| channels 字典声明 | 「第 6 步」附近 `const channels = {}` |
| 接收显示/工具函数 | `appendChat` / `escapeHtml` / `watchIncomingChannel` |
| 主动方建通道 | `connectToPeer` 里 createDataChannel |
| 接听方收通道 | `createPeerFor` 的回调 4 `pc.ondatachannel` |
| 发送（群聊广播） | 「第 15 步」`sendChat` + 回车事件 |

**为什么用 `label.startsWith('chat')` 判断**？本 Demo 为了演示给 label 加了随机尾巴
（`'chat_' + 随机串`），所以判断不能精确等于 `'chat'`，用前缀匹配更稳。

### 2.7.6 面试升级点（做完这一段你就能聊）

- **XSS 转义**：聊天内容里可能出现 `<script>` 等，直接用 innerHTML 插入有安全风险，
  所以代码里有 `escapeHtml` 转义——一个很能体现工程意识的细节
- **一对一 & 群聊**：Demo 是群聊广播（发给所有 open 通道）；改成私聊 = 只发 `channels[指定]`
- **更多用途**：DataChannel 不止聊天——传二进制文件、传鼠标键盘事件（远程桌面）、
  传游戏操作帧……PDF 第 12.5 章、第 13 章的终极项目都靠它

---

## 第 2.8 节 房间化（本次新功能 · 房间号的创建与加入）

多人会议、共享屏幕、聊天都有了，这一节把"写死的固定房间"升级成**真正的房间**：
像腾讯会议一样，**创建会议拿会议号、凭会议号加入**。

### 2.8.1 一句话原理

> **房间号 = 房间的钥匙。服务器是发钥匙、验钥匙、回收钥匙的管理员。**

- 创建房间：服务器随机生成一个**没人占用的 6 位数字**当房间号，登记进 `rooms` 总表，
  把号发给创建者——页面右上角显示出来（这就是"房间号输出"）
- 加入房间：拿别人给的 6 位号来查表——**查不到就回 `room-not-found`**（输错/已散会）
- 回收复用：房间里人走光就销毁，号码回到"号码池"，以后可能再次被生成

### 2.8.2 新增的信令消息（对照 server.js）

| 消息 | 方向 | 含义 |
|---|---|---|
| `create-room` | 客户端 → 服务器 | 帮我开个新房间 |
| `room-created` | 服务器 → 创建者 | 房间号是 xxx（前端显示 + 服务器控制台也打印） |
| `join-room` | 客户端 → 服务器 | 我要进 xxx 房间（以前带的是写死的房间名，现在带房间号） |
| `room-not-found` | 服务器 → 加入者 | 房间号不存在（格式不对 / 没这个房 / 已散会） |

`room-members` / `new-member` / `room-full` / `peer-left` 全都不变——
房间化的改动集中在"**怎么进房间**"，进房之后的 Mesh 建连逻辑一行没动。
这正是好架构的标志：加功能只动"入口"，不动"主体"。

### 2.8.3 房间号是怎么生成的（随机 + 查重）

```js
function generateRoomNumber() {
  let num;
  do {
    num = String(Math.floor(100000 + Math.random() * 900000)); // 随机 100000~999999
  } while (rooms.has(num)); // 撞上"还没散会的房间"就重摇一次
  return num;
}
```

三个细节值得讲（面试能说）：
1. **为什么是 6 位数字**？对齐真实产品（腾讯会议是 9~11 位）；6 位对 demo 够用、好念好输
2. **为什么要查重**？随机数可能撞上"正在进行"的房间——两场会用同一个号就串会了
3. **为什么能复用**？房间空了就从 `rooms` 删掉（`disconnect` 里 `rooms.delete()`），
   号回到号码池可再被生成；顺便避免 Map 越积越大（内存泄漏）

### 2.8.4 前端体验（对应 client.js 第 5 步 / index.html）

| 功能 | 实现 |
|---|---|
| 创建房间 | 点「创建房间」→ `create-room` → 收 `room-created` → 右上角徽标显示房间号 |
| 凭号加入 | 输 6 位号点「加入房间」（输入框回车也行）→ `join-room`；号错弹"房间不存在" |
| 房间号输出 | 右上角 `roomBadge` 常驻显示；服务器控制台也打印每个新房间的号 |
| 邀请链接 | 点房间号徽标 → 复制 `http://localhost:3000/?room=123456` 这样的链接 |
| 链接直达 | 页面加载时用 `URLSearchParams` 读 `?room=` 参数，有就**自动进房**（邀请链接的接收端） |

### 2.8.5 面试升级点

- **为什么"加入"要求房间必须已存在，"创建"不用**？房间号是服务器发的、唯一可信；
  若让客户端随便起房间名，就会出现"我起了个和你同名的房"这种歧义
- **安全短板（能主动讲反而加分）**：本 demo 现在已经做了**入会密码**（第 2.9 节），
  但还没做**主持人审批、等候室、参会身份鉴权**——这些是生产版要补的，腾讯会议全都有
- **房间销毁时机**：最后一个成员 `disconnect` 时删房间。想想如果不删，
  长期运行的服务器 `rooms` Map 会无限膨胀

---

## 第 2.9 节 入会密码（本次新功能 · 给房间"上锁"）

> 一句话：**房间记录里多存一个 `password` 字段；join-room 要过"三关"，其中第三关就是密码。**

房间化做完后，任何知道房间号的人都能进来——demo 够用，但离真实产品差一步。
腾讯会议创建会议时可以设密码，别人光有会议号还进不来，这就是**入会密码**。

### 2.9.1 服务器改了什么？（两个小改动）

**改动 1：`rooms` 的值从"成员 Set"升级成"房间记录对象"**——因为一个房间现在要记两件事：
谁在里面（members）、要不要密码（password）：

```js
// 以前：room = Set(成员id)
// 现在：room = { password: '8888' 或 null, members: Set(成员id) }
rooms.set(roomNumber, { password: password || null, members: new Set() });
```

**改动 2：join-room 从"过两关"变"过三关"**：

```
格式关：6 位纯数字？          ← 不对 → room-not-found
存在关：rooms 里有这个号？    ← 没有 → room-not-found
密码关：房间设了密码，你答对了吗？← 不对 → room-wrong-password（新增事件）
```

注意：**没设密码的房间（password 为 null）跳过第三关**，行为跟以前一模一样。

### 2.9.2 新增/变化的信令消息（对照 server.js）

| 消息 | 方向 | 载荷变化 |
|---|---|---|
| `create-room` | 客户端 → 服务器 | 可带 `{ password }`（创建者填了密码才带） |
| `join-room` | 客户端 → 服务器 | 多带 `{ password }`（没填就是空串） |
| `room-wrong-password` | 服务器 → 加入者 | 新增：房间在、但密码不对/没填 |

### 2.9.3 前端体验：一个密码框，两种用法

页面房间面板新增一个密码框，**创建者和加入者共用**（client.js 第 5 步）：

- **创建者**：先填密码 → 点「创建房间」→ 这个房间就上锁了；
  把**房间号 + 密码**都告诉对方才能进
- **加入者**：填对方给的密码 → 点「加入房间」→ 答对才开门
- **邀请链接直达**（`?room=123456`）：自动加入时没带密码 → 服务器回
  room-wrong-password → 页面把房间号回填、光标停到密码框，补填密码回车即可（不用重输房间号）

### 2.9.4 面试升级点

- **密码该放哪验证？** 服务器。客户端校验只是防手滑，服务器校验才是真正的门卫
  （前端代码可被绕过，**信任边界在服务器**——这句话面试很加分）
- **本 demo 的密码是明文存的**：真实产品要哈希存储（如 bcrypt），防止服务器数据库泄露后密码裸奔
- **没有错误次数限制**：生产要加"试错 N 次锁一会"，防暴力猜密码；再加**主持人审批/等候室**
  把"不知道密码的人"挡在门外（当前只挡"密码不对的人"）

---

## 第 2.10 节 getStats 网络监控（本次新功能 · PDF 第 14 章）

> 一句话：**每隔几秒调一次 `pc.getStats()`，让浏览器把连接的真实统计吐出来，
> 把"网络好不好"翻译成人话，显示在页面角落。**

视频通了 ≠ 网络好。真实会议软件会在角落显示"网络良好/一般/较差"，
原理就是读 WebRTC 的统计报告——这也是面试里"你做过网络质量监控吗"的答案。

### 2.10.1 三个关键统计报告（对照 client.js 第 16 步注释）

| 报告类型 | 谁产生的 | 能读到什么 | 对应我们看的指标 |
|---|---|---|---|
| `inbound-rtp` | 我这一端 | 收了多少包、丢了多少包、收了多少字节 | 丢包率（下行） |
| `outbound-rtp` | 我这一端 | 发出了多少字节 | 上行码率 |
| `remote-inbound-rtp` | **对方**发回的反馈 | `roundTripTime`：我的包他们多久收到 | 延迟 RTT |

> 直观理解：`inbound-rtp` 数的是"我收到的包裹"，`outbound-rtp` 数的是"我寄出的包裹"，
> `remote-inbound-rtp` 是"对方写信告诉我：你寄的包裹我收到了，平均晚了几毫秒"。

### 2.10.2 三个指标怎么算？（最容易讲错，先想清楚）

1. **丢包率** = 丢掉的包 ÷ (收到的包 + 丢掉的包)。丢包 = 对方发来但我没接住的数据包。
2. **延迟 RTT**：`remote-inbound-rtp.roundTripTime` 单位是**秒**，乘 1000 变毫秒。
3. **码率为什么不能直接读？** 浏览器只给"累计字节数"（从通话开始的总量）。
   想看"现在每秒传多少"，必须**两轮采样做减法**：
   `(这轮的 bytes − 上一轮的 bytes) × 8bit ÷ 两轮间隔秒数 ÷ 1000 = kbps`。
   client.js 里 `lastStatsSample` 就是用来存"上一轮总量"的。

### 2.10.3 前端怎么呈现

- 顶部徽标 `netBadge` 每 3 秒刷新一次，绿=良好、黄=一般、红=较差；
- 显示内容：`📶 网络良好 · 丢包0.0% · 延迟45ms · ↑1500 ↓800kbps`；
- Mesh 多人 = 把每条连接的统计**加起来**看整体（client.js 第 16 步 `monitorNetwork()`）。

### 2.10.4 面试升级点

- **为什么是 3 秒采样**？太频费 CPU、太疏反应慢——真实产品会做"滑动窗口 + 加权平均"
- 真正的生产指标：**卡顿率**（frame 间隔超阈值）、**jitter buffer**、**发送/接收码率曲线**……
  本 demo 是入门三件套（丢包/RTT/码率），够讲清 `getStats` 的读法
- 对照调试：打开 `chrome://webrtc-internals`，能找到一模一样的这些报告——面试可以说
  "我用它验证过自己代码读出来的统计是对的"

---

## 第 2.11 节 SFU —— 架构的下一个大台阶（概念预习）

> ✅ 概念先在这里讲透；**代码已在 `sfu/` 目录落地**（2026-09-08，mediasoup 3.26）：
> 怎么跑、逐文件怎么读，见 **第 5 节**；当初的动手设计蓝图见 `SFU设计蓝图.md`。
> Mesh 版（根目录，3000 端口）原样保留，两版互不干扰，正好对照着学。

### 2.11.1 为什么要从 Mesh 切到 SFU？

复习第 2.5.1 节的表：Mesh = 每人连所有人，3 人 = 每人上传 2 份、5 人 = 4 份，
**人一多，每个客户端的带宽和 CPU 先爆**。腾讯会议/声网这类真实产品用的是 **SFU**：
每个人都只连服务器、只上传 1 份，由服务器**选择性转发**给需要的人。
谁该切？想冲更高 offer、想让项目"架构级"加分、想演示 >3 人会议时——切。

### 2.11.2 SFU 世界里多出来的四个词（对照 LEARN 2.5 的 Mesh，很好懂）

| 词 | 在 SFU 里的角色 | 类比 |
|---|---|---|
| **Worker** | mediasoup 启动的工作进程，一个进程内可以开多个 Router | 一台服务器/一栋楼 |
| **Router** | 一个会议房间的"媒体中枢"，独立转发域 | 一个会议室 |
| **Transport** | 浏览器和服务器之间的一条**媒体通道**（双向） | 会议室的门 |
| **Producer / Consumer** | 我通过 Transport **上传**的一路媒体 / 别人通过 Transport **订阅**到的一路媒体 | 我讲的话 / 我听到的每个人 |

一句话串起来：**浏览器建一条 Transport 进 Router；发言 = 创建 Producer；
听别人 = 创建 Consumer；服务器把 Producer 的包复制转发给每个订阅的 Consumer。**
这就是"SFU 转发"的本质——不再有浏览器之间的直接 P2P。

### 2.11.3 前端和后端各要变成什么样？（已实现，对照 sfu/ 目录看）

| | Mesh 版（根目录，3000） | SFU 版（sfu/ 目录，3001，✅ 已实现） |
|---|---|---|
| 前端媒体 | 原生 `RTCPeerConnection` 直连 | `mediasoup-client`：建 Transport → Producer/Consumer |
| 前端信令 | offer/answer/ICE 互发 | 换成一整套**协商事件**（capabilities / transport / produce / consume） |
| 后端 | 只转发信令（邮局） | 变成**媒体中枢**：Worker/Router/Transport 管理 + 转发 |
| 后端依赖 | 只有 socket.io | + **mediasoup**（已安装） |
| 聊天 | DataChannel P2P | 走服务器广播（方案 A，见 5.4/蓝图 5.4） |
| 人数上限 | 3（Mesh 带宽墙） | 8（受服务器带宽限制） |

### 2.11.4 你该记住的结论

- Mesh 你已经会了；SFU 不是新知识，是**把"直接连人"换成"连服务器，服务器转"**
- 面试金句：*"我做 Mesh 是为了理解 P2P 全流程；架构上我清楚生产必须上 SFU，
  并已基于 mediasoup 实现了一版（Worker/Router/Transport/Producer/Consumer 全套）。"*
- **现在就去跑它**：照第 5 节把 `sfu/` 版跑起来（两个窗口互看），
  再回来对照蓝图 `SFU设计蓝图.md` 看每一处设计是怎么落地的

---

## 第 2.12 节 H5 远程协助（本次新功能 · 已全部落地）

> 规划/协议/坑清单都在 `H5远程桌面-规划.md`，这一节讲"怎么理解 + 代码在哪"。
> 一句话：**把 DataChannel 从"传聊天文字"升维成"传控制命令流"**——
> 屏幕共享下行（画面给你看）+ ctrl_ DataChannel 上行（鼠标键盘命令回传）。

### 2.12.1 浏览器的边界（先记住做不到什么，再谈做到了什么）

- **做不到**：JS 合成事件的 `isTrusted === false`，页面在沙箱里，**不可能**
  把点击"发送"到被控者电脑上的 Word/微信/桌面 → 纯浏览器做不了 OS 级远程桌面。
  真产品（向日葵/RustDesk）靠**本机原生 agent**（robotjs 类）执行输入。
- **做得到**：被控端打开一个**同源 iframe 工作台**（`public/workbench.html`，
  白板+文本框+拖球），共享"当前标签页"；控制端的输入经 ctrl 通道到达后，
  在 iframe 的 `contentDocument` 里 **dispatchEvent 重放** → 画线/打字/拖球真实发生。
- 面试金句：*"把执行器从 DOM 换成本地 agent，就是生产方案的形态——
  链路（共享下行/命令上行/坐标映射/授权模型/节流）我全做透了。"*

### 2.12.2 数据流（两条路，别混）

```
授权流（低频，走服务器邮局）：
  B emit remote-request → A 弹卡片 → A emit remote-answer(ok) →
  服务器记 remoteCtl 表 + 广播 remote-state（全房 UI 同步、互斥）
输入流（高频，走 P2P DataChannel，不经服务器）：
  A 建通道（授权方主动权！）→ B ondatachannel 收 → open 后互发 ping/pong →
  B 采集输入 → 归一化 → 节流 → send（A5 起：鼠标/滚轮=16 字节二进制帧，
  键盘/中文文本=JSON 混帧）→ A 重放到工作台 iframe
```

> ★ SFU 版的输入流不走 DataChannel（浏览器之间没有 P2P 连接），改走
> `remote-input` 信令经服务器定向转发——同一个功能的两种传输形态，见**第 5.7 节**。

- **谁建 ctrl 通道**：被控端 A 允许后在 `peers[B].pc` 上 `createDataChannel('ctrl_xxx')`
  （client.js 第 5.6 步 `openCtrlChannel`）——"只有我同意才有通道"，授权方握主动权。
- **一条连接两条通道**：聊天 `chat_` + 控制 `ctrl_` 并存，`ondatachannel` 按
  label **前缀分发**（回调 4）——SCTP 本来就是多流复用，面试可讲。

### 2.12.3 三个核心技术点（对应 client.js 第 17/18 步）

1. **坐标归一化**（第 17 步）：两端窗口大小不同 → 传 0~1 相对值。
   基准取"视频画面内容实际显示的矩形"（`getVideoDrawRect`，处理 object-fit: cover
   的裁剪），A 端 × 自己视口尺寸还原 → 不管窗口怎么变形都点得准。
2. **节流**（第 17 步）：mousemove 高频 → `requestAnimationFrame` 每帧只发最新位置
   （丢中间帧保实时）；wheel 60ms 合并增量。DataChannel 默认可靠有序，丢帧靠节流。
   ★ A5② 再加一层"自适应节流"：按 getStats 测到的 RTT 决定每 1/2/4 帧发一条
   （RTT>200ms 时降到约 15fps）——发送频率跟着网络质量走（见 2.12.7）。
3. **事件重放**（第 18 步 `replayRemoteInput`）：new PointerEvent/KeyboardEvent +
   dispatchEvent。三个坑必须记住：
   - 合成 mousedown **不会聚焦**输入框 → 命中文本区时手动 `focus()`；
   - 合成 keydown **不会插字**（默认行为没了）→ `execCommand('insertText')`
     代插字符、`'delete'` 代退格、`'insertLineBreak'` 代回车；
   - 重放范围**锁死 iframe 内**（`elementFromPoint` 命中判定），会议 UI 绝不遥控。

### 2.12.4 对应代码位置

| 内容 | 位置 |
|---|---|
| 授权信令 + remoteCtl 互斥表 | `server.js` 事件 5.5（Phase 1） |
| ctrl 通道建立/协议/ping-pong | `client.js` 第 5.6 步 + `watchCtrlChannel` |
| 控制端采集/归一化/节流 | `client.js` 第 17 步 |
| 被控端工作台/重放/远程光标 | `client.js` 第 18 步 + `public/workbench.html` |
| 全路径清理（离开/停共享/收回） | `client.js` `cleanupRemoteCtrlForPeer`/`endHostControl`/`turnOffAssist` |

### 2.12.5 怎么人工验证（两窗，Ctrl+F5 强刷）

1. A「共享屏幕」→ 选**当前标签页** → 点「允许远程协助」（页面切到工作台）；
2. B 在 A 的视频框点「请求控制」→ A 点「允许」→ 两端日志出现
   "远程控制通道已开通 ✅"+"ping/pong 双向就绪"；
3. B 在 A 画面上拖动鼠标画线 / 打字 / 拖小球 → A 的工作台实时变化（旁观者也看得到）；
4. 收尾三连都能断开：B 点「释放控制」/ A 点「收回控制」/ A 停止共享；
5. ★ A2 验证：B 的输入法切中文 → 在 A 的文本框位置打拼音 → 选字后整句中文出现在
   A 的工作台（B 端日志有"已发送文本（N 字）"）。

> ★ 上面是 Mesh 版（3000）的日志。SFU 版（3001）步骤完全相同，只是第 2 步日志没有
> "通道/ping-pong"字样（信令直达、无通道建立环节），第 3 步控制层盖在"XX 的屏幕"那格上
> ——细节见第 5.7 节。

### 2.12.6 面试升级点

- 控制权互斥为什么放服务器？（唯一权威 + 全房广播，浏览器各写各的必打架）
- SFU 版怎么做远程协助？（浏览器间没 P2P，控制事件走服务器定向转发，见规划 10.1）
- ~~中文输入法为什么不支持？~~ ★ A2 已解决（2026-09-11）：IME 组合键 key='Process'
  在控制端被闸掉，中文以"整段文本"消息一次插入——原理见 2.12.7。

### 2.12.7 升级 A2 + A5：中文输入法 & 控制质量工程化（2026-09-11 · 两版同构）

> 代码：`client.js` 第 17/18 步（SFU 版第 14 步）。两版逻辑一致，只差"走哪条管道"。

**A2 · 中文 IME 三件套（控制端）**

1. **隐藏捕获框** `imeCapture`：1×1px 全透明 `<textarea>`（`.ctl-ime-capture`），
   进入控制模式时挂到页面并 `focus()`。为什么必须有它？**组合输入（composition）
   只能发生在可编辑元素上**，控制层是普通 div，IME 组合不起来——
   真实远程桌面（noVNC）同款做法。
2. **两道 IME 闸门**（onCtlKeyDown/KeyUp）：`composing` 中一律不转发（Backspace/
   空格/回车是"选候选字"，转发过去对方会乱删字）；`key==='Process'`（keyCode 229）
   是 IME 占位键，直接丢弃。Esc 释放快捷键在组合中也不触发。
3. **整段文本协议**：`compositionend` 的 `e.data`（最终中文）→ 一条
   `{ type:'input', kind:'input-text', text }` → 被控端对焦点元素一次
   `execCommand('insertText')`（`replayText`）。不逐键、按句发——组合过程中的
   按键语义已乱，只有最终文本才是用户想要的。

**A5 · 三把小刀（控制质量工程化）**

| 刀 | 做法 | 面试一句话 |
|---|---|---|
| ① 二进制帧 | 鼠标/滚轮命令 JSON(~100B) → **16 字节定长 ArrayBuffer**：`[0]kind [1]flags(修饰键+鼠标键) [2..3]预留 [4..7]x(F32) [8..11]y(F32) [12..15]wheel(I32)`；`encodeCtlFrame/decodeCtlFrame`；接收端按 `typeof e.data` 分流混帧 | "实时通道里每个字节都是时间，move 是流量大头，省 80%+；DataChannel 的 binaryType 默认是 blob，必须显式设 arraybuffer" |
| ② 自适应节流 | `monitorNetwork` 每 3s 存 `netRttMs` → `ctlMoveSkip()`：RTT<80ms 每帧发、<200ms 隔帧、更高每 4 帧（约 15fps） | "慢变量（网络质量）驱动快变量（发送频率）——发送端拥塞控制的最小模型" |
| ③ 积压监控 | Mesh 版发送前看 `ch.bufferedAmount`，超 64KB 丢 move（点击/滚轮不丢）+ 3s 限一条告警 | "过时的位置没有价值，拥塞时丢最旧；操作完整性命令不能丢" |

**为什么键盘/文本不二进制化？（取舍，不是偷懒）** key/code 是字符串
（"ArrowLeft"就 9 字节），塞定长帧要建键码对照表（VNC keysym 那套）；
键盘频率低、收益小、复杂度高——**高频大流量走二进制，低频带字符串的走 JSON**。

**SFU 版三点差异**（细节见 5.7）：① 二进制帧放进 `remote-input` 的 event 字段，
socket.io 当"二进制附件"搬运，服务器**不解析内容**但**要放行**（见下）；② 服务器端
收到的二进制是 **Node Buffer**——`Object.keys(Buffer(16))` 会数出 16 个下标，
"字段数≤12"的轻量过滤必须先 `ArrayBuffer.isView` 识别二进制再放行（实修坑）；
③ socket.io 不暴露 `bufferedAmount`，③ 积压监控只有 Mesh（P2P DataChannel）才有——
"P2P 才拿得到传输层细节"本身就是两版对比素材。

---

## 第 2.13 节 远程协助深化：A3 剪贴板 / A4 截图与文件 / A6 权限安全 / A7 触屏（2026-09-11 · 已落地）

> 承接第 2.12 节（H5 远程协助 P0）与 2.12.7（A2 中文输入 / A5 质量工程化）。
> 这一节回答的是"能遥控之后，怎么把它做得像真产品"：
> **能粘贴、能取文件、能限时、能审计、能在手机上用**。
> 代码位置：SFU 版 `sfu/public/client.js` **第 15~24 步**；Mesh 版同构（管道换成 `ctrl_` DataChannel）。

### 2.13.1 A3 剪贴板同步 —— 远程协助里最常用的功能

**为什么不能"直接读对方剪贴板"？** 剪贴板是**机器本地**的东西，浏览器之间没有共享剪贴板。
跨机粘贴天生要过网络，这正是远程协助的高频刚需（把一段命令复制到远端执行、把远端报错贴回本机搜索）。

**两个方向，两种做法：**

| 方向 | 谁发起 | 数据流 | 为什么这么设计 |
|---|---|---|---|
| 控制端 → 被控端 | 控制端按 `Ctrl+V` 或点「📋 粘贴」 | 读**本机**剪贴板 → `clipboard-sync{dir:'ctl2host'}` → 被控端 `execCommand('insertText')` 插进工作台焦点元素 | 我的剪贴板在我这台机器上，对方看不到，只能我主动送过去 |
| 被控端 → 控制端 | 被控端点工作台工具条「📋 剪贴板发给控制端」 | 读被控端剪贴板 → `clipboard-sync{dir:'host2ctl'}` → 控制端 `navigator.clipboard.writeText` 写进本机剪贴板 | 之后控制端在自己机器上就能直接粘贴 |

**三个必须讲的细节（面试）**

1. **服务器门禁比 remote-input 更严**：剪贴板是隐私数据，绝不能变成"房间里谁都能读我剪贴板"的通道。
   规则：只有**正在互相控制的那一对**能互发（`sfu/server.js` 的 `clipboard-sync` 校验 remoteCtl）。
   注意它是**双向**的，所以没有复用单向的 remote-input，而是单独开了一个双向事件——"协议形状要跟着权限形状走"。
2. **剪贴板 API 的边界**：`navigator.clipboard.readText()` 需要**页面聚焦 + 权限**，
   浏览器策略还各不相同；失败是常态。所以代码里全部 try/catch + 明确中文提示——
   远程协助的体验有一半是"失败了也要让对方知道为什么"。
3. **Ctrl+C 的特殊性**：控制端按 Ctrl+C 复制的其实是"对方工作台里选中的文字"，
   而这段文字在**同源 iframe** 里，控制端本地就能读到（`contentDocument.getSelection()`），根本不用过网络。
   ⚠️ 但这是本项目"同源 iframe 演示"的红利：**真实远程桌面里选区在远端，只能过网络**。
   这个边界要主动说出来，否则会被追问。

### 2.13.2 A4 远程截图 + 文件传输

- **截图**（三行代码）：被控端的屏幕画面就在控制端页面的 `<video>` 元素里——
  `drawImage` 到 canvas → `toBlob` → 下载 PNG。"**能看到画面 = 能截图**"，
  这是"远程桌面本质是视频流"的直接推论。
- **文件传输**：四步协议 `file-offer → file-answer → file-chunk×N → file-end`。
  - 每块 32KB 二进制（服务器单块上限 64KB）；接收方按 `seq` 拼回数组 → `new Blob(parts)` → 下载；
  - **服务器做配额校验**：offer 里报了 size，服务器记账累计字节，**超发立即掐断并通知双方**
    （防"以小文件之名灌流量"）——这是"信令邮局做不到、而中心化架构顺手就能做"的管控点；
  - **两版流控策略不同（重要取舍）**：Mesh 版走 P2P DataChannel，能用 `bufferedAmount`
    做真正的**背压**（缓冲高就等）；SFU 版经服务器中转，socket.io 不暴露发送缓冲，
    只能"每块之间让出事件循环"来自然限速——**传输层能力不同，上层流控策略就得跟着变**。
  - 面试延伸：真产品为什么不用信令传大文件？（占服务器内存与信令通道、断点续传难做）→
    正确做法是直传对象存储（S3/OSS）再发链接。

### 2.13.3 A6 权限与安全三件套（"最小权限原则"落地）

| 件 | 做法 | 讲点 |
|---|---|---|
| **限时授权** | 授权卡片选 60 秒 / 5 分钟 / 不限；`remote-answer` 带 `durationMs`；**服务器**记 `expiresAt` + 挂 `setTimeout`，到点自动清表并广播 `remote-state` + `remote-ended{reason:'expired'}`；两端各自跑倒计时 | 为什么放服务器？只在被控端本地计时的话，控制端可以"不理会"——**权限的撤销必须由权威方执行**，这正是向日葵/ToDesk"临时授权"的做法 |
| **审计日志** | 被控端把每条控制事件记进环形缓冲（上限 500 条，鼠标移动按 1/10 抽样），工具条面板可看可导出 `.txt` | 审计的意义是"我能证明对方做了什么"——**日志必须由被控端本地掌握**，放服务器等于把证据交给别人保管；分级记录（操作级全记、移动级抽样）也是真实产品做法 |
| **不再允许 TA** | 授权卡片上的拉黑按钮 → 本地黑名单 Set → 该成员后续申请自动 `remote-answer{reason:'blocked'}` | 授权是用户的**权利**：拒绝要能被记住，而不是每次都来打扰我 |

### 2.13.4 A7 触屏支持（手机也能当控制端）

控制层本来是给鼠标写的，触屏要补两件事：

- **长按 = 右键**：`pointerdown` 起一个 500ms 定时器，**手指一移动或第二根手指落下就取消**
  （否则会出现"点一下却弹出右键菜单"的体验灾难）；
- **双指滑动 = 滚轮**：跟踪多个 pointer，取"两指平均纵坐标"的位移换算成 `wheel` 增量，
  仍然走原有的 80ms 合并发送（和鼠标滚轮同一套节流）。
- 另加 `touch-action: none`：告诉浏览器"这块区域的触摸手势归我，别拿去滚页面"。
- 顺带的好处：**单指点按在浏览器里本来就产生 pointer 事件**，所以移动/点击/双击一行不用改——
  "用 pointer 事件而不是 mouse 事件"当初的选择，在这里白拿了一份触屏支持。

### 2.13.5 这一节的简历句 / 面试自查

> "远程协助在 P0 的基础上做了产品化：**双向剪贴板同步**（受控制关系门禁约束）、
> **远程截图与分块文件传输**（服务器配额校验，两版分别用 DataChannel 背压与事件循环限速）、
> **限时授权（服务器权威计时 + 双端倒计时）**、**被控端本地审计日志与黑名单**、**触屏手势映射**。"

自查三问：① 剪贴板为什么必须是双向协议？② 文件传输为什么不能走信令？③ 授权到期为什么必须在服务器判？

---

## 第 3 节 读一遍注释版代码（推荐顺序）

> ⚠️ 读的时候**先看一大段注释**（它能讲清楚这段干嘛），再看代码。
> 打开网页，对照右下角日志面板一起看，印象最深。

### 3.1 先读 server.js（只有 4 部分：A 托管 / B 房间管理 / C 转发 / D 启动）
打开 `server.js`，从上到下：
- **A 段**：`require` 引入模块 + 端口常量 + **MAX_MEMBERS**；B 段还有 `generateRoomNumber()` 房间号生成。
- **B 段**：HTTP 服务器发网页。理解 `req`/`res` 回调（和 1对1 一样）。
- **C 段**：Socket.IO（**重点**）。看 `rooms` 这个 **Map** 怎么记"房间号 → 房间记录
  （`{ password, members }`）"；`create-room` 怎么带着密码建房、`join-room` 怎么过
  "格式 → 存在 → 密码"三关（第 2.9 节）、密码错回 `room-wrong-password`；
  公共函数 `joinRoom` 怎么把新人加进去、广播 `new-member`、回 `room-members`；
  以及 offer/answer/ice **定向转发**（`io.to(to)`）。
- **D 段**：启动。

### 3.2 再读 client.js（步骤读完全貌就有了）
对照其中编号段落：
- 第 1-5 步：找元素 / 日志 / 连服务器 / 摄像头 / **房间面板（创建拿号 + 凭号加入 +
  密码框 + URL 自动进房，第 2.8/2.9 节）**
- **第 5.5 步：屏幕共享**（本次新增，getDisplayMedia + replaceTrack）
- **第 6 步：peers 字典**（新概念，重点）
- **第 7 步：createPeerFor()**（为"单个成员"建连接 + 动态造视频框）
- **第 8 步：新人视角 room-members → connectToPeer 主动连所有老成员**
- **第 9 步：老成员视角 new-member → 只建连接等 offer**
- 第 10-12 步：offer/answer/ICE（都带 from/to）
- 第 13 步：peer-left 清理
- 第 14 步：room-full / room-wrong-password（第 2.9 节新增）
- **第 15 步 + 聊天函数：DataChannel 群聊**（createDataChannel / ondatachannel / send）
- **第 16 步：getStats 网络监控**（本次新增，inbound/outbound/remote-inbound-rtp，第 2.10 节）

**读完后问自己（进阶版）**：
1. `peers` 字典里存了哪三样东西？为什么必须用字典？
2. 谁主动发 offer？（新人）为什么？（防 glare 冲突）
3. 收到 new-member 时，老成员做了什么？为什么只建连接不发 offer？
4. ICE 候选地址为什么要用 `from` 找对哪个 `pc`？
5. 信令和 DataChannel 有啥区别？哪个必须走服务器？
6. `pc.ondatachannel` 在"新人"还是"老成员"端触发？为什么？
7. 发消息前为什么先判断 `ch.readyState === 'open'`？
8. 房间号是谁生成的？为什么"加入"时房间必须已存在？房间什么时候销毁？（第 2.8 节）
9. 带密码的房间，join-room 要过哪三关？密码存在服务器的哪里？（第 2.9 节）
10. getStats 里的"码率"为什么不能直接读、要靠两轮字节数相减？（第 2.10 节）



### 3.3 一个"读懂"小测验（答案在第 1、2 节里）
1. `const` 和 `let` 有啥区别？
2. 什么是回调函数？项目里哪里用了？
3. 信令服务器是转交"媒体"还是"控制消息"？为什么？
4. offer 和 answer 谁主动谁被动？分别由哪个角色发出？
5. STUN 帮助解决什么问题？host/srflx 候选分别是什么？
6. 聊天文字走的是服务器还是 P2P？为什么？（第 2.7 节）
7. 谁调用 `createDataChannel`、谁用 `ondatachannel` 收？（第 2.7 节）
8. 创建者想给房间设密码，怎么操作？加入者密码答错会收到什么事件？（第 2.9 节）
9. 网络监控每隔几秒采样一次？丢包率怎么算？（第 2.10 节）

---

## 第 4 节 下一步（简历进阶）

把这一层"读得懂 + 讲得出 Mesh + 会共享屏幕 + 会 DataChannel + 讲得清房间化/密码/网络监控"落实后，按顺序进阶：
1. ✅ **屏幕共享**（已完成）：`getDisplayMedia` + `replaceTrack`，见第 2.6 节
2. ✅ **DataChannel 聊天**（已完成）：`createDataChannel` + 群聊广播，见第 2.7 节
3. ✅ **房间化**（已完成）：创建房间生成 6 位房间号、凭号加入、邀请链接直达，见第 2.8 节
4. ✅ **入会密码**（已完成）：房间上锁 + join-room 三关校验，见第 2.9 节
5. ✅ **getStats 网络监控**（已完成）：丢包/RTT/码率徽标，见第 2.10 节
6. ✅ **切到 SFU**（已实现）：概念见第 2.11 节、设计蓝图见 `SFU设计蓝图.md`、
   代码在 `sfu/` 目录（3001 端口），**运行与逐文件导读见第 5 节**（PDF 第 10.6/11 章）
7. ✅ **H5 远程桌面/远程协助**（面试杀手锏，已落地）：屏幕共享 + 控制通道传鼠标键盘事件。
   概念与逐项导读见第 2.12 节（P0）、**第 2.13 节（A3/A4/A6/A7 深化）**；
   SFU 版实现见 **第 5.7 节**（A1/A2/A5）与 **第 5.8 节**（D 档深究）
8. ✅ **2026-09-11 大升级**（已落地 · 以 SFU 主版本为准）：
   - **A 档**（远程协助深化）：A3 剪贴板双向同步 / A4 远程截图与分块文件传输 /
     A6 限时授权 + 审计日志 + 拉黑 / A7 触屏（长按右键、双指滚轮）→ 教学版见 **第 2.13 节**；
   - **D 档**（会议本体 + SFU 深究）：D1 Simulcast 分层与服务器自动选层 /
     D2 服务器端说话人检测 / D3 设备切换 / D4 成员列表与房主踢人 /
     D5 会议录制 / D6 断线重连 → 教学版见 **第 5.8 节**。
9. ✅ **2026-09-12 F 档前三刀 + 工作台桌面化 + D+1 数据通道**（已落地）：
   F1 宫格/演讲者双布局 + 钉选 + 双击全屏 / F2 每成员网络质量点 / F3 加入前预览页
   → 见 **第 5.9 节**；D+1 SFU 数据通道（SCTP，聊天改双路径）→ 见 **第 5.10 节**；
   伪桌面工作台 + 涟漪重放 → 见 **第 5.7 节**末。
10. ✅ **2026-09-13 观测面板 + 可达性 + 拟真（已落地）**：`/api/rooms` + `/dashboard`
    零依赖面板（可观测性）/ `config.json` + 自动 HTTPS + ICE 下发 + 「🔗 连接方式」徽标
    （可达性硬边界变成一份配置）/ F4 表情飞屏 + 举手 + 发言占比 / workbench v3 实时字幕 HUD
    → 见 **第 5.11 节**。
11. ✅ **2026-09-14 深化（已落地）**：SCTP 多频道（chat + annot 并存）/ F5 协作批注
    （to 定向头 + 事件溯源）/ 带宽估计可视化 / UI 主题 v2 / 前端全量重构（应用壳布局）
    → 见 **第 5.12 节**。
12. ✅ **2026-09-14c 路线图三连（已落地）**：D+3 带宽估计与 VP9 SVC / D+4 房间 TTL 宽限与
    房主迁移 / E5 演示包（`npm run start:demo`）→ 见 **第 5.13 节**。
13. ✅ **2026-09-15 D+2 服务器侧录制 + 美学（已落地）**：PlainTransport RTP 旁路 → ffmpeg
    落盘 → `/recordings/` 下载（端到端自测 251KB/4.0s）/ 中国色低饱和色板 + 星云氛围层
    → 见 **第 5.14 / 5.16.1 节**；F7 白板 + E1 TURN 开箱即用 → **第 5.16.2 / 5.16.3 节**。
14. ✅ **2026-09-16 排版根治 + 登录注册 + 一键跨电脑交付（已落地）**：CSS 注释 `*/` 陷阱
    （坑 26）根治 / users.json + scrypt 登录注册 + 昵称贯通 / `npm run start:lan`（HTTPS
    自签 + 局域网地址 + 防火墙放行 + 邀请链接跨机化）/ `npm run test:turn` ICE 可达实测
    → 见 **第 5.17 节**。
15. ✅ **2026-09-17 F 档收官 F6 滤镜与虚拟背景 + AI 线 L1 实时字幕（已落地）**：
    canvas 三站流水线（滤镜/磨皮/色键抠像）→ **第 5.18 节**；
    Web Speech API 字幕 + 字幕账本（C2 的 LLM 输入）→ **第 5.19 节**。
16. 深入排错/优化：`chrome://webrtc-internals` 看真实 SDP/统计

每个延伸点都可以对照 PDF 对应章节（README 有完整历程表）。SFU 版学完接着读下面第 5 节。

---

## 第 5 节 SFU 版：跑起来 + 读代码（已实现，基于 mediasoup）

> 这一节是给 **SFU 版（sfu/ 目录）** 的导读。学完 2.11 的概念后，照下面顺序：
> **先跑起来 → 再读 server → 再读 client → 最后回蓝图对照设计**。

### 5.1 怎么跑（两分钟）

```bash
# ① 一次性：把 mediasoup-client 打包成本地 vendor 文件（npm 已装好依赖）
npm run build:sfu-vendor

# ② 起 SFU 版服务器（端口 3001，Mesh 版 3000 互不干扰）
npm run start:sfu

# 其它两种起法：
npm run start:demo   # 一键起两版（Mesh 3000 + SFU 3001）并打印地址
npm run start:lan    # 局域网交付：自动探 IP + 生成 sfu/config.json + HTTPS 自签 + 放行防火墙
```

然后 **Chrome 开 2~8 个窗口**访问 `http://localhost:3001`：
窗口 1「创建房间」（可先填密码）→ 其他窗口凭号加入 → 互看；试共享屏幕（此时摄像头
仍开着 = 第二路 Producer）、聊天、关摄像头。**改完前端 JS 记得 Ctrl+F5 强刷。**

> 💡 端口/地址可调：`PORT=xxxx node sfu/server.js`；
> 局域网演示：`MEDIASOUP_LISTEN_IP=0.0.0.0 MEDIASOUP_ANNOUNCED_IP=你的局域网IP node sfu/server.js`
> （或用 `npm run start:lan` 一步到位，它会写进 `sfu/config.json` 并打印局域网 HTTPS 地址）。
> ⚠️ 用 IP（而不是 localhost）访问时**必须走 HTTPS 入口**——摄像头/麦克风只在安全上下文可用，
> 而 getDisplayMedia/getUserMedia 在没有安全上下文时会被浏览器直接拒绝。

### 5.2 SFU 版文件地图（对照 Mesh 版）

```
webrtc/
├── server.js                 # Mesh 版信令服务器（3000）——原样保留
├── sfu/
│   ├── server.js             # ★ SFU 版服务器（3001）：静态托管 + 房间/密码 + 用户体系 + mediasoup 媒体中枢 + 录制
│   ├── protocol.js           # ★ 信令事件总表（改 server/client 前先看它）
│   ├── config.example.json   # 配置模板（端口/人数/监听IP/announcedIp/ICE/HTTPS/roomTtlSec/videoSvc）
│   ├── config.json           # 实际配置（可缺省；start:lan 生成；含 lanUrl 供邀请链接跨机改写）
│   ├── users.json            # 登录注册的账号存储（scrypt 哈希）
│   ├── recordings/           # D+2 服务器侧录制产物（webm/mkv，经 /recordings/<file> 下载）
│   └── public/
│       ├── index.html        # 页面（和 Mesh 版几乎一样，脚本多了 mediasoup-client）
│       ├── style.css         # 主版本已整份重写（14 节设计系统；Mesh 版样式保持不动）
│       ├── client.js         # ★ SFU 版浏览器逻辑（步骤 1~51；14=远程协助，15~24=A/D 档，
│       │                     #   25~26=F 档，26b/26c/26d=回应举手/批注/白板，27=D+1 数据通道，
│       │                     #   28=F6 滤镜虚拟背景，29~31=字幕/值守/日报，37~39=三条延迟读数，
│       │                     #   46~48=版本自检/邀请面板/模糊衬底，49~50=整句字幕卡与双主题，
│       │                     #   51=★ 共享文件浏览（2026-10-08））
│       ├── fileview.js       # ★ 2026-10-08 共享文件的**零依赖渲染内核**（纯函数：手写 ZIP+XML 读 docx/xlsx/pptx；
│       │                     #   ★ 2026-10-09 第 10 节再加 OLE2/CFB + Word97 piece table + BIFF8 + PPT97 读旧版）
│       ├── dashboard.html    # ★ 观测面板页（/dashboard：2s 轮询 /api/rooms、canvas 折线）
│       ├── workbench.html    # ★ 远程协助工作台（两版共用同一份演示页）
│       └── vendor/           # socket.io.min.js + mediasoup-client.js（本地打包，不依赖 CDN）
├── scripts/test-sfu-signaling.js  # SFU 信令回归测试（npm run test:sfu，67 项断言）
├── scripts/test-sfu-client-smoke.js # 前端无头冒烟（npm run test:smoke，76 项断言，零依赖）
├── scripts/test-turn.js      # ICE 可达性实测（npm run test:turn）
├── scripts/bench.js          # 压力基准（npm run bench，4/8/16 路）
├── scripts/start-demo.js     # 一键起两版（npm run start:demo）
└── scripts/start-lan.js      # 局域网交付（npm run start:lan）
```

**概念 → 代码对照**（背下来，面试直接说）：
- Worker（第 B 部分开头）＝ 服务器里跑着的转发内核，全站 1 个；
- Router（`getOrCreateRouter`）＝ **一个房间一个**，房间销毁时 `router.close()`；
- Transport（`create-webrtc-transport`）＝ **一个人两条**：send 上传 + recv 接收；
- Producer（`produce`）＝ 我上传的每一路（麦克风/摄像头/屏幕各一路）；
- Consumer（`consume`）＝ 我订阅的别人的每一路。

### 5.3 sfu/server.js 导读（A~E 段）

- **A 段**：HTTP 托管 `sfu/public`（注意目录从 `public` 变成了 `sfu/public`）。
- **B 段**：mediasoup 初始化。看 `createWorker()`（Worker 单例 + `died` 自动重启）、
  `mediaCodecs`（房间支持哪些编码：opus/VP8/H264）、`rtcMinPort~rtcMaxPort`（媒体 UDP 端口段）。
- **C 段**：房间管理——从 Mesh 版复制改造。**关键变化**：房间对象多了 `router` 字段，
  `members` 从存 id 改成**存 socket 本体**（因为要读他的 producers 给新人做订阅清单）。
- **D 段**：信令事件（重点）。房间/密码/聊天沿用；媒体部分全是新的：
  ① 每连接建"媒体账本"（两条 Transport + producers + consumers）；
  ② `get-router-rtp-capabilities` → 回 Router 能力；③ `create-webrtc-transport` → 建通道回参数；
  ④ `transport-connect` → DTLS 握手；⑤ `produce` → 建 Producer 并**广播 new-producer**；
  ⑥ `consume` → 建 Consumer（记得 `await consumer.resume()`，不 resume 没画面）；
  ⑦ `disconnect` → 关 Transport（级联释放 Producer/Consumer）、房间空了 `router.close()`。
- **E 段**：启动（先起 Worker 再 listen）。

> 💡 socket.io 的"请求-应答"：`emit(事件, 数据, 回调)`，服务器处理完调 `回调({data})`
> 或 `回调({error})`——这是 SFU 版信令的新写法，client 端封装成了 `request()`。

### 5.4 sfu/public/client.js 导读（步骤 1~29 逐段；28~48 见下面的 5.4b 索引）

- 第 1~5 步：和 Mesh 版几乎一样（元素/日志/连服务器/摄像头/房间面板+密码）。
- **第 6 步（重点）**：`initSFU()`——建 `mediasoupClient.Device`、加载 Router 能力、
  创建 send/recv 两条通道，并把通道的 `connect`（握手）、`produce`（上传）事件接好。
- **第 7 步**：`publishTracks()`——麦克风、摄像头各 `sendTransport.produce()` 一次；
  ★ **D1 升级后摄像头这一路带 simulcast 三档 encodings（低/中/高）**。
- **第 8 步（重点）**：`subscribe()`——向服务器 `consume`，把返回的 track 接到画面。
  看 `tiles`（每路一格）、`peerMains`（每个成员的主画面，麦克风+摄像头并成一条流）
  和 ★ **D1 新增的 `consumerTiles`**（consumerId → 画面格，用于接收换层通知）。
- 第 9 步：屏幕共享 = **再加一路 screen Producer**（摄像头 Producer 不动）。
- 第 10 步：静音/关摄像头/离开（和 Mesh 一样只管 track.enabled）；
  ★ D4 升级后顺手 `reportMyState()` 上报给服务器。
- 第 11 步：聊天改走**服务器广播**（`chat-message`）——为什么？浏览器之间没有 P2P 了。
- 第 13 步：getStats 监控改读自己两条 Transport 的统计。
- **第 14 步（重点）**：远程协助——授权四信令照 Mesh 版抄；输入流从
  "P2P ctrl_ DataChannel"换成"`remote-input` 信令定向转发"，采集/重放两块
  与 Mesh 版逐行同构（详见 5.7 节）。
- ★ **第 15~24 步（2026-09-11 大升级，详见 5.8 节）**：
  15 成员列表（room-state 快照）· 16 说话人指示（服务器 AudioLevelObserver）·
  17 设备切换（replaceTrack）· 18 会议录制（canvas + 混音 + MediaRecorder）·
  19 Simulcast 选层 · 20 剪贴板同步 · 21 截图与文件传输 · 22 触屏手势 ·
  23 审计入账 · 24 通用小工具（下载/体积格式化）。
- ★ **第 25~26 步（2026-09-12 F 档，详见 5.9 节）**；**第 27 步（D+1 SFU 数据通道，详见 5.10 节）**：
  25 加入前预览页（镜像预览/设备选择/试音条/预静音）·
  26 宫格/演讲者双布局 + 钉选 + 双击全屏 + 每成员网络质量点（net-levels）。
- ★ **第 26b~29 步（2026-09-13 ~ 09-17，后续每一刀的增量都编在 26 号段之后）**：
  26b 表情回应飞屏 + 举手 + 发言占比（D+1 数据通道上的第二种消息 `{type:'react'}`，见 5.11.2）·
  26c 协作批注（独立 `annot` SCTP 频道 + 归一化事件溯源，见 5.12.2）·
  26d 独立协作白板（第三条 `board` 频道，见 5.16.2）·
  27 数据通道**三频道并存**（chat / annot / board 各一条 DataProducer，订阅端按 label 路由）·
  28 滤镜与虚拟背景（canvas 三站流水线 + 处理后轨顶替进 localStream，见 5.18）·
  29 实时字幕（Web Speech API 识别 → 成稿广播 → 字幕条/账本，见 5.19）。


#### 5.4b 步骤 28~48 索引（2026-09-17 ~ 10-04 的增量，别再从头读）

「第 N 步」编号就是这份代码的目录。28 之后的都列在这里，细节在对应的 5.x 节：

| 步 | 干什么 | 详见 |
|---|---|---|
| 28 | 滤镜与虚拟背景（canvas 三站流水线 + replaceTrack 顶替上行轨） | 5.18 |
| 29 | 实时字幕（Web Speech 起步，后被服务端 ASR 取代） | 5.19 |
| 30 | 过夜值守（账本溢出归档 + 指数退避 + 看门狗） | 5.19.5 |
| 31 | 值守日报（纯本地统计，零 LLM 永远可用） | 5.20 |
| 32 | 移动端 / PWA（Service Worker + 抽屉 + 省流锁层） | 5.27 |
| 33 | 安全上下文提示（http+IP 为什么拿不到摄像头） | 5.28 |
| 34 | 进房前 ICE 预检（把"打洞不通"说成人话） | 5.30 |
| 35 | 首页 hero 化（打字机 + 胶囊 CTA + 零依赖红线） | 5.31 |
| 36 | AI 房间动作（开/关白板、字幕、切视图；白名单只动房间级共享状态） | 5.32 |
| 37 | 字幕端到端延迟读数（服务器实测 + 等待/转写拆分） | 5.45 |
| 38 | 播报延迟读数（看到答案 → 真的听见第一句） | 5.45 |
| 39 | 两条延迟进值守日报与 soak（没有样本数就不许下结论） | 5.45 |
| 40 | 开关动效（两层标签交叉淡入 + 环形脉冲，移植 BellToggle） | 5.47 |
| 41 | AI 思考条（阶段清单 + 呼吸/收焦，移植 ThoughtLine；接上一直没人用的 phase） | 5.47 |
| 42 | 登录页光标光轨（**手写 WebGL**，不引 ogl） | 5.47 |
| 43 | 胶囊上涨按钮（半径按按钮真实尺寸解出来；预览页 + 会中控制坞） | 5.47 |
| 44 | AI 的"在听"改由真实音量驱动（audio-levels → 波形 scaleY） | 5.47 |
| 45 | 底部堆叠与让位（`--stack-h` 量出来，白板不再盖住字幕与按钮） | 5.47.3 |
| 46 | 可访问名同步（小屏收掉文字之后按钮仍要有名字） | 5.47.6 |
| 47 | Esc 逐层退出 + 登录框回车提交 + 抢话闸改"等一轮再说" | 5.47.4 |
| 48 | 白板导出 PNG（与屏幕重绘共用同一个 drawBoardStrokes） | 5.47 |

验证这些步骤的不是冒烟，是十三套 `npm run check:*`（真浏览器量算出来的值），
一条命令跑完：`npm run check:all`。清单：
`check:toggle / think / glow / pill / visual / icons / dock / layers / login / keyboard / board / a11y / console`。

### 5.5 SFU 信令事件速查（完整总表看 sfu/protocol.js）

| 事件 | 方向/形式 | 干什么 |
|---|---|---|
| create-room / join-room（带 password） | C→S + 应答 | 建房拿号 / 凭号+密码进门（沿用 Mesh） |
| room-created / room-not-found / room-wrong-password / room-full / new-member / peer-left | S→C | 房间状态（沿用 Mesh） |
| room-members | S→C | 新人拿到老成员清单（**含每人已上传的 Producer**） |
| get-router-rtp-capabilities | C→S 应答 | 要本房间 Router 能力 |
| create-webrtc-transport | C→S 应答 | 要一条媒体通道（send/recv） |
| transport-connect | C→S 应答 | DTLS 握手 |
| produce / close-producer | C→S 应答 | 上传一路 / 关闭一路 |
| consume | C→S 应答 | 订阅某一路 |
| new-producer / producer-closed | S→C 广播 | 有人开了/关了路 |
| consumer-closed | S→C 定向 | 我订阅的路被关了 |
| chat-message | C→S / S→C 广播 | 聊天（服务器转发） |
| remote-request / remote-answer | C→S / S→C 定向 | 远程协助申请与授权（沿用 Mesh，见 5.7） |
| remote-state | S→C 广播 | 全房同步"谁控谁"+ **限时授权的 `expiresAt`**（null = 无人被控） |
| remote-release | C→S | 被控端收回 / 控制端放弃 |
| remote-ended | S→C 定向 | ★ A6：控制为什么结束（expired / released / peer-left） |
| remote-input | C→S / S→C 定向 | ★ 控制输入流（服务器校验门禁后转发；Mesh 版无此事件） |
| **member-state** | C→S | ★ D4：上报"我静音/关摄像头/在共享" |
| **room-state** | S→C 广播 | ★ D4：房间快照（成员 + 状态 + 谁在控制谁 + expiresAt） |
| **kick-member / kicked / kick-denied** | C→S / S→C 定向 | ★ D4：房主移出成员 / 被踢通知 / 非房主被拒 |
| **audio-levels** | S→C 广播 | ★ D2：谁在说话（服务器 AudioLevelObserver 量的 dB 音量） |
| **set-preferred-layers / layer-changed** | C→S 应答 / S→C 定向 | ★ D1：手动锁定画质层 / 服务器通知当前层 |
| **clipboard-sync** | C→S / S→C 定向（双向） | ★ A3：剪贴板同步（仅限"正在互相控制的一对"） |
| **file-offer / file-answer / file-chunk / file-end / file-abort** | C→S / S→C 定向 | ★ A4：文件传输四步 + 中止（服务器做配额校验） |
| **produce-data / consume-data / close-data-producer** | C→S 应答 | ★ D+1：数据通道的三件事（建/订/关）。请求里必须带浏览器生成的 `sctpStreamParameters`；消费者建好即用、**没有 resume** |
| **new-data-producer / data-producer-closed** | S→C 广播 | ★ D+1：有人开了/关了数据频道（前端据此补订，按 `label` 决定路由到聊天/批注/白板） |
| **net-levels** | S→C 广播 | ★ F2 + D+3：每成员网络质量（0/1/2/null）**和** `bwe`（服务器侧下行带宽估计）；每 3s 量一次、有变化才发 |
| **talk-stats** | S→C 广播 | ★ 09-13：发言占比（D2 的 AudioLevelObserver 顺手记账 → 成员行占比条） |
| **auth-register / auth-login / auth-verify** | C→S 应答 | ★ 09-16：注册 / 登录 / 用 localStorage 里的 token 恢复登录态（返回 `{ user, token }` 或 `{ error }`） |
| **record-start / record-stop** | C→S 应答 | ★ D+2：服务器侧录制开关（`{memberId}` 或 `{producerId}` → 建 PlainTransport → ffmpeg 落盘；返回 `recordId`，停止后回 `{ file }`） |
| **数据通道应用层消息**（不是信令） | 浏览器 ↔ 浏览器（SCTP） | ★ `{type:'chat'}` / `{type:'react'}` / `{type:'annot', to, op, x, y}` / `{type:'board', op, ...}` / `{type:'caption', text}` —— 同一层里五种消息，按频道 + type 分家 |
| **HTTP 接口**（不是信令） | 浏览器 → 服务器 | ★ `GET /api/rooms`（全景快照 JSON）、`GET /dashboard`（面板页）、`GET /config.json`（下发 ICE + `lanUrl`）、`GET /recordings/<file>`（录制产物下载） |

### 5.6 SFU 版自测 & 面试升级点

自测：
1. 一个房间在 mediasoup 里对应哪个对象？全站只有一个的是什么？
2. 为什么每人要两条 Transport？（send/recv 各司其职，官方推荐）
3. Consumer 建出来后为什么可能"没画面"？（没 `resume()` / 没 attach track）
4. 屏幕共享和 Mesh 版有什么本质区别？（Mesh 换轨二选一；SFU 加一路，摄像头仍在线）
5. SFU 版聊天为什么不走 DataChannel？（浏览器之间没有 P2P 连接了）

面试升级点：
- **广播风暴的取舍**：谁 produce 就广播给全房间"来订阅"；生产会用"订阅清单 + 只看自己需要的"
- **带宽优化**：SFU 可以按 Consumer 分辨率分层（simulcast/SVC），观众端按网速选层
- **架构对比一句话**：Mesh = 客户端带宽爆炸换零服务器成本；SFU = 服务器转发换"大群可扩展"

### 5.7 SFU 版远程协助（后续升级方向 A1 · 已落地）

> 同一个功能在两种架构下的形态对比——这是本项目**最值钱的面试素材**之一。
> 授权流程（request/answer/state/release 四信令 + remoteCtl 互斥表）从 Mesh 版
> 原样照抄；真正变化的只有**输入流走哪条管道**。

#### 数据流（对照 2.12.2 的 Mesh 版）

```
授权流：与 Mesh 版完全一致（remote-request → 授权卡片 → remote-answer →
        服务器登记 remoteCtl + 广播 remote-state）
输入流：B 采集 → 归一化 → 节流 → socket.emit('remote-input', { to, event }) →
        服务器【门禁校验】→ 定向转发 → A socket.on('remote-input') → 重放到工作台
```

#### 与 Mesh 版的五个区别（面试就背这张表）

| 维度 | Mesh 版 | SFU 版 |
|---|---|---|
| 输入管道 | P2P `ctrl_` DataChannel（浏览器直连） | `remote-input` 信令（经服务器定向转发） |
| 通道建立 | 被控端 `createDataChannel` + ondatachannel + ping/pong 自检 | **没有这一层**——信令本来就是通的（聊天也走它） |
| 服务器看得见输入吗 | 看不见（P2P 天性，建通后服务器管不着） | 每条都过手 → 顺势做**输入门禁**（非在册控制端一律丢弃） |
| 控制层锚点 | 对方的**摄像头视频框**（共享=replaceTrack 换轨，框不变） | 对方的"**XX 的屏幕**"独立格（SFU 共享=第二路 Producer） |
| 延迟 | 直连，理论更低 | 绕服务器一圈，多一跳（教学演示无感） |

#### 代码位置

| 内容 | 位置 |
|---|---|
| remoteCtl 互斥表 + 授权四事件 + **remote-input 门禁转发** | `sfu/server.js` 事件 5.5/5.6 |
| 事件总表（REMOTE_* 五个） | `sfu/protocol.js` |
| 第 14 步：采集/重放/状态机/工作台（与 Mesh 逐行同构） | `sfu/public/client.js` |
| 工作台演示页（两版共用同一份） | `sfu/public/workbench.html` |
| 回归断言（申请/授权/busy/门禁/二进制透传/断开复位 + D4/A3/A4/A6 新增，**41 项全过**） | `scripts/test-sfu-signaling.js` |

#### 面试升级点

- **两种数据通道的取舍**："P2P DataChannel 低延迟但服务器不可见，信令转发多一跳
  但天然可管控"——同一功能两版实现，取舍亲手量过；
- **服务器门禁**：授权的生死簿在服务器（remoteCtl 表），前端伪造 input 过不了门——
  对比 Mesh 版"通道建通后服务器管不着"，这正是"安全边界跟着架构走"的活例子；
- **解耦验证**：workbench.html 一字未改，两版共用——重放方案只依赖
  "标准 DOM 事件"，与传输方式无关。

#### ★ A2/A5 升级后的 SFU 特有点（2026-09-11，协议细节见 2.12.7）

- **二进制帧坐信令车**：16 字节鼠标/滚轮帧作为 `remote-input` event 的
  ArrayBuffer 直接 emit，socket.io 自动转"二进制附件"随包走；服务器**只验
  remoteCtl 在册、不解析内容**，原样透传。回归新增两条断言：
  二进制帧无损透传 + 中文整段文本透传（`scripts/test-sfu-signaling.js` ⑤b）。
- **服务器的 Buffer 坑（实修发现）**：二进制到服务器是 Node Buffer，
  `Object.keys()` 会数出"0"~"15"共 16 个键——"字段数≤12"的垃圾包过滤
  会把它误杀。修法：先 `ArrayBuffer.isView(event)` 识别二进制再跳过该过滤
  （`sfu/server.js` 事件 5.6）。
- **积压监控缺席**：socket.io 不暴露 `bufferedAmount`（DataChannel 专属 API），
  所以 A5③ 只在 Mesh 版有——"P2P 才看得到传输层细节"是两版对比的加分句。

#### ★ 2026-09-12 工作台桌面化（两版同步 · 回应"演示范围太小不像真控制 + 被控端没有可见反馈"）

- **workbench.html 重写成"伪桌面"**：任务栏（实时时钟 + ● 直播中徽标）+ 可拖拽桌面图标
  （双击开窗）+ 计算器 / 音乐播放器（播放暂停、进度条拖拽、点歌）/ 文件窗口（滚轮滚动、点选）
  + 自定义右键菜单 + 白板 + 记事本。每一件都对应一类**会被重放**的交互。
- **重放安全守则（写在文件头，改前必读）**：只监听 pointerdown/move/up、wheel、dblclick、
  contenteditable——它们恰好是重放代码会合成的全部事件；**绝不**依赖 native click
  （合成 pointerdown/up 不会补 click）、`<input>`（合成按键不落字）、HTML5 拖放、
  `isTrusted` 检查；合成 wheel 不会自动滚列表 → 自己监听 wheel 改 `scrollTop`。
- **被控端可见反馈补全**：远程光标只证明"在动"，重放 `mousedown` 时在被控端按下位置
  画一圈扩散绿环（`.ctl-ripple`，`spawnCtlRipple`，两版 client.js 同构）——"在点"也看得见了。
  涟漪放在 iframe 命中检查**之前**：即使点落在工作台外，"有人点了这里"也可见。
- **冒烟测试的两个老坑（本次实修，值一句面试话）**：
  ① **vm 跨 realm**：测试宿主造的 ArrayBuffer，在 client.js 所在的 vm 世界里
  `instanceof ArrayBuffer` 不成立 → 二进制帧一直被静默跳过（老断言只验"不抛错"所以没发现）。
  修法：测试帧必须在 vm 世界里造（`vm.runInContext('(n) => new ArrayBuffer(n)')`）。
  ② **重放被早退**：`rcRole='host'` 只在点「允许」按钮时设置——冒烟只 emit remote-state
  时四种形态的重放全是静默空转。修法：测试改走真实授权链路（共享屏幕 → 开协助 →
  收 remote-request → 点「允许」）。教训一句话：**"不抛错"类断言要配合"产生了可见副作用"
  的断言才立得住**。
- 回归：冒烟 23→31→**39/39**（新增：真实授权链路、remote-answer ok 回执、mousedown 涟漪）；
  信令 50/50 不变。**待人工验证**：两窗口真浏览器看伪桌面重放 + 涟漪效果。

---

### 5.8 ★ D 档深究：会议本体 + SFU 深水区（2026-09-11 · 主版本独有）

> A 档把"远程协助"这条线做深了，D 档补的是**另一条腿**：让"会议本身"像产品，
> 并把手伸进 SFU 真正的深水区（分层编码、服务器侧音量检测、断线重连）。
> 代码：`sfu/public/client.js` 第 15~19 步 + `sfu/server.js` 的对应广播/门禁。

#### 5.8.1 D4 成员列表与房间状态机（第 15 步）

**问题**：人数、谁静音、谁在共享、谁被谁控制——这些是**全房必须一致**的信息。
让每个浏览器各自拼，一定因为消息到达顺序不同而对不上（分布式系统的老问题）。

**解法**：**状态放唯一权威处（服务器）**。
- 前端只做两件事：`member-state` 上报"我的状态"；收到 `room-state` 后**照单渲染**。
- 服务器侧白名单式更新（只认 `muted/camOff/sharing` 三个布尔字段），防前端塞任意字段；
- `room-state` 还顺带带上 `hostId/controllerId/expiresAt`——一张快照解释"房间里发生了什么"。

**踢人**（`kick-member`）：只有**房主**（建房的人，`room.ownerId`）能踢。
服务器不解释"为什么"，只执行：先给被踢者发 `kicked`（让他有时间显示提示），
100ms 后 `disconnect(true)`；断开后走原有的清理路径，全房人数立刻更新。
⚠️ 面试提醒：真实产品踢人还要"禁止重进"（黑名单），本项目靠房间密码兜底，点到为止。

#### 5.8.2 D2 说话人指示器（第 16 步）—— 服务器量音量，全房一份真相

这是"**中心化架构白拿的好处**"的最好例子：

| | Mesh 版（无服务器媒体层） | SFU 版（本版） |
|---|---|---|
| 怎么量 | 每个浏览器自己 `AudioContext + AnalyserNode` 分析每条远端流 | 服务器 `router.createAudioLevelObserver()` 直接量每一路音频 |
| 算几遍 | N 端各算 N 遍 | **算 1 遍**，广播给全房 |
| 一致性 | 各端阈值/时机可能不同 | 全房唯一真相 |

服务器参数：`maxEntries:8`（最多报 8 人）、`threshold:-55dB`（底噪不算说话）、
`interval:400ms`（比视频帧慢得多，省 CPU）。
服务器只给得出 `producerId`，所以要先把 `producerOwner`（producerId → socketId）
翻译成"哪个人"，再广播 `audio-levels { levels:[{id, volume}], top }`。
前端把 dB 映射成音量条宽度：`(volume + 55) / 55`。

#### 5.8.3 D1 Simulcast 分层编码 + 消费者选层（第 19 步）—— 本档最硬的一块

**它解决什么？** 一个摄像头画面，不同人网络差很多：网络好的人想要清晰、网络差的人想要不卡。
**Simulcast 的做法**：上传端**同时编三档**（低 320×180 / 中 640×360 / 高原始分辨率，
SDP 里以 `rid: 'q'/'h'/'f'` 标识），服务器**按每个订阅者的网络质量只转发其中一层**。

```
   上传端（1 路摄像头）
        ├── rid=q  150kbps  ─┐
        ├── rid=h  500kbps  ─┼─→ mediasoup Router ──┬─→ 订阅者甲：网络好 → 转发 f 层
        └── rid=f 1500kbps  ─┘                      └─→ 订阅者乙：网络差 → 降级到 q 层
```

**谁决定层？** 本 Demo 让**服务器**决定（权威、统一、不信任客户端上报）：
每 2 秒读一次 `consumer.getStats()` 的丢包率——
- 丢包 > 5% → **立刻降一层**（保流畅，宁可糊）；
- 丢包 < 1% 且已稳定 6 秒 → **升一层**（有富余才往清晰走）；
- 中间是"迟滞带"，什么都不做 —— **防抖是 ABR 的关键**，这句话面试很加分。

**前端只做两件事**：① 显示当前层（格子右下角选层器）；② 允许手动锁定某一层
（`set-preferred-layers`，`null` = 交回服务器自动）。

**为什么"上传三档"是划算的？** 上传带宽约为三档之和（1.5~2.1Mbps），
但换来"弱网时服务器替你降级，不用重新协商、不让对方卡住"——
这就是腾讯会议/Zoom 弱网还能开会的核心机制。
**为什么音频和屏幕共享不做 simulcast？** 音频码率本来就低（收益小）；
屏幕共享是"内容型画面"，降分辨率会把文字糊掉，宁可降帧。

#### 5.8.4 D3 设备切换（第 17 步）—— replaceTrack 的第二次实战

- **设备列表**：`enumerateDevices()` 必须在 **getUserMedia 成功之后**调用，
  否则 `label`（设备名）全是空字符串（浏览器隐私策略）——这是最容易踩的坑。
- **换设备**：新 `getUserMedia({deviceId:{exact}})` 拿新轨 →
  `producer.replaceTrack({track})`。**不重新 produce、不重建通道**：
  对服务器和所有观众完全透明（和屏幕共享 replaceTrack 同一套原理）。
- 换完别忘：旧轨 `stop()`（否则摄像头灯一直亮）、
  新轨的 `enabled` 要继承"静音/关摄像头"状态（否则一换设备就被打回开启）。
- `navigator.mediaDevices.ondevicechange`：插拔耳机/摄像头时自动刷新列表。

#### 5.8.5 D5 会议录制（第 18 步）—— 三件事拼起来

① **画面**：把所有 `<video>` 按网格 `drawImage` 到一张 canvas → `canvas.captureStream(15)`；
② **声音**：WebAudio 把"我的麦克风 + 每个人的声音"混成一路（`createMediaStreamDestination`）；
③ **封装**：`MediaRecorder` 录成 webm，停止时拼 Blob 下载（`start(1000)` 每秒切片，
掉电最多丢 1 秒）。

**为什么只能"合成式录制"？** 浏览器拿不到"服务器转发的全貌"，
本地这几个 `<video>` 元素才是真实存在的画面。
真实产品在**服务器侧**录制（mediasoup 官方推荐"另起一个 Consumer 录流"），
能讲清这个差别就够面试用了。

#### 5.8.6 D6 断线重连（第 19 步附近的 `resetMediaState` / `reconnecting`）

socket.io 自带自动重连，但**会换一个新的 socket.id**——而服务器那边的房间成员、
Transport、Producer 全挂在旧连接上。所以重连后等于"新人进房"，必须整条重建：

```
断线 → connBadge 变"重连中" → socket.io 自动重连
     → connect 事件里重新 join-room（★ 所以密码要留着）
     → room-members 到达 → resetMediaState() 作废上一轮的一切
        （关 Producer/Transport、清画面与索引、deviceReady=false）
     → initSFU() 重建通道 → publishTracks() 重新上传 → 订阅老成员
```

⚠️ **已知边界（写清比藏起来好）**：如果房间里只剩我一个人，掉线时房间会被销毁、
房间号回收 → 重连会拿到 `room-not-found`。
真实产品会给房间加 TTL（空房保留 N 分钟）或让房主迁移——
本项目不做"过早优化"，但你要知道该怎么做。

#### 5.8.7 一张表记住 D 档的面试价值

| 编号 | 一句话 | 面试怎么讲 |
|---|---|---|
| D1 | Simulcast + 服务器侧自动选层 | "弱网自适应不是玄学：三档编码 + 丢包率驱动的升降层 + 迟滞防抖" |
| D2 | 服务器端 AudioLevelObserver | "需要全房一致的状态，就该放在中心点算一次" |
| D3 | enumerateDevices + replaceTrack | "换设备不重协商：replaceTrack 的语义是'同一条路换个源'" |
| D4 | 房间状态机 + 房主踢人 | "状态放唯一权威处，前端只照单渲染" |
| D5 | canvas 合成 + WebAudio 混音录制 | "为什么浏览器只能合成录制、服务器录制长什么样" |
| D6 | 断线重连 = 整条媒体链路重建 | "信令重连 ≠ 媒体重连：SFU 下重连要重建 Transport" |

#### 5.8.8 自测（答案都在 5.8.1~5.8.6 里）

1. `room-state` 和 `room-members` 分工有什么不同？为什么不能只留一个？
2. 说话人检测为什么放服务器比放浏览器好？服务器凭什么知道"是哪个人的声音"？
3. 三档 simulcast 的 rid 分别是什么？服务器凭什么决定给谁发哪一档？
4. 设备列表为什么必须在授权之后才能拿到名字？
5. 录制为什么要用 canvas 合成？服务器侧录制又该怎么做？
6. 断线重连时为什么必须 `resetMediaState()`？不重置会报什么错？

#### 5.8.9 回归断言（`npm run test:sfu`）

D 档 + A 档新增断言（从 21 项扩到 **41 项**）：成员状态上报与白名单过滤、房主踢人全链路、
非房主被拒、剪贴板双向转发与门禁、文件传输四步 + 配额掐断、限时授权到期自动撤权、
Consumer 切层错误路径。**真实音视频/分层/录制/触屏手势需要在浏览器里人工验证**——
命令行只能验到信令层。

### 5.9 ★ F 档：对齐商业产品的产品体验（2026-09-12 · 参考声网形态，自研实现）

> 这一档回答的问题是："功能都有了，怎么让它**用起来像腾讯会议**？"
> 参考对象是声网/腾讯会议的产品形态，但**一行 SDK 都不引**——这本身就是面试话术：
> "我对比过商业方案，知道它替我解决了什么，然后决定自己写哪部分"。
> 路线图与状态跟踪见 `后续升级方向.md` **F 档**。

#### 5.9.1 F3 加入前预览页（第 25 步）—— 进会先把设备检查好

真实产品（腾讯会议/Zoom/声网 Demo）都有"预览页"：先看自己画面、选好设备、试个音，
再点加入。我们的实现抓住三个点：

1. **预览和会议共用同一条 `localStream`**（第 4 步里 `preVideoEl.srcObject = localStream`）。
   不是"预览开一路、进会再开一路"——那样要授权两次、占两份设备。
   预览页里切设备就是**第 17 步的 `switchCamera/switchMic`**：还没 produce 时它们自动跳过
   `replaceTrack`（`if (producer)` 守卫），只换本地轨道，进会后 produce 的就是选好的设备。
2. **试音条 = AnalyserNode 峰值表**：`createMediaStreamSource(麦克风) → analyser`，
   **只接分析器、不接 destination**（不会从喇叭外放出来，防啸叫）；每帧取采样的绝对值最大者
   （峰值比平均值灵敏，说话一眼就能看出来）。关键工程点：**非阻塞降级**——没有
   AudioContext/Analyser 的环境（比如无头测试桩）直接跳过试音，预览页绝不能变成进房的拦路虎。
3. **"入会时静音/关摄像头"是预勾选**：进会后调的仍是第 10 步 `muteBtn/camBtn` 的 click
   （enabled 翻转 + `member-state` 上报都由它做）——**不另造一份"预静音"状态**，单一事实来源。

另外两个体验细节：摄像头预览 `transform: scaleX(-1)` 镜像（和照镜子方向一致）；
取不到媒体时预览页给出提示且**仍可进入会议**（`publishTracks` 开头加了空守卫：没有
`localStream` 就只订阅别人的画面、不发布自己——真实产品同样允许"无媒体入会"）。
`?room=` 邀请链接的行为从"拿到摄像头就自动进房"改成"预填房间号，点『进入会议』后自动加入"。

#### 5.9.2 F1 宫格/演讲者双布局 + 钉选 + 双击全屏（第 26 步）

- **大画面给谁**（优先级对齐腾讯会议）：① 我钉选的人（📌，他开共享就显示他的屏幕）；
  ② 有人在共享屏幕 → 让给共享者；③ 跟随当前说话人（**直接复用 D2 `audio-levels` 的 top**，
  零新增数据）；④ 都没有 → 我自己。
- **切布局不搬 DOM**（本档最值得讲的渲染决策）：所有格子始终留在同一个网格容器里，
  切布局 = 给容器换 CSS 类（`.layout-speaker` 从 grid 变 flex：主画面 `width:100%; order:-1`
  独占一行，其余小格一行最多 4 个）+ 给主画面格打 `tile-main` 标记。
  为什么？搬 DOM 会触发 `<video>` 重新挂流/部分浏览器重绘黑帧；纯 CSS 切换零开销、可回退。
- **触发点要收口**：布局重算只走一个 `applyLayout()`（幂等），在 audio-levels / room-state /
  新画面出现 / 成员离开 / 断线重连 五个地方调用——谁可能改变"大画面该给谁"就调它一次。
- 钉选后自动切到演讲者视图（宫格里"钉"没有意义）；双击任意画面 = 原生
  `requestFullscreen()`（再双击或 Esc 退出，布局零代码）。

#### 5.9.3 F2 每成员网络质量点（第 26 步 + 服务器 `net-levels`）

成员列表里每个人一个 ●：绿=良好、黄=一般、红=较差、灰○=暂无数据。数据链路：

```
服务器每 3 秒 → 对房间里每个人的每路 Consumer 调 consumer.getStats()
            → 取"最差那一路"的丢包率（最差的路决定体感）
            → <1% 记 0 / <5% 记 1 / 其余记 2；一路包都没收过记 null（灰○，不瞎猜）
            → JSON 和上次比对，【有变化才广播】net-levels { levels: { [socketId]: 等级 } }
前端        → applyNetDots() 刷成员行的小圆点
```

- **为什么由服务器量？**下行丢包发生在"服务器→浏览器"段，Consumer 就挂在服务器上。
  这和 D1 选层、D2 说话人检测是同一个信任模型：**全房都要显示的状态，放中心点量一份**，
  不听客户端自报。至此"中心化优势"在 D2（音量）、F2（网络）两处落地，面试可以连起来讲。
- **工程细节两个**：①变化才广播（省信令，UI 不闪）；②`startNetLevelBroadcaster` 在
  joinRoom 幂等启动、**房间销毁时必须 clearInterval**（否则定时器拖着 room 对象泄漏——
  和 D1 选层定时器、A6 授权定时器同一条"定时器要清"的纪律）。

#### 5.9.4 成员列表增强的其它小件

成员行重构后每行有：名字 → 徽标（👑房主/🖥️共享/🔇静音/🚫摄像头）→ 📎发文件/🚪踢人按钮 →
网络点 → **行内音量条**（`.vol-bar` 和视频格共用 `setSpeaking`：谁说话，他的视频格和成员行
同时出绿条——同一份数据喂两处 UI，这就是"数据与表现分离"的小例子）。

#### 5.9.5 自测（答案都在本节里）

1. 预览页为什么不应再 `getUserMedia` 一路？切设备在 produce 前后分别走什么路径？
2. 试音条为什么"只接分析器不接 destination"？为什么用峰值不用平均值？
3. 切换布局为什么不给每个格子搬 DOM？搬了会发生什么？
4. 演讲者视图大画面的四级优先级是什么？分别来自哪份数据？
5. `net-levels` 为什么由服务器量？为什么"有变化才广播"？null 代表什么、为什么不能记 0？
6. 无头冒烟测试里"createElement 造的按钮"和"querySelector 查到的同名元素"为什么是两个对象？
   （提示：假 DOM 的 querySelector 按 `id|选择器` 缓存返回新桩——所以 addPinBtn 的幂等
   用 dataset 标记而不是查 DOM。）

#### 5.9.6 回归断言

信令回归不变（41/41，`net-levels` 是纯广播、无请求-应答路径）。前端无头冒烟从 23 扩到
**31/31**（`npm run test:smoke`，零依赖不用起服务器）：视图切换类名、tile-main 大画面、
说话人行 speaking 高亮、钉选/取消两态、net-levels 变色、预览页隐藏。
**真实体验仍需浏览器人工验证**：镜像/试音条/布局跟随/钉选常亮/双击全屏/网络点变色。

### 5.10 ★ D+1 SFU 数据通道：DataProducer/DataConsumer（2026-09-12 · 聊天不再全走信令）

> 到 D 档为止，"房间内发消息"（聊天/文件）都走信令通道（socket.io）——能跑，但是教学妥协。
> D+1 把它升级成**正统 SFU 做法**：SCTP 数据通道，和音视频走同一条媒体链路。

#### 5.10.1 它是什么（一句话 + 对照表）

mediasoup 把 WebRTC 的 DataChannel 搬进了 SFU：每个人用 `produceData()` 开一条
**SCTP 广播频道**（DataProducer），其他人用 `consumeData()` 订阅（DataConsumer），
之后 `.send()` 的每条消息 mediasoup **自动转发给所有订阅者——服务器一行转发代码都不用写**。
概念上和媒体 Producer/Consumer 一模一样，只是"轨道"换成了"消息"：

| 媒体（audio/video） | 数据（SCTP） | 区别 |
|---|---|---|
| `produce()` + 'produce' 事件交 `rtpParameters` | `produceData()` + 'procedata' 事件交 `sctpStreamParameters` | 字段名不同，套路相同 |
| `consume()` 后必须 `resume()` | 建好即用，**没有 resume** | 数据通道没有"暂停"态 |
| `canConsume` 校验编解码能力 | 不需要 | 消息没有编解码 |
| `new-producer` / `producer-closed` | `new-data-producer` / `data-producer-closed` | 广播事件成对出现 |

传输前提：`createWebRtcTransport` 加 `enableSctp: true` + `numSctpStreams`，
应答多带一份 `sctpParameters`，浏览器建 Transport 时必须原样带上（漏了 produceData 直接报错）。

#### 5.10.2 广播语义与"双发去重"（面试讲点）

mediasoup 数据通道是**广播**的：一个人 produceData，全房订阅者都收得到。
要"只发给某个人"得在应用层给消息加 `to` 字段自己过滤（A4 文件传输若迁移即是这么改，
但信令版保留——定向转发 + 配额校验在服务器侧更顺手，取舍见 `sfu/protocol.js`）。

本项目聊天改成**双路径**：主路 SCTP（不占信令带宽、和媒体同链路），
兜底信令广播（晚到的人还没订阅上频道时也不丢消息）；每条消息带发送端生成的 `msgId`，
接收端见到重复的只显示第一条——工程上叫"at-least-once + 幂等接收"。

#### 5.10.3 代码导读

- `sfu/server.js`：`create-webrtc-transport` 开 SCTP；事件 ⑤b `produce-data` /
  `consume-data` / `close-data-producer`（produce-data 必须收到浏览器的 `sctpStreamParameters`，
  相当于媒体的 rtpParameters，不带就拒）；`room-members` 清单给新人带上老成员的 `dataProducers`。
- `sfu/public/client.js`：第 6 步 `wireTransport` 多接一个 `procedata` 事件；
  **第 27 步** `setupDataChannel()`（开我的频道）+ `subscribeData()`（订阅别人的，带排队竞态防护）
  + `handleDataMessage()`（消息 → 聊天气泡，二进制也能接）；第 11 步 `sendChat` 双路径。
- 重连（D6）：`resetMediaState` 把数据频道和订阅一并作废，重建时自然重开。
- 总表：`sfu/protocol.js` D+1 段。

#### 5.10.4 回归断言

信令回归 **50/50**（新增 9 项：sctpParameters、produce-data/consume-data 应答、
new-data-producer/data-producer-closed 广播、room-members 清单、两条错误路径、msgId 透传）；
冒烟 **37/37**（新增 6 项：频道接线、订阅、SCTP 消息上屏、双路去重、sendChat 主路）。
**真实 SCTP 收发需浏览器人工验证**：两窗口互发聊天，控制台应出现
"🛰️ SCTP 数据通道已建立/已订阅"日志（仍会有信令兜底到达，属正常双发）。

### 5.11 ★ 09-13 大升级：观测面板 + 表情/举手/发言占比 + 可达性 + 拟真工作台（SFU 主版本）

> 这一轮的选题标准变了：不再是"把 D+ 清单划掉"，而是回答一个问题——
> **"一个真实有用的视频会议产品，还缺什么看得见的东西？"** 答案是四件：
> 运维看得见（观测面板）、参会者看得见（表情/举手/发言占比）、网络边界看得见（连接方式）、
> 被控过程看得见（拟真工作台 + 实时字幕）。

#### 5.11.1 SFU 实时观测面板（`/dashboard` + `GET /api/rooms`）

- **为什么做它**：此前 SFU 的运行状态只有 console.log——"可观测性"是真实产品的分水岭。
  服务器把内部状态（房间/成员/每路 Producer 的累计字节与 mediasoup 健康分 1~10/
  发言时长/控制权/Worker PID）经 `/api/rooms` 摆成 JSON；`/dashboard` 页 2 秒轮询
  画成面板（零依赖，canvas 手写折线）。
- **关键算法（面试可讲）**：服务器只给**累计字节数**（和浏览器 getStats 同一个哲学），
  实时码率 = 页面两次采样做差 ÷ 时间差——"服务器给真相，展示层做差"。
- **代码**：`sfu/server.js` 的 `snapshotRooms()`（async，逐路 Producer getStats）+
  `sfu/public/dashboard.html`。

#### 5.11.2 表情回应 / 举手 / 发言占比（"真实有用"三件套，第 26b 步）

- **表情回应**：D+1 数据通道的第一个非聊天应用——同一频道上消息按 `type` 分家
  （`chat` / `react`），`{type:'react', emoji}` 一发，mediasoup 广播给所有订阅者，
  各端 CSS 动画飞屏。面试句："数据通道是广播语义，一类消息一个 type 就是它的频道。"
- **举手**：`member-state` 白名单加一个 `hand` 布尔字段而已——但"要发言"是全房
  一致的状态，所以仍走"客户端上报、服务器存储+广播"的 D4 模型，成员列表亮 ✋。
- **发言占比**：D2 的 AudioLevelObserver 本来每 400ms 报一次"谁在说话"——顺手给每人
  记 0.4 秒账，3s 心跳把 `{id, sec, share}` **有变化才广播**（`talk-stats`）；
  前端在成员行画一根占比细条。"同一份数据，从实时高亮沉淀成复盘报表"是这题的题眼。

#### 5.11.3 可达性：把硬边界变成一份配置 + 一个徽标

- **硬边界的三块**：① 媒体面监听 127.0.0.1（别的机器连不进）；② 页面非安全上下文
  （跨机打开拿不到摄像头）；③ 穿对称 NAT 必须 TURN（ICE 服务器此前写死）。
- **解法**（零新依赖）：`sfu/config.json`（可选）统一管端口/IP/ICE/HTTPS；
  `https.enabled` 自动起 HTTPS+wss（证书缺失且有 openssl 时自动自签）；
  ICE 经 `/config.json` 下发，`initSFU` 时带进两条 Transport 的底层 RTCPeerConnection。
- **可视化**：页面顶部「🔗 连接方式」徽标，从 getStats 的 `local-candidate.candidateType`
  读出 host=直连 / srflx=STUN 穿墙 / relay=TURN 中继——部署是否生效一眼可见。
  部署步骤见 README「跨网络部署」。

#### 5.11.4 被控端拟真（workbench v3）+ 实时字幕 HUD

- 回应"伪桌面太假"：开机 splash、窗口最小化（— 键）+ 任务栏窗口按钮（点击还原）、
  右键"换壁纸"循环三套渐变——全是"会被重放"的 pointer 事件（守则不变）。
- **实时字幕 HUD**：会议页每重放一步"动作类"输入（点击/双击/滚轮/按键/整段输入），
  向 iframe 的 document dispatch `remote-activity` CustomEvent，工作台右下角把
  它翻成人话字幕（"🖱️ 点击 → 7"）。**工作台依旧不知道 WebRTC 的存在**——
  它只是多监听了一个 DOM 事件，这就是解耦的回报。
- 细节：只报动作不报 mousemove（否则字幕被冲成噪声）；client 侧 `emitWbActivity`
  + `describeWbTarget`（优先 data-act/data-emoji，其次可见文字）。

#### 5.11.5 回归与待人工验证

- SFU 信令 **53/53**（+3：hand 白名单与任意字段过滤、/api/rooms 快照、/dashboard 200）；
  冒烟 **44/44**（+5：回应走数据通道、飞屏元素、举手/放下手、talk-stats）；
  Mesh 33/33（本轮 Mesh 仅共享 workbench 与主题层，协议未动）。
- **待人工验证**：两窗口真实音视频下看表情飞屏/举手徽标/占比条走动；
  `/dashboard` 真实数据曲线；config.json 开 HTTPS 后另一台设备跨机访问；
  workbench 最小化还原与 HUD 字幕；UI 观感（主题层是否合口味）。

### 5.12 ★ 09-14 深化：SCTP 多频道 + F5 协作批注 + 带宽估计 + UI 主题 v2（SFU 主版本）

#### 5.12.1 数据通道从"一条频道"到"多条频道"（SCTP 多流）

- D+1 时一条 `label:'chat'` 频道按 `type` 分家（chat/react）；09-14 起**再开一条**
  `label:'annot'`——`setupDataChannel` 里 `produceData` 两次，mediasoup 的
  `numSctpStreams:{OS:1024,MIS:1024}` 本来就允许多条流并存。
- **为什么要分频道**： SCTP 流之间互不阻塞（聊天刷屏不会挤掉笔迹）； 语义隔离，
  订阅端按 `DataConsumer.label` 路由（`'annot'→handleAnnotMessage`，其余→聊天处理）；
  生命周期可以不同（聊天必用、批注是增强，失败互不拖累）。
- 面试句："mediasoup 数据通道的广播语义 + 应用层 type/label 分频，等价于在一条
  媒体链路上自建了一个极简消息总线。"

#### 5.12.2 F5 协作批注：数据通道的"教科书应用"（第 26c 步）

- **交互**：屏幕格右上角工具条（✏️ 开关 / 5 色画笔 / ↶ 撤销 / 🗑 清空），
  批注模式下笔迹实时同步给全房。
- **协议设计三要点**（都在 `sfu/protocol.js` 09-14 段）：
  ① **定向头 `to`**：消息带"屏幕归属者 id"——mediasoup 广播谁都收得到，
  应用层只画"我有他屏幕格"的那条（找不到就丢），这是"广播语义下做定向"的标准答案；
  ② **增量事件而非全量画面**：`op:'start/draw/end/undo/clear'` + 归一化坐标（0~1），
  本地画与远端收走**同一个 `applyAnnotOp` 状态机**重放出完整画面——事件溯源思想；
  窗口大小不一致也画得一样（resize 时按账本重放，笔迹不丢）；
  ③ **笔迹归属**：`colorFor(id)` 从成员 id 稳定算颜色，谁画的分得清。
- **共享者视角**：共享时给自己也开"我的屏幕"格（`addSelfScreenTile`）——
  既确认观众看到什么，批注也实时落在自己眼前（别人画我的屏幕，我立即看见）。
- **已知边界（写进代码注释）**：批注只存内存，不落屏、刷新即清；
  真实产品会持久化到对象存储并带权限（谁能清谁的笔迹）。

#### 5.12.3 带宽估计可视化（D+3 的前置一步）

- `getStats()` 里 selected `candidate-pair` 的 `availableOutgoing/IncomingBitrate`
  是浏览器 transport-cc/REMB 对当前路径的带宽估计——第 13 步读出后挂进
  「🔗 连接方式」徽标的悬浮提示（"可用带宽估计 ≈ X Mbps"）。
- 为什么先做它：D+3 的目标是"用带宽估计替代丢包率做 ABR"——第一步永远是
  **把数据看得见**，第二步才是让服务器据此选层。

#### 5.12.4 UI 主题 v2（学自公开设计系统）

- 配色方法论：**Radix Colors** 的 12 级层次（步骤 1-2 背景 / 3-5 交互件 / 6-8 边框 /
  9 实心强调 / 11-12 文字）+ **GitHub Primer** 的语义 token（fg/bg/border × default/muted/emphasis）。
- 落地：`:root` 定义 `--bg0~3` 四级背景、`--fg` 三级前景、`--border` 两级、
  `--accent` ×（emphasis 实心 / muted 大面积弱化底）——控制条玻璃胶囊、房间面板悬浮卡、
  视频格质感、聊天气泡分层。**类名零改动**（HTML/JS 不动，测试全绿的前提）。

#### 5.12.5 回归与新坑

- 冒烟 **49/49**（+5：双频道并存、批注层挂载、笔迹三段（start/draw/end 带 to）、
  对端笔迹账本重放、消息路径徽标）；信令 53/53 不变。
- **新坑（第 25 号，09-14 实修）**：mediasoup-client 的事件名是
  **`'producedata'`**（完整词）——曾凭记忆写成 `'procedata'`，`node --check` 全绿、
  冒烟桩也照错的事件名打桩所以全绿，真浏览器一跑就报
  `no "producedata" listener set into this transport`。教训：**API 名以源码/vendor 文件
  为准（grep 一次就知道），凭记忆写的名字必须在真浏览器里过一遍**。
- **新坑（第 25 号）**：顶层代码直接调 `window.addEventListener` 在无头测试的假 window
  上会抛错并**中断整个脚本加载**（后面的步骤全部未定义）——顶层 DOM API 一律防御式
  （`if (typeof window.addEventListener === 'function')`），这也是"加载期代码"与
  "运行期代码"的健壮性差别。
- **待人工验证**：两窗口真实批注同步（颜色/撤销/清空/谁画的）、共享者视角落点、
  带宽估计数字、UI v2 观感。

### 5.13 ★ 09-14c 路线图三连：D+3 带宽估计与 SVC / D+4 房间 TTL 与房主迁移 / E5 演示包

#### 5.13.1 D+3：ABR 从"单维度"到"双维度"（丢包率 + 服务器侧带宽估计）

- **为什么**：丢包率是"已经坏了才反应"的滞后指标；带宽估计（transport-cc 在
  服务器上对每条下行估出的 `availableOutgoingBitrate`）是"带宽不够先降级"的
  前瞻指标。真实产品的 ABR 都用带宽估计做主判据。
- **落地三处**：① `collectMemberNet` 并采两个维度，`net-levels` 广播带 `bwe`，
  前端网络点悬浮提示显示"≈ X Mbps"；② `startLayerMonitor` 的 tick 算出
  **bweCap（带宽允许的最高层）**，当前层超出即降（reason `auto-down-bwe`），
  升层也受它封顶——没有估计值时行为退回纯丢包模式，完全向后兼容；
  ③ Router 增加 **VP9 编解码**，config.json `videoSvc:true` 时摄像头改用
  **VP9 SVC（L3T3）单路分层**上传（协商失败自动回退 simulcast → 单层）。
- **simulcast vs SVC**（面试题标准答案）：simulcast = 三路独立编码，上行≈三档之和，
  兼容性最好；SVC = 一路编码内部分层，上行省、切层粒度细，但要 VP9/AV1 支持。
  本项目一个开关两种策略，参数都在 `config.json`。

#### 5.13.2 D+4：房间 TTL 与房主迁移（D6 已知边界补完）

- **空房宽限期**：最后一人离开/掉线 → `scheduleRoomTtl` 让房间保留 60s
  （`ROOM_TTL_MS` / `config.roomTtlSec` 可调）——Router 不关、号码不回收，
  宽限内原号（+密码）可回归；到期 `destroyRoom` 统一销毁（Router/量网/发言/
  TTL 三个定时器全清）。**"最后一个人掉线重连不回来"就此成为历史**。
- **房主迁移**：房主离开且房里还有人 → 迁给 `joinedAt` 最早的幸存者
  （joinRoom 时给每个成员记进房时间）。为什么不用选举算法？两行代码、无争议、
  可解释——分布式系统里"够用的规则"好于"聪明的协议"。
- 观测面板对空房显示"⏳ 空房宽限中 · 剩 xx s"。

#### 5.13.3 E5：演示包（可交付性收尾）

- `npm run start:demo`：一键拉起 Mesh(3000) + SFU(3001)，输出统一加前缀，Ctrl+C 全退；
- 《演示脚本-5分钟.md》：按时间轴的演示讲稿（架构 → 会议本体 → simulcast 弱网 →
  远程协助 → 面板/可达性 → 简历叙事），每段"讲什么/演示什么/技术点"，附 Q&A 弹药。
- 它解决的是"最强的功能没在人眼前跑起来"的最后一公里。

#### 5.13.4 回归与坑

- 信令 **56/56**（+3：VP9 能力、房主迁移、宽限期回归）；冒烟 49/49。
- 坑 3 的变体又咬人：`room-created`/`room-members` 都在 `create-room` **应答之前**
  发出——测试里先 `waitEvent` 注册监听、再 emit，顺序反了测试会永久挂起
  （不是失败，是挂起——比失败更难查）。
- **待人工验证**：TTL 到期真正销毁（等 60s 看面板/号码回收）、房主迁移后的踢人权限、
  `videoSvc:true` 的真实协商（控制台看 "VP9 SVC · L3T3"）、bwe 数值合理性。

### 5.14 ★ 09-15 持续升级：D+2 服务器侧录制 + "中国色/星云"前端美学

#### 5.14.1 D+2 服务器侧录制（浏览器录制 D5 的"真产品"对照）

- **为什么服务器录**：D5 在浏览器里 canvas 合成 + MediaRecorder——录的是"我这端看到的"，
  我掉线录制就断。服务器录：媒体本来就在 SFU 上，谁掉线都不影响——这是真实产品
  （腾讯会议云录制）的做法。
- **实现链路**（`sfu/server.js` 事件 6.1）：
  找到成员的 camera/mic Producer → 每路建一条 **PlainTransport**（纯 RTP 旁路，
  `connect({ip:'127.0.0.1', port})` 指向本机 ffmpeg 的收流端口对 50000+，`comedia:false`
  = 服务器主动发）→ consume + **resume**（坑 13①对 PlainTransport 同样适用）→
  按 Consumer 的 rtpParameters 生成 **SDP**（`sdpMediaSection`：m-line/rtpmap/fmtp）→
  `spawn ffmpeg -protocol_whitelist file,udp,rtp -i x.sdp -c copy 落盘`
  （copy = 无重编码零转码开销；VP8/VP9+Opus 落 webm，H264 进不了 webm 就落 mkv）。
- **工程细节**：端口对按 4 递增分配避冲突；ffmpeg exit 统一收尾（关 Consumer/Transport、
  删临时 SDP、记账）；产物经 `GET /recordings/<file>` 下载（path.basename 防穿越）；
  **ffmpeg 启动时探测**——没有就置 FFMPEG_OK=false，record-start 返回明确安装提示，
  功能缺失不炸服务器（信介试了这条错误路径）。
- 安装：Windows `winget install ffmpeg`，macOS `brew install ffmpeg`，装好重启服务器即生效。

#### 5.14.2 前端美学：向 zhongguose.com 与 nebula_artefact 各学一手

- **中国色（zhongguose.com）**：衬线中文标题 + 宽字距英文小型大写定调气质；
  低饱和传统色比高饱和霓虹更"耐看"；深底文字用**带轻微色相的灰阶**（月白 #e6ecf2），
  不用纯白。落地：token 全系换中国色（黛/苍/竹青/月白/胭脂/苍黄），`--font-display`
  衬线只用于标题层（品牌名/房间卡/预览页标题），正文仍是无衬线保证可读。
- **nebula_artefact（alteredqualia）**：WebGL 页的"耐看"来自**颗粒质感 + 缓慢漂移的
  深空氛围**。纯 CSS 落地：`body::before` 两团 90s 往返漂移的光晕（黛紫/竹青），
  `body::after` SVG feTurbulence 噪点（opacity .05）叠四角暗角——消除深色渐变的
  "塑料感"，两层都 `pointer-events:none` 不碰交互。
- 方法论：**借鉴的是"手法"不是"内容"**——色板取色值、氛围取层次、排版取节奏，
  但全部收敛进自己的设计 token，类名与结构照旧零改动。

### 5.15 ★ 09-15b 同构补齐：Mesh 版 HUD/连接徽标 + 观测面板录制状态

- **两版"同构"的真正含义**：传输层不同（P2P DataChannel vs 信令转发），但**传输层之上
  的体验层必须逐行对齐**。09-14b 把 workbench v3 同步给了两版，却漏了 Mesh client 侧的
  `remote-activity` 派发——被控端工作台的 HUD 永远收不到事件。教训：同步 UI 文件的同时，
  要 grep 另一版 client 的**事件生产方**有没有同步（生产方/消费方成对检查）。
- 补齐三处：① Mesh `emitWbActivity`/`describeWbTarget` + 重放五类动作派发（与 SFU 同构）；
  ② Mesh `monitorNetwork` 收集 local-candidate 候选类型 → 🔗 徽标（P2P 语义：
  类型是全体 peer 的汇总，有 relay 即有连接在走 TURN）；③ D6 重连清
  `recordingsByMember`（录制会话随断连已销毁，按钮状态要复位）。
- 观测面板增强：`/api/rooms` 带 `recordingCount` 与 `media[].recorded`——概览行显示
  "⏺ 服务器录制中"，媒体行标 ⏺。可观测性的原则再次兑现：**服务器知道的事都摆出来**。

### 5.16 ★ 09-15c 三连收官：D+2 端到端打通 + F7 协作白板 + E1 TURN

#### 5.16.1 D+2 端到端：用 ffmpeg 当"假摄像头"自证全链路

- **难在哪**：录制 API 依赖"有人开着摄像头"，命令行没法造浏览器。解法：**ffmpeg 自己当
  媒体源**——`testsrc2` 测试图 + libvpx 编码，以 RTP 推进 mediasoup 的一条
  **PlainTransport（comedia:true，等对端先发）**，手工 rtpParameters（VP8/PT96/SSRC 固定）
  produce 出一路"真实在流动"的 Producer，再走 `startRecording()` 完整链路。
- **自测通道**：`TEST_RECORD=1 node sfu/server.js`（或 `npm run test:record`）——
  2s 预流 → 录 7s → 验产物 >10KB → ffprobe 验时长 → PASS/FAIL 退出码。
- **踩坑三连（每条都是面试素材）**：
  ① **webm copy 必须从关键帧起写**：libvpx 默认关键帧间隔大，7 秒里 muxer 等不到
  关键帧 → 0 字节。`-g 15` 每秒一个关键帧解决；
  ② **Windows 上 stdin 'q' 退不出**：RTP demux 线程阻塞在收包，命令线程排不进去
  （"command received" 打了却迟迟不退出）→ 兜底 kill 丢 trailer（duration=N/A）；
  ③ **退出后 remux 补 trailer**：`ffmpeg -i raw -c copy fixed` 毫秒级重封装，
  duration/cues 补全——比纠缠跨平台优雅退出务实得多。
- 顺带的能力升级：record-start 支持 **{ producerId }** 直录某一路（成员/单路两种语义）；
  录制核心抽成模块级 `startRecording()`（信令与自测共用一份代码——"测试走生产路径"）。

#### 5.16.2 F7 独立协作白板（第 26d 步）：第三条 SCTP 频道的第二个应用

- **白板 vs 批注**（一句话讲清为什么两条频道）：批注是"贴在某块屏幕格上的笔迹"
  （带 `to` 定向头，屏幕关了笔迹也没了）；白板是"房间级共享画布"（不依附任何画面，
  全场一份、无需定向头）。事件溯源模型同款（start/draw/end/undo/clear + 归一化坐标）。
- **浅底配色纪律**：白板底是月白，笔迹必须用深色系（`BOARD_COLORS`）——同一套
  "颜色承载归属"思想，底色换了色板跟着换。
- 三条 SCTP 频道并存（chat/annot/board）+ 各自独立的路由与失败域——mediasoup
  `numSctpStreams` 多流设计的完整示范。

#### 5.16.3 E1 TURN：从"配置通道"到"开箱即用 + 自建包"

- `config.example.json` 预置 **openrelay 免费 TURN**（公共演示凭据）：复制成 config.json
  即跨网可通——「🔗 连接方式」徽标在跨网时会显示"TURN 中继"。
- `deploy/coturn/`：docker-compose + turnserver.conf（固定账号 demo、relay 端口段
  49160-49200），任何有公网 IP 的机器一条 `docker compose up -d` 自建；
  生产替换账号/加 TLS 即可。
- 至此 E1 的"自助部分"完全闭环：验证手段（徽标）+ 即用配置（公共 TURN）+ 自建路径（coturn）。

### 5.17 ★ 09-16 排版根治（CSS 注释陷阱）+ 玻璃质感回归 + 登录注册

#### 5.17.1 坑 26：CSS 注释里的 `*/` 陷阱（"排版乱/没字"的根因）

- 一行注释 `.annot-*/.ctrl-layer` 里的 `*/` 把块注释**提前闭合**，剩余文字成了
  非法裸 token，Chrome 把下一条规则（`:root {...}`）整块丢弃 → 全站 CSS 变量为空 →
  背景塌、颜色塌、字号塌——**看起来像"乱"，其实是"零样式"**。
- 排查路径（值得背）：发现样式诡异 → 页面里
  `getComputedStyle(document.documentElement).getPropertyValue('--bg0')` 为空、
  `document.styleSheets[0].cssRules` 里没有 `:root` → 解析层断了 → 回文件找非法 token。
- 防守三件套：注释不写 `*/`；静态响应 `Cache-Control: no-store`（改样式不再吃旧缓存，
  这次排查被旧缓存误导了好几轮）；样式引用带 `?v=日期` 兜底。

#### 5.17.2 玻璃质感回归：好看与不乱兼得（取长补短）

- 实底化虽然治了乱，但丢了磨砂的高级感。回归方案：**高不透明（.74~.92）+
  `backdrop-filter: blur(12~22px) saturate(140%)`**——玻璃的"透"来自模糊而非低透明度，
  透过来的只是柔和光斑，不会再透出清晰的视频和噪点。"取长补短"落地为：
  取旧版的玻璃质感，补新版的实底纪律。
- **色调重塑（09-16b）**：用户点名要传统文化气息 → 冷紫+竹青全系换**水墨丹青**：
  墨/绢暖黑底（#14100a）+ 宣纸白（#ece5d8）+ 鎏金强调（#d8b36a）+ 朱砂主按钮
  （#b93a26，变量名 `--violet` 沿用避免大面积改名——语义=主色）；顶栏/预览 logo
  改"會"字朱砂印章。方法论：**换气质先换 token**——所有组件读变量，一次换全站换。
- **grid 溢出坑（实修）**：`grid-auto-rows: 1fr` 的行是 `minmax(auto, 1fr)`，
  内容（aspect-ratio 盒子）会把行撑得比分配高度大 → 内容溢出容器（遮罩盖不住）。
  修法：`minmax(0, 1fr)` 强制行贴合分配 + 容器 `overflow: hidden` 双保险。
  表现特征："遮罩盖住了 90%，底部露出一条清晰内容"——溢出类问题的典型指纹。

#### 5.17.3 登录/注册：零依赖用户体系（基础功能补全）

- **存储**：`sfu/users.json`，密码用 Node 内置 `crypto.scryptSync(密码, 盐, 32)` 哈希
  （随机盐每用户一份）——不存明文、不引 bcrypt。"数据库泄露也拿不到原密码"是底线。
- **信令**：`auth-register` / `auth-login` / `auth-verify` 三件套；登录发随机 token
  （内存 Map），前端存 localStorage，下次打开自动恢复；服务器重启 token 失效是
  教学取舍（真实产品：数据库 + 长期 refreshToken）。
- **身份在连接上**：登录成功把 username/displayName 绑到 socket——之后聊天广播、
  成员快照自动带昵称，消息本身不用携带身份（这就是"服务端会话"的意义）。
- **安全细节**：密码错误与用户名不存在返回同一句"用户名或密码不对"（不向试探者
  泄露账号是否存在）。
- **昵称贯通**：成员列表（`我 · 小张`）、聊天气泡（信令与 SCTP 双路都带 name）、
  未登录回退"成员 xxxx"——游客模式保底，登录是增强。

### 5.18 ★ 09-17 F6 滤镜与虚拟背景（canvas 逐帧处理 + replaceTrack）

#### 5.18.1 三站流水线：GPU 滤镜 → GPU 磨皮 → CPU 色键

```
原始摄像头轨 ──▶ 隐藏<video> ──▶ ① ctx.filter 滤镜（GPU 合成器执行，≈0ms CPU）
                                  ② 磨皮：缩到1/4画布 blur 放大回叠（GPU，低清模糊=只糊细节保轮廓）
                                  ③ 色键抠像：getImageData 逐像素算色距写 alpha（CPU 大头）
                canvas.captureStream(24) ──▶ 处理后的轨 ──▶ replaceTrack 上行
```

- **美颜走 GPU 的原因**：`ctx.filter='saturate(1.15) brightness(1.06)'` 是 GPU 合成器
  在做，CPU 只发一条指令——这就是"能 GPU 就不上 CPU"的活教材。
- **磨皮不需要 AI**：把帧缩到 1/4 再 blur(3px) 放大回来叠半透明——低分辨率下高频细节
  （毛孔/细纹）被抹掉、轮廓保留，一次 drawImage 实现"一键磨皮"。
- **虚拟背景不引 ML 模型**（零依赖铁律）：用直播行业的**色键抠像**（绿幕/蓝幕）——
  逐像素算与键色的欧氏色距，容差内置透明、边缘线性羽化。为什么不直接 putImageData？
  **它连 alpha 一起整块替换**，必须双画布：先抠好的前景放 keyCanvas，主画布先画背景
  再 drawImage 前景盖上。
- **CPU 账（路线图明确要求会算）**：每帧 performance.now 差值 EMA 平滑（0.9 旧+0.1 新），
  每 24 帧刷一次徽标（≈每秒，别让 DOM 更新抢 CPU）。实测量级：GPU 滤镜+磨皮 <2ms；
  开色键 +2~5ms（640×360≈23 万像素）。推论：抠像别超 720p；画得慢 captureStream
  自动降采样率（只采画好的帧），不会堆积。

#### 5.18.2 接线设计：处理后轨直接顶替进 localStream（本步最值得讲）

- `cameraTrack` 变量改指**处理后的轨**，原始轨由管线攥着（`fx.origTrack`）。
  于是 publishTracks（第 7 步遍历 localStream）、关摄像头（第 10 步翻 enabled）、
  D6 重连重发——**三处一行不改**，因为"单一事实来源还是 localStream"，
  它们看到的只是"一条普通视频轨"，不知道后面藏着管线。
- **换摄像头要绕着管线走**（第 17 步 switchCamera 加 F6 分支）：滤镜开着时不能
  stop procTrack（连管线一起死）、也不能把原始新轨直接 replaceTrack 上行（观众
  会看到没滤镜的画面）——正确动作：停旧原始轨 + 管线输入源换新轨 + procTrack
  引用原样不动（观众无感）。
- **面板显示 ≠ 启动管线**：选档位/开绿幕那一刻 syncFxPipeline 统一出口才起管线；
  滑条只改 fx 数值，下一帧自动生效（管线吃状态不吃闭包快照，不用重启）。

#### 5.18.3 无头降级与冒烟断言

- canvas 2D 探测失败 → 管线起不来只 log；getImageData 缺失（无头桩）→ 色键降级、
  滤镜照常——F3 试音条同款"非阻塞降级"哲学，预览页/会议永远不会被增强功能卡住。
- 冒烟桩补了 getImageData/putImageData（全 0 像素）+ captureStream 返回带视频轨的流，
  **整条管线在无头环境真跑**：点档位 → 处理后轨顶替上行（rec.lastReplaced ≠ 原始轨）
  → CPU 账徽标刷新 → 绿幕切 CPU 抠像 → 关滤镜还原原始轨 → 面板开合，7 项断言。
- 冒烟实修两个坑：① 假 DOM 的 classList 不从 HTML 初始化——`fx-panel hidden` 的
  初始态要手动 add，否则 toggle 开合语义反转；② 帧循环桩是"每帧一个 setTimeout(0)"，
  实测约 9ms/帧，断言等待要放宽到 500ms 才跨过 %24 的徽标刷新点（真浏览器 rAF 是
  16.7ms/帧且 GPU 加速，无此问题）。

### 5.19 ★ 09-17b 实时字幕（Web Speech API · AI 线 L1）

#### 5.19.1 全链路：识别 → 定稿 → 广播 → 字幕条/账本

```
我的麦克风 ─▶ SpeechRecognition（浏览器厂商云端识别，continuous+interim）
                │ interim 半句：只更新本地字幕条（半透明），不广播
                └ final 整句：cap.log 入账 ─▶ 字幕条定稿 ─▶ chatDataProducer.send({type:'caption'})
对端：handleDataMessage 的 caption 分支 ─▶ 入账本 + 字幕条（显示"最近说话的人"）
```

- **为什么每端识别自己的麦克风**：省上行（不用传原始音频）、隐私（语音不出本机，
  只有转写文本过网）、识别语言跟人走。集中转写（把所有人的音频混给一个识别服务）
  是另一种架构，代价是带宽/延迟/隐私三头输。
- **可靠性按内容价值定价**（本步最值得讲的取舍）：字幕**不做信令兜底、不做 msgId
  去重**——丢一句字幕无所谓；聊天则双路径+去重（丢消息不可接受）。同一个数据通道，
  两种可靠性策略，按内容价值选，而不是无脑全保。
- **interim 只显示不广播**：半句每几百毫秒变一次，广播它会把 SCTP 刷爆；
  final 才发——"本地实时跳动 + 全房定稿同步"两头兼顾。
- **骑 'chat' 频道**（type:'caption'，与聊天/表情同流）：字幕与聊天同为全员广播的
  短文本，SCTP 流数不是免费的；真产品字幕量大、格式多（分段/语种）才值得单开频道。

#### 5.19.2 工程健壮性：识别器的"自动续命"与明确降级

- Chrome 的识别器**每 ~60 秒自动断**一次 → `onend` 里若开关还开着就 300ms 防抖重启
  （`cap.restartTimer`），字幕才能连续不断；关闭开关时先置 `cap.on=false` 再 stop，
  避免 onend 又把它拉起来（**状态先行，动作在后**的清理顺序）。
- `network` 错误 = 浏览器厂商的云端识别不可达（国内网络常见）→ 明确提示"识别服务
  不可达"并自动关闭；`not-allowed` = 麦克风权限被拒 → 提示并关闭。字幕绝不变成
  会议的拦路虎（F3/F6 同款非阻塞降级哲学）。
- 无头环境没有 SpeechRecognition → 点开关直接 toast 提示，功能不存在但不崩。

#### 5.19.3 字幕账本 = C2 的入场券

- `cap.log`：`{ts, from, name, text}` 数组，上限 500 条（环形裁剪防内存涨）。
- 它是 **AI 会议纪要/问答（C2）要喂给 LLM 的结构化上下文**——谁、何时、说了什么，
  全都在里面。加上 A6 审计日志（控制事件流），C2 的两份输入已全部就位；
  「⬇ 记录」按钮随手导出 txt（Blob 下载同 D5），人工会议记录也能用。
- 冒烟 7 项断言驱动真代码路径：远端字幕入条 → 识别器启动 → interim 不广播 →
  final 走 SCTP → onend 自动重启 → 导出 → 关闭。实修坑：F7 白板断言会把
  `rec.dataMessageHandler` 覆盖成 board 路由——字幕断言前要重订一条 chat 频道
  刷回路由（多频道并存的测试代价：handler 是"最后订阅者"的）。

#### 5.19.4 09-17c 深化：历史抽屉 + 状态机入册

- **字幕历史抽屉**：字幕条「⌃ 历史」开合 cap.log 的滚动视图（最近 100 条，更早的还在
  账本里，导出 txt 是全量）。抽屉开着时新字幕**追加一行+滚底**（不全量重渲染，列表不闪）；
  渲染一律 createElement + textContent——字幕是远端用户输入，XSS 纪律与聊天相同。
- **字幕开关进房间状态机**：member-state 白名单加 caption 布尔 → room-state 快照带
  caption → 成员列表显示 💬 徽标（他开着字幕转写，与 ✋ hand 同一信任模型：客户端
  上报、服务器存储+广播、白名单过滤）。
- **坑 30（新增）**：member-state 白名单（事件 5.7 的 for 循环）与 room-state 快照序列化
  （broadcastRoomState 的 map）是**两份独立清单**——加状态字段必须两处同改，漏一处时
  字段在前端永远 undefined，测试表现为 Promise 永不 resolve（超时卡死），非常难查。

#### 5.19.5 ★ 09-17e 过夜值守（C3-N1：把字幕从"一小时的会"变成"挂一夜的服务"）

> 规划全文见 `AI部分功能计划.md` 第 3.6 节；路线图 C3（`后续升级方向.md`）。
> 目标一句话：**睡前开字幕挂一夜（≥7 小时），早上拿到完整字幕全档 + 值守日志，零人工干预**。
> 代码：`sfu/public/client.js` **第 30 步** + `sfu/server.js` `/api/captions` + `npm run soak`。

- **L1 的三个"一夜就崩"点与本步对策**（对照着记，面试就是三个完整的工程故事）：
  ① 账本 `cap.log` 是 500 条环形 → 后半夜把早期字幕全挤掉 → **溢出归档**：
     `capPushLog` 剪掉的旧段入滞留批，`POST /api/captions` 让服务器 append 到
     `sfu/captions/cap-<房间号>-<日期>.jsonl`；上传失败滞留批里等 60s 兜底重发
     （成功路径还会立刻续传，溢出高峰也不滞留）——**内存=热窗口，服务器=权威副本**，
     这份 jsonl 就是将来 G2 喂给 LLM 的输入；
  ② `network` 错误 3 次永久停 → 后半夜网络抖三下字幕就停在凌晨两点 → **值守级退避**：
     30s→60s→120s→240s→5min 封顶，连续 12 次（约 45 分钟）才放弃；另加 **30s 看门狗**
     （setTimeout 自调度链）巡检 `cap.rec`——管 `onend` 之外的静默失效，拉起后一个周期
     内又死则间隔翻倍（5 分钟封顶），重启次数全部记账；
  ③ 夜里发生过什么无从知晓 → **值守统计**（字幕历史抽屉头部一行：时长/条数/重启/已归档）
     + 每 30 分钟一行心跳日志 + 导出 txt 时自动合并服务器全档。
- **两个配套的排程句柄纪律**（这次实修顺手修掉的隐患）：`clearTimeout(cap.restartTimer)`
  之后必须 `cap.restartTimer = 0`、重启回调执行时也要归零——看门狗靠「无排程」判断
  是否该接管，句柄变量残留非零值会让看门狗**永久失效**（逻辑对、状态脏，照样全盘皆输）。
- **`/api/captions` 的服务器侧要点**：房间号 6 位数字白名单（文件名直接拼房间号，必须
  先钳住路径穿越）；jsonl 每行一条 JSON（append-only，断电只坏半行，回读时坏行跳过）；
  单条只认 ts/from/name/text 并截长；`format=txt` 给导出合并、`format=json` 给将来的 LLM。
- **`npm run soak`（scripts/soak.js）**：服务器侧耐久自测——真建房常驻，三类流量持续
  （信令消息 / 归档 POST / 面板 GET），10 分钟心跳采样内存落 `sfu/logs/soak-*.log`，
  结束出报告并对账"POST 条数 == GET 回读条数"，零错误才 exit 0。默认 7 小时（正经过夜），
  `--minutes 2` 压缩自测；**前端的真 7 小时仍归 0.2 节人工清单**（命令行没有麦克风和
  真识别服务——能自动化的自动化，不能的说清楚，各归其位）。

#### 5.20 ★ 09-18 过夜全面升级：前端美学 v3 + 演讲人视图 + 值守日报 + /metrics

- **前端美学 v3（style.css 整份重写，选择器零丢失）**：09-14b 换暖墨底时残留的
  冷蓝灰面板色（rgba(26,26,40,…) 族、#12151f、#2b3550、#9fb0cd……）是"说不上来的
  不和谐"的根源——v3 全部换成暖墨 token（--glass/--ink-2 族），并补齐玻璃面/暗角/
  语义绿的暖调版本。教学点：**深色主题换色相时，"中性灰"最容易漏改**，灰阶永远带着
  底色的色相才耐看。
- **演讲者视图 = 大画面 + 底部胶片条**（纯 CSS，JS 零改动）：grid 两行
  （`minmax(0,1fr) auto`），tile-main 独占第一行，其余格子压进第二行并限高 150px。
  顺手修正布局语义：tile-main 的全宽规则圈定在 `.layout-speaker` 里，宫格视图恢复
  "所有人一样大"（tile-main 只剩金环标记）。说话人高亮升级为鎏金呼吸金环
  （speakGlow 动画）；所有装饰动画都带 `prefers-reduced-motion` 降级。
- **演讲人交接迟滞（09-18 补完收尾）**：audio-levels 每 400ms 一报，抢话/呼吸间隙
  会让 top 不停易主——新候选人必须**连续坐稳 SPEAKER_HOLD_MS（1.5s）才交接大画面**
  （含安静回退也走迟滞）；高亮与音量条仍然即时。防抢话闪烁 = 迟滞防抖思想与 D1
  选层同源。实修坑：冒烟断言引用了 D6 段 resetMediaState 之后的"死元素"——断言前
  必须补订一路活格子。
- **坑 32（真 bug）**：attachRemoteMedia 的"复用已有主画面格"分支按 key 前缀抓格子，
  会抓到该成员先订阅的屏幕格并把 tile.source 改写成 camera（元数据腐蚀，"关摄像头
  再开"必踩，选层/换层从此指错格子）。修法 = 按 box 匹配（producerId 会变，box 才稳）。
- **C1 值守日报（第 31 步，零 LLM）**：服务器归档（format=json）+ 内存窗口 = 全档 →
  纯本地统计出 markdown 日报（时长/说话人占比/每小时活跃/值守健康）。与 N2（LLM
  纪要）的关系：**日报给结构骨架，LLM 负责读懂内容，两层互为兜底**。
- **G7 /metrics 首刀（零依赖）**：复用 snapshotRooms() 手拼 Prometheus 文本格式——
  面板与监控吃同一份数据源（"同一份真相"）。回归：信令 73/73 + 冒烟 91/91。

### 5.20.1 ★ 09-19 丝滑化与跨网（v3 的两道补丁）

- **"说话人过大"的修法**：演讲者大画面原是 grid `1fr` 行 + stretch 撑满；改为
  `place-self: center + width:100% + max-height:100% + aspect-ratio:16/9`——
  CSS 的 contain 语义（宽定高随，高钳宽缩），大画面保持比例、绝不满溢。
- **"切换生硬"的修法（View Transitions API，零依赖）**：`document.startViewTransition(cb)`
  让浏览器对前后两帧 DOM 自动做 crossfade——grid 布局重排本来无法 transition，这是唯一
  平滑路。关键工程点：**只在"布局签名"（视图模式+大画面归属）变化时包过渡**——
  audio-levels 每 400ms 一 tick，无差别包过渡会每 tick 截屏一次（卡顿+浪费）。
  降级链：API 不存在 → 直接切换；reduced-motion → 直接切换。
- **跨网真相（面试讲点）**：TURN/STUN 只作用于浏览器侧；mediasoup 服务器不走 TURN，
  它向浏览器通告的 candidate 就是 announcedIp——**announcedIp 不可达 = 跨网必挂**，
  与 iceServers 配多少条 TURN 无关。所以跨网部署的三种正解是：公网 announcedIp（云机）、
  虚拟组网（Tailscale，announcedIp=100.x IP）、端口映射（需公网 IPv4）。
  运维经验：announcedIp 是静态配置、IP 是动态的——"昨天能连今天连不上"先跑 doctor。
- **G7-②③ 收尾**：logEvent(level,event,fields) 追加 JSON Lines 到 `sfu/logs/app-日期.jsonl`
  （console 人读照旧=双轨），只埋低频关键事件（8 个埋点）；实修坑：disconnect 清理作用域里
  房间号是 `socket.roomNumber`，写错作用域 = 成员离开时服务器崩溃（node --check 验不出
  作用域错误，只有信令回归真跑才炸出来）。watch.js = 拉 /metrics + /api/rooms 按阈值告警
  （服务拉不到/健康分低/宽限告急/rss 超限），同类告警 5 分钟限流，webhook 就是一次 fetch POST。

### 5.22 ★ 09-19b 白板 v2 + Otter 字幕节奏 + AI Bot 参会者（AI 线 C 档第一站）

- **白板 v2「宣纸 editorial」**（参考 recent.design igochi 案例：黑白极简+杂志排版+
  手写笔迹感）：色板换水墨五色（墨黑/朱砂/鎏金/黛蓝/竹青——通用红蓝绿与整体气质脱节）；
  纸张=暖纸白+四缘渐晕+feTurbulence 颗粒（background-blend-mode: multiply），消除
  "纯色画布"的塑料感。手法与会议主界面同源：**一套材质语言贯穿所有面板**。
- **字幕抽屉的 Otter.ai 节奏**：转写可读性的关键是**按说话人分组**——连续同一人合并成段
  （段头=名字+段首时间，段内每句一行），中间插了别人的发言就开新段（对话流）；
  最新一句金色左线高亮。实现：分组状态从 DOM 自身推断（最后一段的 dataset.speaker），
  全量渲染与逐条追加走同一条路径——**状态放 DOM、两条路径天然一致**（事件溯源同款哲学）。
- **AI Bot 参会者（三件套）**：
  ① 身份：`room.aiBot` → room-state 快照注入 `isBot` 虚拟成员——bot 没有 socket，
  它只是"房间记录上的状态 + 服务器自己的媒体管线"；前端成员列表 🤖 行 +
  控制坞按钮（快照驱动按钮态=状态放唯一权威处）；
  ② 耳朵（**服务端音频管线**）：对每路音频 Producer 建 `PlainTransport→consume→
  本机 ffmpeg(astats)` 的 RTP 旁路，2s 解析 RMS 分贝记 `aiHearing`——这是服务器
  第一次真正拿到会议音频字节流；将来 N2 真转写（Whisper/云 ASR）就在这条管线插
  转写器，管线不动。与 D+2 录制同源（PlainTransport 套路复用），区别：录制求落盘、
  听觉求实时响度；
  ③ 嘴巴（@ai 问答）：`aiBrain` 读感知数据（成员/talk-stats/字幕账本 jsonl/aiHearing）
  → 有 `DEEPSEEK_API_KEY` 走 DeepSeek 真答（纯 fetch，15s 超时），无 key/失败降级
  本地模板（答案带 `[Mock]` 前缀）→ `chat-message(from='ai-bot')` 金边气泡广播。
  **AI 双轨约定第一次实战**：回归永远跑 Mock（信令 81 里有 [Mock] 断言），真 key 只在真环境生效。
- **坑 33（AI Bot 实机炸出来）**：浏览器端"不带回调"的 emit × 服务器 `ok(callback)`
  无条件调用 = 服务器崩（一邀请 AI 全房断线）。修法：ok/fail helper 统一加
  `typeof callback === 'function'` 守卫——**在公共 helper 上修一次，胜过在每个事件上防守**。
  另：server 没有 client 的 `shortId`——把 client 的 helper 想当然搬进 server 就是
  ReferenceError（坑 14 "别把两版搞混"的函数级变体）。
- **回归（本次实测）**：信令 **81/81**（+7 AI 断言）+ 冒烟 **95/95**（+4：AI 按钮/
  bot 行/按钮态/@ai 改道/金边气泡）+ 真机全流程（邀请→🤖 行→@ai→金边应答→白板 v2）。

### 5.23 ★ 09-19c N2 纪要骨架 + G3 录制回放（"录了能看、说了有账、账能成文"）

- **纪要合成器 buildMinutes**：字幕账本（loadCaptions 公共函数，读 sfu/captions/*.jsonl
  权威副本）+ 发言统计 + **待办关键词规则抽取**（需要/记得/下周/明天/跟进……这组规则
  在没有 LLM 的年代就实用——教学点是"规则层与智能层分层，规则层永远兜底"）。
  双轨：DEEPSEEK_API_KEY 存在走 LLM（结构化 prompt：要点≤6/待办/结论），失败或无 key
  降级本地模板，尾注 [Mock]——**用户永远分得清"这是机器想的还是模板拼的"**。
- **三个触发**：ai-minutes 信令（手动）/ bot 在场时 setInterval 定时分段（config.
  minutesIntervalSec，默认 1h，聊天里播报路径）/ ai-leave 与 destroyRoom 自动终稿
  （异步 fire-and-forget，不阻塞信令主路）。终稿读的都是文件与闭包，不依赖已销毁的 room。
- **HTTP 面**：GET /minutes/<房间>/<文件>（房间号 6 位 + 文件名 \w 白名单，双钳制防
  路径穿越）+ /api/minutes 列表；@ai 问"纪要/总结"直接生成并回路径（零前端改动接入）。
- **G3 录制回放**：/api/recordings（只报 .webm/.mkv）+ recordings.html（列表+<video>+
  下载，零依赖暖墨风）——D+2 从"技术验证"变"真功能"。真机验证：test:record 产物
  点击播放 duration=4.0s 自动播。
- **实修坑（test:record 竞态）**：probeFfmpeg 是异步 500ms，媒体引擎 0.1s 就绪后
  TEST_RECORD 立刻跑 → FFMPEG_OK 还是 false → 误报"ffmpeg 不可用"。修法：自测前
  等探测收敛（轮询最多 3s）+ 深扫兜底。教训：**异步探测 × 立即消费 = 竞态**，
  "还没探到"不等于"没有"。
- 回归：信令 **86/86**（+5）+ 冒烟 95/95 + test:record PASS。

### 5.24 ★ 09-19d 代码地图：把"会看这份代码"教给你（详细版）

> 这一节回答新接手的人（包括三个月后的你自己）最常问的问题：**"这个功能在哪、
> 一条消息是怎么走的、我加一个功能要动哪几个文件"**。配合第 0 章阅读路线使用。

#### 5.24.1 三份运行时代码各自管什么（单一职责）

| 文件 | 一句话职责 | 绝不该出现的东西 |
|---|---|---|
| `sfu/server.js`（分区 A~E+AI） | **唯一权威**：房间表、媒体中枢（Router/Transport/Producer/Consumer）、授权门禁、录制、纪要、全部 HTTP 接口 | 任何"只属于某个浏览器"的状态（比如字幕热窗口） |
| `sfu/protocol.js` | **信令字典**：每个事件的载荷/方向/门禁一览。改信令前先看它，改完先回填它 | 逻辑代码（它只有注释和常量） |
| `sfu/public/client.js`（步骤 1~48） | 浏览器的一切：登录→预览→媒体→协作→字幕→值守。**「第 N 步」编号就是目录** | 别的成员的状态权威（UI 可以缓存，真相在服务器） |

> **为什么不用模块拆分？**（面试必问的架构取舍）单文件分区 = **线性可读**：新人从
> server.js 第一行读到最后一行就是一次完整导览；模块化 = 各取所需但需要"跳转地图"。
> 本项目的选择：**文件内强分区注释 + 文件间靠 protocol.js 这份"接口字典"解耦**，
> 拆分时机 = 出现第二个消费者（比如 bot 复用媒体层）再说。取舍本身比选择更重要。

#### 5.24.2 四个平面：一条消息/一帧画面/一条聊天/一次巡检的完整旅程

```
【信令面】 socket.io（TCP）
  浏览器 emit('create-room') ──▶ server joinRoom()：建房间记录 → Router 懒创建
      ◀── room-created / room-members（带老成员 Producer 清单）
  以后每个 room-state 快照 = 全房真相广播（成员/静音/举手/字幕开关/AI Bot 在不在）

【媒体面】 RTP/UDP（40000-49999）
  摄像头/麦 ─▶ sendTransport.produce() ─▶ 服务器 Producer ─▶ 每个订阅者一条 Consumer
      （simulcast 三层 / SVC；服务器按丢包+BWE 自动选层 = D1/D+3）
  屏幕共享 = 第二路 Producer（source:'screen'，独立格）

【数据通道面】 SCTP（复用媒体连接，三条频道并存）
  chat 频道：聊天+表情+字幕（广播语义；"定向"要应用层加 to 头）
  annot 频道：屏幕批注（带 to 定向头） board 频道：全场白板（无定向头）

【HTTP 面】 普通请求（和信令无关）
  /api/rooms（快照） /dashboard /metrics（Prometheus） /config.json（ICE 下发）
  /api/captions（字幕权威副本） /api/minutes + /minutes/…（纪要） /api/recordings + /recordings/…
```

#### 5.24.3 功能速查表（"它住在哪"）

| 想改/想懂 | 去哪 | LEARN |
|---|---|---|
| 房间/密码/踢人/房主迁移 | server.js C 段（joinRoom/destroyRoom/scheduleRoomTtl） | 2.8/5.13.2 |
| 媒体上下行/选层/SVC | server.js 事件 ④⑤、startLayerMonitor；client 第 6~7/19 步 | 5.8.3/5.13.1 |
| 说话人/发言占比 | AudioLevelObserver→audio-levels/talk-stats 广播；client 第 16/26b 步 | 5.8.2 |
| 远程协助全链路 | server 事件 5.5~5.9（授权/输入门禁/剪贴板/文件/限时）；client 第 14~23 步 | 5.7/2.13 |
| 批注/白板 | client 第 26c/26d 步（事件溯源重放） | 5.12.2/5.16.2 |
| 滤镜虚拟背景 | client 第 28 步（canvas 管线+replaceTrack） | 5.18 |
| 字幕/值守/日报 | client 第 29/30/31 步；/api/captions | 5.19 |
| AI Bot/纪要 | server.js「AI 基建块」+ aiBrain/buildMinutes；client aiBtn/@ai | 5.22/5.23 |
| 观测/指标/日志 | snapshotRooms、/metrics、logEvent→sfu/logs/*.jsonl | 5.11/5.20 |
| ★ 共享文件浏览（所有人看同一页） | client **第 51 步** + `sfu/public/fileview.js`（渲染内核）+ `sfu/files.js`（存储）+ server `room.fileView`/`files-*` | **5.56**（新格式与安全两道）/ **5.57**（旧版二进制 + 真形状） |
| ★ 跨网"外面进得来" | server `attachRtcServer`/`mediaListenInfos`（固定端口 UDP+TCP）、`sfu/nets.js`（`announceIps`/`diagnose`）、`scripts/stun-probe.js`（反射地址）；界面在**邀请面板** | **5.57.5 / 5.57.6** |

#### 5.24.4 新功能接线清单（照做就不会漏——本项目每次升级都在走这张单子）

1. `protocol.js`：先写事件注释（方向/载荷/门禁）——**想不清楚就不许写代码**；
2. `sfu/server.js`：事件处理（fail/ok 回调守卫已有；跨连接状态放模块级=坑 18；
   白名单过滤输入；房间销毁/断连的清理路径**三处都要顾**）；
3. `sfu/public/client.js`：DOM 引用（$）→ 事件监听 → 渲染函数（textContent 纪律）；
4. `sfu/public/index.html`：元素（id 契约）+ style.css 新节（类名先查 client 动态创建的契约类；
   注释里不写 `*/`=坑 26；`.hidden` 终审=坑 24）；
5. 测试：`scripts/test-sfu-client-smoke.js` 加桩+断言（坑 27/28/29 都在测试侧）；
   `scripts/test-sfu-signaling.js` 加信令断言（坑 3：监听先于 emit；坑 31：先确认服务器是新的）；
6. `node --check` 全家 → 冒烟 → 信令 → **浏览器真机**（回归全绿≠界面没坏）；
7. 回填：protocol.js → LEARN（教学）→ README（功能表/历程表）→ AGENTS（记忆）→
   路线图（存档+更新记录）；数字必须真跑。

#### 5.24.5 调试路径（按"症状"查）

| 症状 | 第一反应 |
|---|---|
| 连不上/没画面 | 顶部 🔗 徽标（直连/STUN/中继）→ `npm run doctor`（announcedIp 过期是头号惯犯） |
| 信令通媒体死 | chrome://webrtc-internals 看候选对；/dashboard 看字节在不在流 |
| 页面行为怪 | Ctrl+F5（no-store 已防，但浏览器记忆顽固）；控制台看有没有红字 |
| "昨晚还好好的" | 服务器日志 sfu/logs/app-*.jsonl + `npm run watch`；`doctor --json` 机读 |
| 值守夜里的事 | 值守统计行 + 心跳日志 + /api/captions 对账 + minutes/ 纪要时间线 |

#### 5.24.6 内存与长跑（09-19d 架构优化实录）

- `log()` 400 行环形：过夜几万行日志曾会无限撑大 textContent（每次 += 整串重建=O(n²)）；
- 聊天 DOM 300 条环形：SCTP 广播下长会 DOM 节点是重排开销大头；
- 账本类数据（字幕/纪要/审计）一律"**内存热窗口 + 文件权威副本**"——
  这一句就是本项目全部长跑工程的总纲。

#### 5.24.7 ★ 09-19e 去"AI 味"：界面克制化的方法论（UI 审美面试题）

- **AI 味的三个根源**（对照本项目改造前后）：
  ① **彩色 emoji 当图标**——真产品（腾讯会议/Zoom/Linear）全是单色线性图标；
     彩色 emoji 一多，页面立刻像"AI 拼的演示稿"。对策：24 viewBox 手绘 path 的
     SVG 常量集（ICONS），stroke=currentColor——图标颜色**继承文字色**，hover/active
     变色零额外代码；静态按钮（HTML）与动态按钮（setIconBtn）同构输出；
  ② **渐变与玻璃堆料**——什么都想"高级"，结果每样都在喊。对策：主按钮纯色
     （渐变只在"压轴的一个"上用）、玻璃 blur 只留真正悬浮的层（顶栏/控制坞/字幕条），
     面板一律实底——**层次靠明度差，不靠滤镜**；
  ③ **圆角/描边/阴影过花**——圆角收成三档、描边默认退后 hover 才上前、投影近处浅。
- **工程细节**：动态改文本的按钮必须走 setIconBtn（textContent 赋值会毁掉图标）；
  徽标 addBadge 从 textContent 改 innerHTML（传 ICONS 常量，无 XSS 风险）；
  测试断言从 textContent 改 innerHTML（桩不聚合，坑 27 家族）。
- **reaction 区的 emoji 保留**——表情回应的语义就是 emoji，克制 ≠ 一刀切。

### 5.25 ★ 09-19f SFU 深造：多 Worker 横向扩展 + 信令压测（G1-② + G8-③）

- **为什么多 Worker 是 SFU 深造的第一步**：mediasoup 的媒体转发跑在 Worker（C++
  子进程）里——**一个 Worker 只能吃满一个核**。E4 基准测出"16 发 16 收仅占单核 6%"
  意味着单 Worker 还有余量，但"多核横向扩容"是容量天花板被摸到之前就该备好的路。
  第二步（多机 pipeTransport 级联）成本高得多，第一步零依赖、改动只有一处。
- **实现（最小侵入）**：`workers` 数组 + `startOneWorker()`（died 时摘除+5s 补位，
  其它 Worker 上的房间不受影响）+ `pickWorker()` **轮询**分配新 Router；`worker`
  变量保留 = workers[0]（TEST_RECORD 自测与快照 pid 引用零改动）。数量 =
  `CONFIG.workerCount` 或环境变量 `MEDIASOUP_WORKERS`，默认 1（行为完全不变）。
- **取舍话术（面试）**：分配策略选了**轮询**而非"按 Router 数最少"——轮询无状态
  O(1)，最少连接需要自己记账；在房间数远小于 Worker 承载上限时两者差异可忽略，
  等真的需要再上记账策略。**实测**：`MEDIASOUP_WORKERS=2` 起服务，三个房间依次
  分到 W(pid 74720)/W(77872)/W(74720)——轮询生效。
- **实修坑**：mediasoup Router **没有 `.worker` 引用**（想当然即 null）——在
  pickWorker 时把 `w.pid` 记到 `room.workerPid` 才是正路。教训同"别把两版搞混"：
  **别想当然 API，查不到就自己记账**。
- **信令压测（bench-signaling.js，诚实声明：压的是信令+房间管理面，不是媒体面——
  媒体面看 bench.js 的 16 发 16 收 RTP 数字）**：32 客户端 4 房 × 15s 实测——
  连接 32/32、ping RTT **p50=3ms / p95=6ms / max=8ms**、聊天广播放大 ≈17.8×。
  退出码规则：连接全成功且 p95<1s 才 PASS。
- **配套**：`ping` 探活信令（RTT 探针+运维探活双用）；`/metrics` 加 `sfu_workers`
  gauge；config.example.json 加 `workerCount`。

### 5.26 ★ 09-19g C1 AI 远程操作员（ReAct × 控制协议，授权绝不豁免）

> AI 主攻线第二条主线落地。演示一句话：**有人在共享屏幕并开着"允许远程协助"，
> 任何人点控制坞「🛰️ AI 操作」→ 被控端弹出的授权卡与人类控制端**一模一样**——
> 可以拒绝、可以限时长 → 允许后 AI 自动移动鼠标/双击计算器/点击按钮/输入文本，
> 被控端的审计日志把 AI 的每个输入照记不误。**

- **核心架构决策（本节最重要的一行）**：AI 不是"绕过协议的后门"——服务器自己开一条
  **真实 socket.io 客户端连接（botSocket）**，走与人类**完全相同**的
  remote-request → 授权卡 → remote-answer → remote-input 门禁 → remote-release。
  门禁的价值是"只有服务器在册的控制端能发输入"，AI 必须在册。为什么不用
  "借用发起者 socket 发输入"？那会把 controllerId 校验变成摆设——**授权链路的
  价值恰恰在于它对所有人（包括 AI）都不豁免**。
- **ReAct 的教学版定位（诚实）**：现在是"计划-执行"型 agent——LLM/Mock 把目标
  翻成操作 JSON 计划（move/click/dblclick/type/key/wait，坐标 0~1 归一化），
  顺序执行；**Observation 回环**（每步之后拿屏幕状态反馈给 LLM 修正下一步）
  是明确的升级点——需要屏幕截图回传（A4 截图协议可以反过来用），注释里画了插口。
- **双轨**：`DEEPSEEK_API_KEY` 存在 → `llmPlan`（prompt 给工具说明，要求只输出
  JSON 数组）；无 key/失败 → `mockPlan`（确定性演示脚本：双击计算器图标→按 7、8、=，
  坐标常量按 workbench.html 伪桌面布局校准）。
- **工程实修三条**：
  ① **botSocket 每任务全新连接**——复用旧连接会把上一轮的房间状态带进来
  （remote-request 迷路的根因）；
  ② **授权等待独立 5s 超时**——用任务总超时（30s）等授权，"没人理授权卡"会把
  任务互斥锁占住半分钟；
  ③ **帧编码在服务器端**：DataView 默认大端 → Buffer 用 `writeFloatBE/writeUInt16BE`
  （端序不对=坐标全错，node --check 查不出来）。
- **回放侧零改动**：被控端的重放/审计/涟漪/HUD 字幕对 AI 输入与人类输入完全无感——
  这就是"协议层平等"的红利：AI 能力长了，被控端一行代码没动。
- **回归（本次实测）**：信令 **93/93**（+5：无共享拒绝/受理/真实授权请求/输入序列含
  16 字节帧/自动交还控制权）+ 冒烟 95/95。真机：两窗口演示（共享+协助 → 另一窗
  点「🛰️ AI 操作」→ 授权 → 看伪桌面上的鼠标被 AI 牵着走）。

### 5.27 ★ 09-23 G4 移动端 / PWA（手机也能体面开会，路线图 G 档）

> 一次"纯前端零依赖"的收官：不加任何库，让会议页在手机上可用、可安装、可省流。

**三件事（对应 client.js 第 32 步 + style.css 第 25 节）**：

1. **PWA 外壳**：`manifest.webmanifest`（名字/图标/主题色，用 `.webmanifest` 扩展名
   避开 `/config.json` 特殊路由）+ `sw.js`（Service Worker：预热缓存核心静态文件、
   cache-first 拦截、**socket.io 请求绝不碰**、导航 network-first 断网兜底 index.html、
   版本号缓存激活时自清）。`index.html` 挂 `<link rel="manifest">` + theme-color；
   图标 = 墨底金框朱砂"會"（1024×1024，`icons/`）。服务器 MIME 表补
   `.webmanifest/.png/.svg/.json` 四条。**安装到主屏后像个原生 App**——
   答辩现场手机扫码进会再长按"添加到主屏幕"，演示效果直接拉满。
2. **移动端响应式**：≤980px 时侧栏本来就是"移出画布"的抽屉，但**没有任何开关能拉出来**
   （真缺口）——顶栏补 `sideBtn`（桌面隐藏）+ `sideScrim` 遮罩（点它关抽屉），
   状态位只有一个 `body.side-open`；≤760px 紧凑档：控制坞按钮收成图标
   （`.btn:has(.i) span{display:none}`，Chrome 105+ 的 `:has` 选择器，老浏览器退化成
   完整文字，可用性不受损）、网格列 150px、字幕条上移避让两层控制坞、预览页竖屏堆叠。
3. **低带宽模式（"省流"开关）**：一键把**所有远端画面**锁到 simulcast 最低层——
   复用 D1 的 `set-preferred-layers` 信令，**服务器零改动**；关 = 逐路发 `spatialLayer:null`
   交回自动。钩子挂在 `layer-changed`：省流开着时，服务器 ABR 的任何"升层/回自动"
   都会被立刻纠回 0 层（弱网下"不该发生的事"就纠回去）。

**顺手修的三件事**：
- 冒烟既有 flaky（F6 绿幕断言）：逐像素色键循环让桩帧率 10→28ms/帧，固定 500ms
  等待跨不过 `%24` 徽标刷新点——改轮询（最多 3s），快机器零等待；
- `updateLayerPicker` 补 tile 空值守卫（D6 重连清格后迟到的换层通知不再炸）；
- 测试头部补记：起服务器要带 `AI_OP_STEP_MS=20`，否则 09-19g 那组会"假失败"。

**新坑两条（记入 AGENTS 第 7 节）**：sw.js 注释里写 `**/socket.io`——`*/` 提前终止
块注释（坑 26 家族第三例，`node --check` 抓到了）；冒烟桩的 `classList.toggle()`
不返回布尔（真 DOM 返回）——依赖返回值的代码在桩里语义反转，要"toggle 后用
contains 读回"。

**回归（2026-09-23 实测）**：冒烟 **107/107**（+12）+ 信令 **98/98**（需
`AI_OP_STEP_MS=20 node sfu/server.js`）。
⚠️ 待人工验证：手机真机（扫码进会/装到主屏/横竖屏）、省流开关真实锁层效果、
断网后壳子能否渲染。

---

### 5.28 ★ 09-24 AI 会议助理：从"能跑"到"敢上线"（Provider / 双轨 / 流式 / 三处实修）

> 这一节回答一个很实际的问题：**给项目接 LLM，到底要动哪些工程决策？**
> 代码本身很简单（一次 HTTP POST），难的都在它周围：密钥放哪、失败怎么办、
> 花多少钱怎么量、怎么在没网络的机器上也能演示、怎么让"AI 故障"不拖垮会议。

#### 5.28.1 先把重复代码收口：`sfu/ai/provider.js`

改造前 server.js 里有三份几乎一样的 DeepSeek 调用（aiBrain 问答、llmPlan 操作员计划、
llmMinutes 纪要），各自写超时、各自判错、各自的降级提示文案——这种"复制三次"的代码，
改一处忘两处只是时间问题。收口后只有一个入口：

```js
const res = await AI.askLLM(messages, { temperature: 0.3, maxTokens: 800, mock: () => '本地兜底' });
// res = { text, mock:false, usage:{promptTokens, completionTokens, totalTokens}, ms }
const s   = await AI.streamLLM(messages, opts, (delta) => io.to(room).emit('ai-stream', { delta }));
```

三个设计点值得单独讲：

1. **密钥三来源**：`DEEPSEEK_API_KEY` 环境变量 > 项目根 `.env` > `sfu/config.json` 的 `ai.key`。
   `.env` 的解析器自己写了 12 行（跳过 `#` 注释、去掉包裹引号、**不覆盖已存在的环境变量**）——
   不引 dotenv，也是想说明"那玩意儿做的事就这么点"。
2. **密钥永远不出服务器**：`/config.json` 只下发 `aiEnabled: true/false`，
   连密钥末四位都不给。浏览器是公开可下载的资源，**任何回显都等于泄露**；
   这条线有一条自动化断言站着（下发体里搜 key 特征）。
3. **降级钩子随调用方走**：`mock()` 由调用方给，provider 只负责在"无 key / 超时 / HTTP 错误 /
   空返回"时调用它并把 `mock:true` 标出来。**AI 故障绝不上抛到信令层**——
   字幕 F3/F6 那套"非阻塞哲学"在这里再次生效：AI 是锦上添花，不是会议的关键路径。

#### 5.28.2 长文本纪要：map-reduce 是怎么用出来的（scripts/summarize.js）

LLM 的上下文窗口是有限的，但会议可以开三小时。通用解法是**分而治之**：

```
原文（3h 字幕） → 切成 N 段 → 每段各出一份摘要（map） → 把 N 份摘要合并成终稿（reduce）
```

它不是"取巧"而是必需的：一次性塞 10 万字符，要么被截断，要么费用翻几倍。
本项目 `scripts/summarize.js` 的 `summarize()` 与服务器 `buildMinutes()` 是同一套策略的
两个外壳——**离线版用来调 prompt**（改完立刻 `npm run ai:summarize` 看效果），
调满意了再同步回服务器：调 AI 不用重启线上会议。

#### 5.28.3 agent 的本质：手写那个循环（scripts/agent.js）

所谓 function calling，**模型从不真的执行任何东西**——它只是输出一段 JSON 说"我想调 X，
参数是 Y"，真正的执行在你自己的代码里。因此核心循环只有四步：

```
① 拼消息（工具清单 + 历史 + 目标）
② 让模型决策：{"action":"工具名","args":{...}} 或 {"final":"答案"}
③ 真去跑那个函数
④ 把结果作为 Observation 塞回消息列表 → 回到 ① （设最大步数防打转）
```

教学版特意保留了两个细节：**工具报错也要喂回去**（模型看到 ERROR 会自己改参数重试，
这正是 ReAct 里 Observation 的价值），以及**最大步数**（6 步还收敛不了就收尾汇报）。
LangChain 的核心也就是这几行——手写一遍之后，"agent 在干什么"这件事就不再神秘。

#### 5.28.4 为什么做了流式（`ai-stream`）

一次性回答要等模型憋完整段，常见 3~8 秒。**对延迟的感知不是由总时长决定的，
而是由"有没有东西在动"决定的**——首字 1 秒 + 持续吐字，比沉默 5 秒后整段出现好得多。
实现上是两条路并存：

- `ai-stream {id, delta, done}`：SSE 增量，边解析边转发（DeepSeek 的 SSE 帧要按 `\n` 切，
  末半帧留到下一轮，否则 JSON.parse 会炸）；
- 结束再补一条 `chat-message`（带同一个 `streamId`）：它是**权威终态**，
  给中途进房或丢过流事件的人兜底；前端收到时按 streamId 去重，同一条不显示两遍。

这就是全项目的双路哲学在不同场景下的两种定价：**字幕容忍丢**（不兜底）/
**问答不容忍丢**（必然兜底）——可靠性应该按内容价值收费。

#### 5.28.5 顺带修掉的三个真 bug（都有复现，不是猜的）

| 现象 | 根因 | 修法 |
|---|---|---|
| config 里 IP 是旧的 → **别的电脑一律黑屏**，本机却一切正常 | 旧代码只打印告警，**仍把错 IP 通告进 ICE candidate**（最难的"沉默故障"） | 三层取值 + 与本机网卡核对，**漂移时自动回退**真实 IPv4 |
| 装了 ffmpeg，服务器说"未检测到" | 500ms 超时在"启动同时拉 Worker 子进程"的机器上必然超时，`err.killed` 被当成"没装" | 超时放宽 + 重试 + **只有 ENOENT 才算没装** |
| `npm run test:record` 稳定红 `EBUSY` | 不是文件锁，是 **Windows 上 Node 的 `spawnSync`** 与未排空的子进程 stdio 相冲（同文件在 shell 里 ffprobe 秒出结果） | 改异步 `execFile` + 三次重试 |

还有一条属于 AI 特有的错位：`@ai 生成纪要` 原本写在 Mock 分支里，**配上 key 之后
LLM 抢先回一句"好的我来总结"，纪要文件根本没生成**——用户看到的是"AI 答应了"。
修法是**动作型意图在进 LLM 之前先路由**（tools-first），聊天模型只负责聊天。

#### 5.28.6 回归与自查

```bash
npm run test:ai     # AI 双轨自检：无 key 只跑 Mock 轨，有 key 两条都跑（当前 10/10）
npm run ai:chat -- --q "一句话解释 SFU 与 Mesh 的区别"
npm run ai:summarize -- --room 123456    # 直接吃某房间的字幕账本出纪要
curl -s localhost:3001/metrics | grep sfu_ai_llm   # 调用次数/错误数/tokens/估算花费
```

**回归（2026-09-24 实测）**：冒烟 **118/118**（+11）+ 信令 **106/106**（Mock 轨、LLM 轨各跑一遍双绿）
+ Mesh **33/33** + test:ai **10/10** + test:record 连跑 3 次 PASS。
⚠️ 待人工验证：真浏览器打字机观感、真开会十分钟看纪要质量、AI 操作员走 LLM 计划的演示。

---

## 第 5.29 节 ★ 真 OS 级远程桌面：用 CDP 驱动一个真实浏览器窗口（09-24b · B 档）

> 前置：先看 **2.12 节**（H5 远程协助 = 网页控网页）和 **5.7 节**（SFU 版远程协助）。
> 这一节讲的是**另一种被控端**：被控的不是网页，而是被控电脑上一个**真实的 Chromium 窗口**。

### 5.29.1 先问：为什么网页自己做不到"真远程桌面"？

这是本节最重要的一个认知，也是面试常被追问的点。

> ▎**浏览器的安全底线**：网页里的 JS **没有权限**移动真实光标、敲真实键盘、
> 截别的程序的窗口。这是**设计如此**，不是技术不足——否则你随便打开一个网页，
> 它就能替你点"确认支付"、偷看你屏幕。
>
> 所以商业远程桌面（AnyDesk / 向日葵 / TeamViewer）**无一例外**都要在被控电脑上
> 装一个"被控端"（本地程序）。本项目把这一层做成**零新依赖**的 Node 程序 `agent/`。

**分层**（和第 2 章"信令 vs 媒体"同一种思路——每层只管一件事）：

| 层 | 文件 | 职责 | 它知道 WebRTC / socket.io 吗？ |
|---|---|---|---|
| 驱动真实浏览器 | `agent/cdp.js` | 启动 Chromium、抓屏、注入输入 | **完全不知道**（可单独测） |
| 接入会议 | `agent/index.js` | 连信令、进房、收授权、把画面发出去 | 知道（用 socket.io-client） |

**能力边界要诚实**：CDP 只控 **Chromium 窗口内部**，控不了开始菜单 / 记事本 / Excel
（那要 Win32 `SendInput` / macOS `CGEvent` 这类系统级 API）。所以它的定位是
**"远程浏览器工作区"**——但对"远程协助 / 演示 / 帮人操作"这个场景，浏览器已是 90% 的战场。

### 5.29.2 CDP 是什么？（它就是 F12 背后的那套协议）

**CDP = Chrome DevTools Protocol**。你按 F12 打开开发者工具，"点页面元素、看网络、
截屏"，本质就是在用这套协议。我们只是把同一套协议**握在自己手里**：

| 想做的事 | CDP 命令 | 备注 |
|---|---|---|
| 抓真实画面 | `Page.startScreencast` | 见下方"背压" |
| 真鼠标 | `Input.dispatchMouseEvent` | 移动/按下/抬起/双击/滚轮 |
| 真键盘 | `Input.dispatchKeyEvent` | 功能键、组合键 |
| 插入文本 | `Input.insertText` | 中文/emoji **绕开 IME** |
| 真导航 | `Page.navigate` | 能开任意真实网站 |
| 真窗口 | `Browser.setWindowBounds` | 最大化 = 立刻有"远程桌面"的感觉 |

**它是"协议"不是"库"**：Node 22 自带 `fetch` + `WebSocket`，零 npm 新依赖就能用。

### 5.29.3 抓屏为什么不用"定时截图"？—— screencast 的背压

新手最容易想到的写法是"每 100ms 截一张图发过去"。**这样写一定会出问题**：

- 页面没变化时也在截，纯浪费 CPU 和带宽；
- 一旦网络比截图慢，帧就在内存里堆积，延迟越滚越大（看的是"越来越旧的画面"）。

`Page.startScreencast` 天生解决了这两点：

1. **变化才推**：只有画面真的变了才产生一帧；
2. **自带背压（backpressure）**：每帧推给你之后，**你回一个 `screencastFrameAck` 它才推下一帧**。
   于是"消费速度"由接收端决定，天然不会堆积——这就是背压机制的价值。

> ▎背压一句话：**不靠"我发慢点"来防止堆积，而是靠"你确认了我再发"从机制上杜绝堆积。**
> 项目里同款思路还有：`remote-frame` 用 `volatile` 发（宁可丢帧不排队）、
> 控制端把收到的帧做成"**覆盖式缓冲**"（慢时只画最新一帧）。

此外，agent 侧还叠了两层"省流"：`--fps` 限帧率（超频直接丢）+ `--quality` 控 JPEG 质量。

### 5.29.4 输入注入：几个真实踩过的坑

把控制端的一条消息变成真实浏览器里的一个动作，是"真控"的最后一公里。
`agent/index.js` 的 `applyInput()` 里每个 `kind` 对应一个 CDP 动作，其中三个坑值得记：

1. **修饰键的位序不同，必须映射**：我们 16 字节帧里 flags 的位序是 `alt/ctrl/shift/meta`，
   而 CDP 掩码规定是 `Alt=1, Ctrl=2, Meta=4, Shift=8`——**顺序不一样**，直接抄就全错。
2. **双击要靠 `clickCount`**：Chrome 认"双击"不是靠时间间隔，而是靠事件里的 `clickCount=2`。
   所以要发两轮 down/up，第二轮带 `clickCount: 2`。
3. **组合键不能当文本插入**：`Ctrl+C` 里那个 `c` 如果走 `insertText`，会在页面上**真的打出一个 c**，
   而不是"复制"。带修饰键的可打印字符必须走 `rawKeyDown`（真实按键）——这是远程协助里
   "全选再复制"最常用的动作之一。

中文输入走 `Input.insertText` **整段落字**，完全绕开 IME 的 `composition` 过程——
这与 2.12.7 节"隐藏 IME 捕获框 + `compositionend` 整段发"是同一条经验的延续。

### 5.29.5 安全：三道闸门 + 一句话

`agent` 进房**没有任何特权**：它照样要 `remote-request → 授权卡 → remote-answer`，
和人类被控端**一字不差**（服务器只认 `remoteCtl` 里登记在册的控制关系）。在此之上还有三道闸门：

| 闸门 | 挡什么 | 怎么实现 |
|---|---|---|
| ① 身份闸 | 人冒充代理往画面通道灌数据 | 只有 `socket.isAgent` 才准发 `remote-frame` |
| ② 授权闸 | 代理把画面旁路给房间里的第三人围观 | 必须是登记在册的被控端，且 `to` 正好是那一位控制端 |
| ③ 体量闸 | "合法身份灌流量" | 单帧 >900KB 丢 + 120 帧/秒限流 + `volatile` 不排队 |

> ▎原则一句话：**信任 ≠ 免检查**。即使被控端自己起的是一个"可信程序"，
> 服务器也不给它超额权限——这就是**纵深防御（defense in depth）**的基本要求。

### 5.29.6 怎么验证（真东西才作数）

```bash
npm run test:agent     # 真起 Chromium：真授权 + 真收 JPEG 帧 + 真注入再回页面读坐标（16/16）
```

最严的一条断言是坐标：发归一化 (0.5, 0.5)，页面里的 `clientX` 必须**正好**是视口宽的一半
（±3px）。**这一条过了，才说明"手机 390 宽、电脑 1920 宽都能点准"**——实测
视口 1254×707，期望 (627,297) = 实际 (627,297)。

**面试自查**：你能讲清①为什么必须本地代理 ②screencast 的背压比轮询截图好在哪
③"信任≠免检查"是什么 ④CDP 的能力边界在哪吗？

---

## 第 5.30 节 ★ Pointer Events：一套逻辑同时伺候鼠标、手指和触控笔（09-24b）

### 5.30.1 那个真机抓到的 bug（先讲现象）

远程桌面控制台（`sfu/public/` 的全屏 `#rdConsole`）一开始是照远程协助的老办法写的：
监听鼠标事件，**再加一套触摸事件**。真机一测就露馅：

> ▎现象：**手机上一用双指，鼠标就乱点。** 想滚动页面，结果把页面上的东西拖走了。

**根因**：`pointerdown/move/up`（以及 `touchstart` 那一套）是**按手指派发**的——
双指就是**两套** pointer 事件。于是远端收到一串 `mousedown / mouseup`，
被控端以为你在"按住拖动"，而不是"双指滚动"。

### 5.30.2 为什么"双指 = 两只手各自点鼠标"会出 bug？

因为鼠标模型里**没有"两根手指"这个概念**。鼠标永远只有"一个指针"。
当你用触摸事件去模拟鼠标时，两根手指就变成了"两个互相打架的鼠标"：
- 第一根手指落下 → 发 `mousedown`（远端进入"按住"状态）；
- 第二根手指落下 → 又发一个 `mousedown`；
- 两指移动 → 各发各的 `mousemove`；
- 结果：远端被拖来拖去，或者一直卡在"按住"。

**而 Pointer Events 是浏览器提供的统一抽象**：鼠标、手指、触控笔**都用同一套
`pointerdown / pointermove / pointerup`**，每个事件带 `pointerId`（哪根手指）和
`pointerType`（是鼠标还是触摸）。于是我们**不再写两套代码**，只写一套，自己记账。

### 5.30.3 修法：自己维护一份"当前有几根手指"的账本

```js
const rdPointers = new Map();   // pointerId → { x, y }：当前压在画面上的手指/鼠标
let rdScrollMode = false;       // 双指滚动模式（此模式下一个鼠标事件都不发）
let rdScrollMid = null;         // 上一帧两指中点
let rdMouseDownSent = false;    // 我是否已经发出过 mousedown（用于"撤销"）
```

规则很简单，但每一步都有道理：

1. **单指 = 鼠标**（移动 / 点击 / 拖拽）——照旧；
2. **第 2 根手指落下 → 进入滚动模式，并"撤销"第 1 根手指已发出的 `mousedown`**：
   补发一个 `mouseup`，否则远端**一直处于"按住"状态**（这是最容易忘、也最要命的一步）；
3. **双指移动 → 用两指中点的位移换算滚轮**：中点往上滑 = 内容往上滚（跟手机习惯一致）；
   约 20px 手指位移 ≈ 滚轮一格；
4. **`pointerleave` 时补发最后一笔移动**：因为移动做了 33ms 节流（≈30fps 上限），
   落下的那笔要补上，否则远端光标"停在半路"。

为什么不节流不行？不节流时手指一动每秒能发几百条 `mousemove`，把信令通道塞满，
**反而让点击变卡**。"少发但发得准"比"多发"体验好——和 2.12.7 的 RTT 自适应节流同源。

### 5.30.4 真机实测 + 一条通用教训

> **实测**：手机双指滑动后**被控端页面真的滚了**（`scrollY 0 → 1000`）；
> 手机单指点击触发被控端真实按钮。真机双窗验证被控端真实 URL 变成 `https://example.com/`。

**通用教训**：能用一套 web 标准（Pointer Events）解决，就**不要写 mouse + touch 两套**。
两套代码 = 两套行为，而"鼠标那套和触摸那套不一致"的 bug 极难复现、极难自查。
选标准 = 少写一半代码 + 少一半不一致。这与 5.27 PWA 的"复用同一套信令、服务器零改动"是同一种取舍。

---

## 第 5.31 节 ★★ Service Worker 把旧代码喂给你：一个花了很久才定位的坑（09-24b · 坑 40）

> 这是本次**最有教学价值**的一条。它演示了一个所有做前端的人早晚会踩、
> 而**看代码看不出来**的陷阱：**缓存是一个"你看不见的副本"，它什么时候失效，必须由机制回答，不能靠人记着。**

### 5.31.1 现象（极其迷惑人）

改了 `sfu/public/client.js` / `style.css`，刷新页面**死活不生效**。奇怪的是：
- 服务器**明明**发了 `Cache-Control: no-store`；
- DevTools 的 Network 里也显示 **200**（不是 304）；
- 可页面跑的还是旧代码。

单纯看这三条，你完全想不到问题在哪——因为**这个缓存不在 HTTP 层**。

### 5.31.2 根因（两层，缺一不可）

**第一层：Service Worker 完全不看 HTTP 缓存头。**

上一版 `sfu/public/sw.js` 做了一件"看起来很合理"的事：把 `./client.js`、`./style.css`、
`./workbench.html` 一起**预热进 Cache Storage**，然后 **cache-first** 返回。
问题是——**Service Worker 有自己的缓存（Cache Storage），它拦截了请求之后，
HTTP 层的 `Cache-Control: no-store` 就被整层绕过了**。服务器说"别缓存"，
但 SW 说"我这儿有现成的，直接给你"，服务器的话根本传不到页面。

**第二层：SW 只在 `sw.js 自身字节变化` 时才重装。**

这是最阴的一点：
- 你天天改的是 `client.js`，`sw.js` **一动不动**；
- 浏览器看 `sw.js` 没变，就**不重装 SW**，那份"含旧 client.js 的缓存"就一直管着页面；
- 于是无论你刷新多少次、强刷多少次，拿到的都是**同一个旧副本**。

旧注释里写着"记得改完 bump 一下 `SW_CACHE_VERSION`"——**这恰恰是不该有的写法**：
它把"缓存何时失效"这件**机制问题**，交给了"人记得不记得"这件**纪律问题**。
**而纪律是会被忘掉的**（这次就忘了）。凡是"靠人记得"的缓存失效方案，等于没有失效方案。

### 5.31.3 修法：按资源性质分成两路（这才是对的模型）

不去纠结"要不要 bump 版本"，而是**问每一种资源：它到底会不会变？**

| 资源 | 会不会变 | 策略 | 为什么 |
|---|---|---|---|
| `vendor/socket.io.min.js`、`mediasoup-client.js`、图标、manifest | **基本不变** | **cache-first** | 又大又永不改，cache-first 既省流量又稳，"永不过期"这句是真的 |
| `client.js`、`style.css`、`index.html`、`workbench.html` | **天天变** | **network-first**（缓存只作断网兜底） | 在线时永远拿最新的 = **"改完刷新即见"** |

于是版本号的语义**自然变清楚**了：

> ▎改**业务代码**（client.js / style.css / 页面）→ **不用** bump 版本（network-first 保证最新）；
> ▎只有**新增或更换 vendor 里的文件**时，才需要 bump `SW_CACHE_VERSION`。

这条规则比"每次都记得 bump"可靠得多——因为它把**该不该失效**变成了"资源会不会变"的
客观判断，而不是主观记忆。缓存名从 `meeting-v1` 升到 `meeting-v2`，`activate` 时
自动清掉旧版本缓存（`v1 → v2` 这一步就是把那份含旧 client.js 的缓存整体清掉的）。

### 5.31.4 逃生舱 `?nosw=1`

调试时最想知道的往往是"这到底是不是缓存的锅"。所以 `client.js` 里埋了一个逃生舱：
地址加 `?nosw=1` 会**当场注销所有 Service Worker + 清空 Cache Storage 并自动重载**。
一步排除法：加了参数还是旧行为 → 不是缓存的锅；变成新行为 → 就是它。

### 5.31.5 测试侧的同一课：CDP 的缓存开关管不到 SW

这个坑还牵出一个**测试卫生**问题：
e2e 脚本原本复用持久化的浏览器 profile，并且以为"关掉 HTTP 缓存"就够了。
但——

> ▎**CDP 的 `Network.setCacheDisabled` 管不到 Service Worker 的 Cache Storage。**
> 于是测试测的是**缓存里的旧代码**，而不是你刚写的代码。数字全绿，但验的东西是错的。

修法：**每次运行前清空浏览器 profile 目录**。干净的 profile = 每次都是第一次访问 = 确定性。
（本项目已经栽过"测试对着旧实例跑出一片绿"，见 AGENTS 坑 31；这次是"测试对着旧缓存跑出一片绿"，同一个家族。）

### 5.31.6 最后是怎么定死是缓存的？—— 让页面自证版本

排查到最后靠的是一个朴素但有效的办法：**让页面自己去 `fetch('client.js')`，
把内容长度和一个特征字符串打出来**，作为"当前加载的是哪一版"的指纹：

```
✅ 页面侧 client.js 是当前版本（含 pointer 账本）指纹 = {"len":221772,"ptr":true,"cancel":true}
🔎 缓存/SW 状态 = {"caches":["hui-meeting-meeting-v2"],"sw":1}
```

指纹对得上 → 代码是对的；指纹对不上 → 先别改代码，去查缓存。
**方法论一句话：当"改了没生效"时，先让页面证明它加载的是哪一版，再谈改代码。**

### 5.31.7 举一反三：这和"发布副本漂移"是同一类病

本项目还有一个地方犯了**同一类错**：以前 `publish-mesh/` 是**手工拷贝**的，
根目录改了它不会跟着变——于是"发布的版本"和"在跑的版本"慢慢就不是一回事了。
病根都是：**存在一个副本，而它何时更新没有机制保证**。
解法也都一样：**让"更新"成为每次必跑的一步**（发布脚本每次清空重建；SW 改成 network-first）。

> 记住这句话：**任何缓存/副本，都要能回答"它什么时候失效"；答不出来，它迟早骗你。**

---

## 第 5.32 节 ★ 一键发布链路：构建 → 体检 → 隧道（09-24b）

```bash
node scripts/publish.js            # 只做 生成 + 体检（不启动任何东西）
node scripts/publish.js --tunnel   # 生成后尝试开隧道拿公网地址
node scripts/publish.js --bundle   # 生成时把依赖也拷进去（要上传云主机时用）
node scripts/publish.js --check    # 只读自检：发布包是否落后于源码（不同步则退出码 1）
node scripts/publish.js --port 8080
npm run publish:mesh               # == node scripts/publish.js
```

### 5.32.1 为什么"发布"要做成三段，而不是一个"启动脚本"

> ▎因为这件事里有**确定**的部分，也有**不确定**的部分。
> **构建**和**体检**是确定的（可以自动做、可以自动测）；**开隧道**依赖本机装了什么工具、
> 要不要登录，是不确定的。把不确定的那段做成**可选开关**，好处是：**一台什么隧道工具都没装的机器上，
> `node scripts/publish.js` 依然能跑完前两段并给出明确结论**——比"跑一半报错退出"有用得多。
> （本机就属于这种情况：没装 cloudflared / ngrok。）

### 5.32.2 第一段"生成"：为什么要**清空重建**，而不是"拷贝"

以前 `publish-mesh/` 是手工拷的（见 5.31.7）。**真正的解法不是"这次记得拷一下"，
而是让"发布"成为一个可重复执行、幂等的动作**：

- 每次发布前先跑一遍脚本，副本必然是最新的（**副本永不漂移**）；
- 发布目录里出现什么，由**白名单**决定（`COPY_LIST`：server.js + public/ 里 6 个文件），
  不会像 `cp -r .` 那样把 `.env`、`logs`、`recordings` 一起带上公网。

### 5.32.3 第二段"体检"：真的把它跑起来

"生成了文件"和"文件能用"是两件事。**只检查文件存在，等于没测**。所以脚本会：

- 用 `PORT=18081`（避开 3000/3001）真起一次发布包；
- HTTP 验证 `/config.json` **真的下发了含 TURN 的 ICE**；
- 验证首页、`client.js` 可访问，且静态资源带 `no-store`。

### 5.32.4 `--check` 的那个教科书级坑：**永真断言**

这里有个必须讲的错误示范——**作者自己先写错了**：
最早把"逐字节比对"直接写在 `build()` 的末尾。可 `build()` 一上来就把 `publish-mesh/` 删掉重建，
等比对时文件**当然一致**。于是这个自检是个**永真断言**：**先修复、再检查，永远不可能失败**。
更隐蔽的是：**它还会让针对它的测试也"通过"**——当时那条断言用的正则太松，
匹配到了成功信息里的"没有漂移"四个字。

修法两条，都要记：
1. **`--check` 必须只读**（不重建、不改任何文件），否则"先修再查"永远查不出问题；
2. **负向断言的正则不能太松**（别让"没有漂移"这种成功信息被当成"漂移"匹配到）。

`--check` 回答的是一个很实际的问题：**"你现在的发布包，和你现在的源码，是不是同一个版本？"**——
它给提交前 / CI 用，不同步就退出码 1。

### 5.32.5 第三段"隧道"：探测 cloudflared > ngrok

`--tunnel` 会依次探测常见隧道工具（谁在就用谁），都没有就打印**三条路**：

1. **Cloudflare Tunnel（最推荐：免费、免注册、一条命令）** → `https://xxx.trycloudflare.com`；
2. ngrok（要注册账号拿 authtoken，免费版地址每次都变）；
3. 部署到有公网 IP 的云主机（见《部署手册.md》场景 C）。

> ⚠️ **本项目最容易误解的一条**：**隧道只解决"网页能打开"，音视频是 P2P 的，
> 两台不同网络的电脑要真能开会，还得有 TURN。** 隧道把 HTTP 页面映射到了公网，
> 但 WebRTC 的媒体连接是浏览器之间自己去打洞/中继的，和这条 HTTP 隧道是两回事。

判断方法：开会后看页面顶部「🔗 连接方式」——显示"直连 / STUN"最好，显示"TURN 中继"说明走了中继（能通，但流量过 TURN 服务器）。

### 5.32.6 回归与实测

```bash
npm run test:publish   # 29/29：生成/体检/--check 过期闸 三段全覆盖
```

实测要点：发布包与源码逐字节一致、默认 ICE 含**带凭证**的 TURN（没有凭证的 TURN 一定连不通）、
`/config.json` 带 `no-store`、源码改动后 `--check` **必须报错退出**（且证明它只读、不重建）。

> ⚠️ **如实标注未验证项**：本机**没装** cloudflared / ngrok，所以 `--tunnel` 这条路只验证了
> "探测 + 给出指引"，**没有真正验证过成功开出一条隧道**。这一条留在人工验证清单里。

**面试自查**：你能讲清①为什么"清空重建"比"拷贝"可靠 ②`--check` 为什么必须只读
③"隧道 ≠ 媒体能通"吗？

---

## 第 5.33 节 ★ 账号从 JSON 文件搬到真数据库：node:sqlite 的零依赖路线（09-24）

> 前置：5.17 讲登录注册时，账号存在 `sfu/users.json` 里——那是**教学取舍**，为了讲清"哈希 + 盐"。
> 这一节回答一个很实际的问题：**什么时候该换数据库、以及在没有新依赖的前提下怎么换**。

### 5.33.1 为什么 JSON 文件迟早要换

`users.json` 的"数据库"其实是 `JSON.parse` 读全文件 + `writeFileSync` 覆盖写全文件：

1. **读放大**：每次登录都要把整个文件读出来解析一遍（69 个账号无感，6900 个就开始疼）；
2. **写风险**：写是**全量覆盖**——进程在写一半时崩掉，文件就废了；
3. **查询原始**：想"按 role 查有哪些管理员""某个账号最近干了什么"，只能自己遍历数组，越写越像在造轮子。

真产品到这一步一定会换数据库。但本项目有**零依赖铁律**（生产依赖只有 mediasoup + socket.io），
引 `better-sqlite3` 就等于破规矩——**这就是选 `node:sqlite` 的理由**：本机 Node（v22.22.2）内置，
**内置模块不算依赖**。代价是它带 `experimental` 标记（`sfu/store.js` 里只压掉这一条预期内的警告，
其余警告照常输出）。

### 5.33.2 三个设计点（面试会被追问）

**① 路径可配置**：`DB_FILE`（环境变量）> `config.json` 的 `dbFile` > 默认 `sfu/data/meeting.db`。
环境变量优先级最高，是为了让**测试脚本能在不改任何人配置文件的前提下把库指到临时目录**——这是
十二要素应用"配置放环境变量"的老规矩，也是 5.37 测试隔离的地基。

**② WAL 为什么必须开**：默认的 rollback journal 模式下**写会阻塞读、读也会阻塞写**；而本服务是
"一个 Node 进程，随时有人登录（读 users）、随时有人注册/审计（写）"。`PRAGMA journal_mode = WAL`
把写先追加到 `.wal` 文件，读的人看"主库 + wal 快照"，于是**读不挡写、写不挡读**——这正是一个常驻
服务器需要的并发模型。代价：多出 `meeting.db-wal` / `meeting.db-shm` 两个文件（`.gitignore` 用
`sfu/data/` 一并盖住）。

**③ 迁移为什么绝不能重新哈希**（这一条是"密码学自杀"级的）：
迁移只做"整表搬运"，**原样保留旧的 `salt` 和 `hash`**。因为服务器上**根本没有明文密码**——
`hash(pw, salt)` 里的 `pw` 从来不存在于服务器；唯一能让老密码继续验过的办法，就是保留原 salt/hash。
若想"迁移时顺手换成新参数重新哈希"，你没有输入可哈希，只能宣布**所有老账号密码全部失效**。
搬完把旧文件**改名** `users.json.imported-<日期>` 而**不是删除**——迁移永远有"搬了一半发现字段对不上"
的风险，保留原文件 = 保留退路（`test:store` 里专门断言了"保留原 salt/hash"和"旧文件被改名"）。

> 本次实况记一笔：迁移了 **69 个账号**，其中 **61 个是测试脚本历史遗留的垃圾账号**
> （形如 `a_XXXXXX`、显示名"爱丽丝"）——清理前把整库备份到 `sfu/data/backup-<时间戳>-before-cleanup.db`，
> 清理后**库里 9 个账号**；首个管理员是**本机第一个注册的账号**（名字不写进公开文档）（此前库里 0 个管理员，导致 `/dashboard`、`/metrics`
> 对所有人 401）。

### 5.33.3 口令方案要抽成"唯一实现"（一个真实踩过的坑）

这套口令方案原本在 `server.js` 里有一份、在 `scripts/admin.js` 里又被**照抄**了一份。两处只要
有一处改了（哪怕只是把 32 改成 64、或 hex 换成 base64），后果是**静默且致命的**：CLI 建出来的账号在
网页上**永远登不上**，而报错只会说"用户名或密码不对"——排查方向完全被带偏。

所以现在把方案收成一个模块 `sfu/password.js`（`scrypt(password, salt, 32) → hex`，盐为每账号独立
16 字节随机、hex 存库，校验用 `crypto.timingSafeEqual` 防计时侧信道），服务器与 CLI `require` 同一份。
**这是"用结构消除漂移"，而不是靠"记得同步修改"和一条测试兜着**——凡是"两处必须一模一样"的代码，
就应该只有一处。CLI 用法（`scripts/admin.js`，注意 `--` 用于透传参数）：

```bash
npm run admin:list                               # 列出账号 + 角色
npm run admin:grant   -- <用户名>                 # 提权 admin
npm run admin:revoke  -- <用户名>                 # 降权 user
npm run admin:adduser -- <用户名> [密码] [昵称]    # 新建账号（缺密码则随机生成并打印一次）
npm run admin:passwd  -- <用户名> [新密码]         # 重置密码（缺密码则随机生成并打印一次）
npm run admin:purge   -- [--yes] [--match <正则>]  # 清理测试垃圾账号（默认只干跑）
```

两个能讲的设计：`admin:purge` **默认只干跑（dry-run）**（删除不可逆，必须显式 `--yes` 才真删——
把"危险"变成一次主动表达，`kubectl --dry-run` / `terraform plan` 都是这个思路）；`deleteUser` 内置
**"拒绝删除库里唯一管理员"的安全闸**（删了就再也没人进得了观测面板，而密码是不可逆哈希、没有"找回"
这条路）。`admin:passwd` 本身也是必需品：没有它，一次忘记密码 = **永久锁死**——教学版没有邮件重置通道，
只能靠"能上这台机器的人"这条本地可信通道。

> **角色生效时机**：role 存在库里，但登录 token 里带的是"发 token 那一刻的角色"。所以提权后要让对方
> **重新登录**，新 token 才是 admin。这是取舍——换来 HTTP 门禁"**零数据库查询**"。

---

## 第 5.34 节 ★ HTTP 门禁的两类边界：为什么"能加"不等于"该加"（09-24）

> 这一节是本轮**最重要的修正**。它讲的不是"怎么加鉴权"，而是"**哪些接口不该加**"——
> 以及一个反直觉的结论：**给一个接口加鉴权，也可能是在制造 bug**。

### 5.34.1 起因：观测接口此前完全裸奔

`/api/rooms`、`/metrics`、`/api/recordings` 这些接口此前**没有任何鉴权**——任何人都能看到"哪个房间里有谁、
每路媒体跑了多少字节、谁在远程控制谁"。演示时没人管，但服务一旦挂公网，这就是一份免费的情报面板。
所以本轮加了 HTTP 层管理员门禁 `requireAdmin`。

### 5.34.2 但门禁不能"一刀切"——接口分两类

```
【甲类·观测】跨房间聚合 / 实时全景，知道它 = 掌握全局，且与"是否参会"无关：
  /api/rooms       房间×成员×媒体字节×控制权关系   → requireAdmin
  /metrics         上面那堆的 Prometheus 文本版      → requireAdmin
  /api/recordings  全服务器录像清单（跨房枚举）      → requireAdmin

【乙类·内容】单场会议的产物，按"是否在场"授权（进房成功才拿得到房间令牌）：
  /api/captions    字幕归档——client.js 自动 POST    → 有效房间令牌
  /api/minutes、/minutes/<房>/<文件>  纪要列表与正文  → 有效房间令牌（AI 气泡里点的链接带 ?roomToken=）
  /recordings/<文件名>  单个录像文件                  → admin 或 1 小时签名 URL（列表已拦，单文件靠签名）
```

### 5.34.3 为什么乙类不能加 admin 门禁（关键：会"静默失效"）

本产品**允许游客模式进会**（登录卡上的「游客进入」按钮），而 `/api/captions` 是浏览器端
`client.js` **自动**调用的（字幕内存溢出时归档 POST、导出/日报回读 GET）——**游客根本没有 token**。
如果给 `/api/captions` 加 `requireAdmin`，游客的字幕归档会**静默失效**：功能坏了，却只在控制台
留一行日志，**比直接报错更难发现**（这正是第一版误加门禁、复核时发现并回退的那条）。

**所以乙类的正解不是"拦所有人"（admin），也不是"不管"（裸奔），而是给"进了这场会的人"发一张凭证**——
本轮补上的**房间内令牌**（详见 5.38）就是它。关键在于：房间号本身**不是**好凭证——它只有 6 位、可枚举，
"知道房号"和"在场"并不等价；令牌由服务器在**进房那一刻**才签发、只发给**本人**，才真正等价于"在场"。

### 5.34.4 残余缺口已补：房间内令牌 + 录像短时效签名 URL（09-24）

上一版这里写的是"乙类保护的只是**弱能力**（6 位房间号可枚举、录像文件名含毫秒时间戳），
生产做法是 join 下发房间内令牌 + 录像短时效签名 URL——**本教学版没有实现**"。
**本轮已把它实现**，并保留了"不能加 admin 门禁"这个结论——只是把"凭证"从**可枚举的房间号**
换成了**只发给在场者的令牌**：

- **`/api/captions`、`/api/minutes`、`/minutes/<房>/<文件>.md`**：进房成功时给**本人**签发一张
  **无状态 HMAC 房间令牌**，接口校验它（`X-Room-Token` 头首选 / `?roomToken=` 兜底）；
- **`/recordings/<文件名>`**：改用 **admin 或 1 小时短时效签名 URL**。

原理、为什么用无状态令牌（而非内存 Map）、为什么令牌要存在 socket 上、以及**诚实边界**，
全部挪到 **5.38** 展开讲——这里只留结论一句话：**"能力 = 房间号"这条弱能力缺口已关闭。**

一个细节：`/dashboard` 面板页**本身不设门禁**——否则页面都打不开、用户看不到"去登录"的提示；
真正的门禁落在它调用的 `/api/rooms` 上。token 两种取法：`Authorization: Bearer <token>`（脚本 /
Prometheus 首选）或 `?token=<token>`（浏览器地址栏、`<video src>` 这类发不出自定义头的场景兜底；
**权衡**：查询串会进浏览器历史、访问日志、Referer，所以它只是兜底，能发头就发头）。

---

## 第 5.35 节 ★ 自签证书的 SAN 自愈：修"手机用不了"（09-24）

> 现象：局域网里另一台电脑或手机打开 `https://192.168.x.x:3443`，浏览器**不给"继续访问"**或一直转圈。

### 5.35.1 为什么"有证书"也可能连不上

浏览器**早就不看证书里的 CN（Common Name）了**（RFC 6125，各家 2017 年起执行）——自签证书必须带
**SAN**（subjectAltName），否则"名字对不上"。桌面浏览器还能点"继续访问"糊弄过去，**手机（尤其
iOS Safari）常常连这个入口都不给**。而且 SAN 里得包含"你**实际访问的那台机器的 IP**"：手机访问用的是
`https://192.168.x.x:3443`，SAN 里不写这个 IP，等于白加。

### 5.35.2 那个更隐蔽的坑：IP 变了，却永远不重签

本次实跑发现真问题：这台开发机 DHCP **换过三次 IP**，而证书是**旧 IP 在的时候**签的。
旧逻辑只问"证书有没有 SAN"——有，就沿用了。于是 SAN 里那个 IP 和手机当前访问的 IP 对不上，
而程序**永远不会重签**。

修法：把判据从"有没有 SAN"升级成**三种情况都重新生成**——
1. 证书文件缺失；
2. 证书**没有 SAN**；
3. 证书的 SAN **没覆盖当前局域网 IP**（IP 漂移）。

新证书把检测到的**所有本机 IPv4**（WLAN + 有线都在内）写进 SAN，并**保留旧证书里已有的 IP**
（换回旧网段也能用）。实测本机 SAN：

```
DNS:localhost, IP Address:127.0.0.1, IP Address:192.168.74.194, IP Address:192.168.116.194
```

### 5.35.3 怎么自查（一条只读命令）

```bash
node -e "const fs=require('fs');const c=new (require('crypto').X509Certificate)(fs.readFileSync('sfu/tls/dev-cert.pem'));console.log(c.subjectAltName)"
```

把打印出的 SAN 列表和 `ipconfig` 里的当前局域网 IP 对一眼：**当前 IP 不在 SAN 里就重启服务**
（会自动重签），急就先删 `sfu/tls/dev-cert.pem` 与 `dev-key.pem` 再启动强制重签。完整排查步骤见
《跨电脑连接-操作指南.md》第八节。

> 顺带一句：`announcedIp` 也有类似的漂移问题（配置里是旧私网 IP 时，服务器会**告警并自动改用真实
> 网卡 IP**）——它和证书 SAN 是"换网络后连不上"的两大根源，一个管 HTTPS 握手，一个管媒体候选。

---

## 第 5.36 节 ★ 优雅退出：按下 Ctrl+C 之后到底发生了什么（09-24）

> 这一节讲一个平时看不见、出事才致命的东西：**进程怎么退出**。

### 5.36.1 改造前：Ctrl+C = 进程暴毙

改造前，服务器**没有注册任何信号处理器**——`Ctrl+C` 等于进程直接暴毙，后果有三：

1. **孤儿进程**：mediasoup Worker 是独立的 C++ 子进程，父进程没了它会变**孤儿进程**，继续占着
   40000-49999 的 RTC 端口——下次启动可能撞端口、起不来；
2. **WAL 堆积**：`node:sqlite` 的 WAL 不做 checkpoint，`meeting.db-wal` 一直堆积（数据不丢，
   但文件越来越大，下次启动要重放）；
3. **录制损坏**：手头正在录制的 ffmpeg 被硬切，产物可能是个损坏文件。

### 5.36.2 现在的退出顺序（顺序本身就是设计）

```
收到 SIGINT / SIGTERM / 未捕获异常
  → 关所有 mediasoup Worker        （先断媒体）
  → 停收新连接（server.close）      （再停止接客）
  → store.closeDb() 做 WAL checkpoint（最后关库）
  → 正常退出
```

**为什么库必须最后关**：前面几步可能还在写审计日志，库先关了就会丢。两个保命设计：
**幂等**（连按两次 Ctrl+C，第二次直接放弃优雅、立刻退出）与**5 秒保险丝**（优雅流程最多 5 秒，
超时强制退出——真实系统里"退出卡死"比"退得不干净"更烦人，k8s 的 `terminationGracePeriod` 是同一思路）。

### 5.36.3 顺带修掉一处日志噪声

Worker 正常退出时，原来那条"崩溃补位"逻辑会把它当成 `❌ mediasoup Worker 挂了，5 秒后自动补位`——
演示时看到这行会以为程序崩了。现在用 `shuttingDown` 标志区分"主动关"与"意外挂"。

### 5.36.4 为什么加了自测钩子 `TEST_SHUTDOWN_AFTER_MS`

**Windows 上外部根本投递不了 SIGTERM**——Windows 没有 POSIX 信号，`process.kill(pid,'SIGTERM')` 走的是
`TerminateProcess`（等于直接暴毙），Git Bash 的 `timeout` 同理。所以"用 timeout 杀一下看日志"在这台
机器上**测不出任何东西**：它只能证明"进程会死"，证明不了"退得干净"。于是沿用项目既有的 `TEST_RECORD`
约定，加了环境变量钩子主动触发一次这条路径，`npm run test:shutdown` 才能真正断言它（9/9）。

---

## 第 5.37 节 ★ 测试隔离与"假通过"：别让测试污染真实数据（09-24）

> 5.29/5.32 已经讲过"假通过"的两种（永真断言、过松正则）。这一节补第三种，也是最"物理"的一种：
> **测试把开发者的真实数据改坏了**——它不会让断言变红，但会让你某天发现库里多了 61 个垃圾账号。

### 5.37.1 事故与根因

`sfu/users.json` 里我们发现了 **61 个垃圾账号**（形如 `a_XXXXXX`、显示名"爱丽丝"，从 09-13 一路累积到
09-24）——**根因是测试脚本直接往真实 `users.json` 注册账号**。测试确实"通过"了，但它顺手污染了
真实数据。这类问题的可怕之处在于：**测试永远绿**，你却要手工去清。

### 5.37.2 修法：用环境变量把数据"隔离"出去

所有涉及账号的测试，都用环境变量把库和旧文件指到**临时目录**，绝不碰真实数据：

```bash
DB_FILE=<临时目录>/test.db                    # 库指到临时文件
USERS_FILE_LEGACY=<临时目录>/users.json       # 旧账号文件也指到临时位置
```

`test:store` 里还有硬断言**自证**这一点：跑完后检查"真实 `sfu/users.json` 逐字节一致""`sfu/data/`
下没有被建库"——**测试自己证明自己没搞破坏**。这条纪律也顺带修了一个反直觉的顺序 bug：
注册限流原先写在**写库之后**，导致"被限流的请求其实已经落库了"——现在挪到**写库之前**。

### 5.37.3 顺带修掉的"视角掩盖"

`test-sfu-signaling.js` 的 `httpReq` 默认会带管理员 token，结果**所有 HTTP 断言都是在"管理员视角"下跑的**——
这会掩盖"游客视角"的回归（例如 5.34 里那条"游客无 token 也能归档字幕"）。修法是加一个 `noAuth` 开关，
专门用**无 token 身份**去跑内容类接口。教训：**测试如果总是以最强身份运行，就永远测不到"弱身份会不会被打回"**。

### 5.37.4 回归（2026-09-24 实测，全绿 = 440 项）

```bash
npm run test:store     #  49/49  账号存储层（迁移 / 改密换盐 / 删号安全闸 / 完整性）
npm run test:shutdown  #   9/9   优雅退出（关 Worker / 关库 checkpoint / 幂等 / 5s 保险丝）
npm run test:sfu       # 149/149 SFU 信令（含门禁边界 + 房间令牌断言：该拦的拦、跨房/篡改/过期一律 401）
npm test               #  36/36  Mesh 信令
npm run test:smoke     # 136/136 前端无头冒烟
npm run test:agent     #  16/16  桌面代理端到端
npm run test:publish   #  30/30  发布链（含 --check 过期闸）
npm run test:e2e       #  15/15  真浏览器端到端
```

**面试自查**：你能讲清①为什么迁移不能重新哈希 ②为什么内容类接口**不能**加 admin 门禁
③为什么"只判有没有 SAN"会导致证书永不重签 ④为什么关库必须放在退出流程的最后吗？

---

## 第 5.38 节 ★ 房间内令牌：把"房间号"这个弱能力换成"在场凭证"（09-24）

> 5.34 留了一个尾巴：内容类接口不能加 admin 门禁（会让游客的字幕归档静默失效），
> 但又确实裸奔在"能力 = 房间号"上——而房间号只有 6 位、可枚举。这一节讲本轮怎么把它补掉，
> 以及几个**反直觉的设计取舍**（为什么不用内存 Map、为什么令牌要挂在 socket 上、
> 为什么必须保留游客路径）。

### 5.38.1 问题：房间号是"弱能力"

`/api/captions`、`/api/minutes`、`/minutes/<6位房号>/<文件>.md` 原先只靠"知道房号就能读写"保护。
但 6 位房间号的取值空间只有 **10^6**，暴力枚举一遍是几秒钟的事——**知道房号就能读别人的会议字幕/纪要**。
这叫**弱能力**：能力本身可被猜出来，就等于没有能力。

**目标**：让"读写这场会的内容"这件事，只有**真正进过这场会的人**才做得到——
而这批人里**包含游客**（本产品允许游客进会，且字幕归档是 `client.js` 自动调用的）。

### 5.38.2 方案：无状态 HMAC 签名令牌

```
roomToken = base64url(JSON{room, iat, exp}) + "." + base64url(hmacSHA256(payloadB64, SECRET))
```

- **payload** 里带 `room`（哪场会）、`iat`/`exp`（签发/过期时间）；
- **签名**用服务器持有的 `SECRET` 对 payload 做 HMAC-SHA256；
- **校验**（`signRoomToken` / `verifyRoomToken`）：`timingSafeEqual` 比对签名 + 检查未过期 +
  **检查令牌里的 room 与请求的房间号一致（跨房必须 401）**；任何异常一律判 `false`（**fail-closed**）。

### 5.38.3 为什么是"无状态"而不是"内存 Map"（本节最关键的一个取舍）

最直觉的做法是：进房时生成一个随机串，存进服务器内存的 `Map<token, room>`，校验时查表。
**但这个教学产品有个特殊场景：过夜值守**——睡前开字幕挂一夜，服务器**中途重启**（房间是内存结构，
重启即没），而**归档是第二天早上才回读的**。如果令牌存在内存里，一重启 Map 就空了，
**过夜攒下的归档到了早上就读不出来了**。

无状态令牌不存任何东西——签名和有效期都在令牌字符串里，服务器只持有一把 `SECRET`。
**重启之后，之前签发的令牌依然有效**，因为校验只需要"用 SECRET 重算一次签名"。

- **`SECRET`**：32 字节随机 hex，持久化在 **`sfu/data/room-secret`**（该目录已在 `.gitignore`），
  首次运行自动生成、之后复用；**换掉它 = 所有已签发令牌立即失效**（见 5.38.6）。
- **TTL**：默认 **86400s（24 小时）**，配置 `config.json` 的 `roomTokenTtlSec`，
  环境变量 `ROOM_TOKEN_TTL_SEC` 优先级更高。

### 5.38.4 令牌发给谁、存在哪：两个"一失手就泄露"的点

**① 签发时机 = 进房成功时，发给"本人"。** `create-room` / `join-room` / `agent-hello` 的 ack，
以及该 socket 收到的 `room-members` 顶层字段里，都带上**它自己**的令牌。

**② 金牌规则：令牌存在 socket 上（`socket.roomToken`），绝不放进成员对象。**
如果图省事把 `roomToken` 塞进成员对象 `m`，那么任何"把成员列表广播出去"的代码（`room-members`、
`room-state`）都会**顺手把别人的令牌一起广播**——等于把别人的会议记录转发给了所有人。
所以本项目里：
- 令牌挂 `socket.roomToken`（跟着连接走，不跟着成员数据走）；
- `room-members` / `room-state` 的成员列表**都是显式投影**——一个字段一个字段地写
  （`{ id, name, ... }`），**不是 `{...m}` 展开**。显式投影的好处是：**成员对象上将来多一个字段，
  也绝不会"自动"漏进广播**，必须手动添加才行（安全默认值 = 默认不漏）；
- ★ 09-29 G6-②：投影里**新增了 `role` 字段**（owner/admin/member/guest 四级，`roleOf()` 判定）——
  这正是显式投影纪律的正面收益：加 role 是一次**有意识的决策**（角色不是隐私，可以广播），
  而令牌依然是"想都不用想就知道不能放"；
- `/api/rooms` 快照里同样没有令牌。

> 一句话：**"不会泄露"不靠"记得别放"，靠"结构上就放不进去"**。这和 5.33 里"口令单一实现"
> 是同一种思路——用结构消除隐患，而不是靠人记。

### 5.38.5 为什么令牌必须发给游客（否则又踩回 5.34 的坑）

有人会说：令牌这么敏感，只发给**登录用户**不就好了？——**不行**。
因为本产品允许**游客进会**，而字幕归档是 `client.js` **自动**调用的。如果令牌做成"需要登录"，
游客拿不到令牌 → 字幕归档 POST 401 → **游客功能又静默失效**（正是 5.34 那个坑，只是换了个地方复发）。
所以令牌在**进房成功**时不论身份**一律签发**——"在场"才是授权依据，"登录"不是。

（配套：`client.js` 存下 `myRoomToken`——`room-members` 时存、离房清空；三处 captions 请求带
`X-Room-Token` 头；AI 气泡的「📄 打开纪要」链接带 `?roomToken=`，因为 `<a href>` 导航发不出自定义头。）

### 5.38.6 门禁与逃逸开关

新增 `requireRoomAccess(req, res, room)`，**放行条件满足其一**即可：
① **管理员 token**（不受房间限制，用于跨房巡检）；② **该房间的有效房间令牌**。

- **令牌取法**：`X-Room-Token` 请求头（首选）/ `?roomToken=` 查询串兜底；
- **应用位置**：`/api/captions`（GET+POST）、`/api/minutes`、`/minutes/*`；
  **甲类没变**：`/api/rooms`、`/metrics`、`/api/recordings` 仍是 admin 门禁；
- **逃逸开关**：`config.json` 的 `roomTokenRequired`，默认 **`true`**（安全默认值）；
  设为 `false` 退回旧的"开放"行为，用于教学对比 / 本地调试。

### 5.38.7 录像：改成短时效签名 URL

`/recordings/<文件名>` 从"知道文件名就能下"改成 **admin 或短时效签名 URL**：
`signRecordingUrl(fileName, ttlMs=3600000)` → `/recordings/<文件名>?exp=<毫秒>&sig=<hmac(fileName + '|' + exp)>`，
默认 **1 小时**有效。录制停止的 ack 会回一个 `url`（签名链接），前端把它写进流程日志——
这样按下 ⏺ 的**非管理员也能拿到自己的产物**。

**明确区分 401 与 404**：401 = 没权限（没签名 / 签名错 / 过期）；404 = 签名过了但**文件不存在**。
（这条区分是有意为之：如果文件不存在也返回 401，排障时会误以为"是权限问题"。）

### 5.38.8 诚实边界（务必如实，不吹成完美方案）

- 令牌是 **Bearer 语义**：**谁拿到谁就能用**，**没有绑定成员身份 / IP**；
- **TTL 24h，期间令牌泄露即可用**（不是"一次一密"，也不是"随连接销毁"）；
- 录像签名 URL 同理，只是把窗口从"永久"缩到"1 小时"；
- 令牌与录像签名**共用同一把 `SECRET`**——数据格式不同、实际不会互相混淆，
  但严格说**少了 domain separation**（真产品会给不同用途派生不同的密钥）；
- `chmod 600` 在 **Windows 上不生效**（文件实际是 `-rw-r--r--`），Windows 需靠目录 ACL 保护；
- **换掉 `sfu/data/room-secret` 会让所有已签发的房间令牌与录像签名链接立即失效**——
  这是"轮换"的手段，也是轮换的代价。

### 5.38.9 测试与回归（2026-09-24 实测）

`npm run test:sfu` 由 **134/134 → 149/149**（净新增 15 条，另有 5 条既有断言按新语义改写）：
- 进房载荷带本人令牌 / 创建房间 ack 也带；
- **泄露检查三条**：`/api/rooms`、`room-state`、`room-members` 的 others 列表**都不含令牌**；
- 无令牌 → 401（captions、minutes、`/minutes/`、recordings **四处**）；带 `X-Room-Token` → 200；
  `?roomToken=` 兜底 → 200；
- **跨房令牌 → 401**、**签名篡改 → 401**、**payload 篡改（换房间号但沿用原签名）→ 401**、
  **过期令牌 → 401（实测，非恒真）**；
- **游客凭房间内令牌可归档并回读**（正向回归，证明没把游客路径打死）；
- 录像：签名有效但文件不存在 → **404**（区别于 401）、exp 过期 → 401、sig 改一字符 → 401、
  管理员不签名也过 → 404。

**合计 440 项全绿**：149 + 49 + 9 + 136 + 36 + 16 + 30 + 15 = **440**
（`test:agent` 16/16、`test:e2e` 15/15 未受影响）。

### 5.27 ★ 复盘与反思：这些升级教会我们的事（09-19~09-26 全程自省）

> 升级跑得越快，越需要停下来回答"哪些做对了、哪些是侥幸、哪些重来一次会怎么做"。
> 这一节是项目的自我审判——比"做成了什么"更接近学习的本质。

- **做对了的三件事**：
  ① **"协议层平等"先于"功能酷炫"**（C1）：AI 操作员最容易被做成"直接动 DOM 的作弊
     演示"，我们坚持让 AI 走真实授权卡+门禁+审计——短期多花了两天，长期换来
     "回放侧零改动 + 安全心虚感为零"的架构红利；
  ② **每一步都留"诚实标记"**（[Mock] 前缀/证据链/值守统计）：用户永远分得清
     "机器想的"和"模板拼的"、"实测过"和"纸面设计"——这是 AI 时代工程可信度的底线；
  ③ **回归先行于修复**：93→149 的信令断言里，超过一半的 bug（作用域/竞态/端序/
     死元素）是"先写断言再修"逼出来的——`node --check` 查不出作用域和时序错误，
     唯有真跑。
- **侥幸与补救**：
  ① announcedIp 漂移前后发生了三次（170→127→116→76），最初只打告警不改行为——
     后来才升级为"自动纠偏+重签证书"。反思：**配置漂移类的缺陷，告警不是修复**；
  ② 长跑内存问题（日志/聊天 DOM 无上限）直到真挂过一夜才暴露——教学项目最容易
     把"演示 5 分钟没问题"当成"7 小时没问题"，量级变了对错的定义就变了；
  ③ 多次踩"子串替换吞锚点"（bindIdentity 三空格缩进吃掉两空格匹配）——教训已固化：
     注入类改动必须 `node --check` + 全量回归，**编辑成功 ≠ 语义成功**。
- **如果重来**：账号存储一开始就该进 sqlite（users.json→迁移花了一整轮）；
  emoji 图标系统该在 F 档就立规范（后期全局替换波及 30+ 处）；
  style.css 的多轮"覆盖式美化"不如 09-14b 那次整份重写来得干净——**美学债和
  技术债一样，拖得越久利息越高**。

### 5.28 ★ 头像系统（apple-avatar 素材集 → 参会者的"脸"）

- **素材即设计**：`apple-avatar/` 是本项目的头像素材库——`random-set/` 九个
  中国传统色预设（青黛/朱砂/黛蓝/竹青/海棠/玄墨/黛紫/石青/墨竹）用于**注册自选**；
  `gufeng/png/` 的水墨苹果五态（idle/listening/thinking/speaking/happy）专用于
  **AI 助理动态头像**。命名规范：presets 用 key（av-01…）入库存档，名字映射放前端
  （服务端只验白名单不存名字——单一职责）。
- **数据链路**：users 表加 avatar 列（**幂等迁移**：PRAGMA table_info 检查后再
  ALTER——老库自动补列）；register 收 avatar（白名单外回落 null）→ login/verify
  原样带回 → bindIdentity 挂上 socket → room-state 显式投影加 avatar 字段
  （09-24 的"两份清单"纪律：加字段两处同改）。
- **AI 状态机（动态头像的核心）**：服务器在 ai-ask 的 thinking/speaking 节点广播
  `ai-state`（答案长度估时自动归位 idle）；C1 操作员收官广播 happy——**头像五态
  让 AI 的"存在感"第一次有了可看的实体**。前端双挂载点共用同一状态源：
  成员行 24px 小图 + 视频网格里的"AI 格子"（256px，speaking 金环呼吸、thinking
  浮动）——AI 从此是坐在网格里的参会者，不是聊天窗里的一行字。
- **与 09-25 语音系统的分工**：TTS 朗读（speakAiText）是既有系统；头像状态机只管
  "看"，朗读完本地自然回 idle，服务器按答案长度估时兜底归位——看与听各自闭环。
- **实修坑三连**：① store 迁移块插进了 SQL 模板串（锚点匹配到模板内部）；
  ② 成员行 innerHTML 重建冲掉 prepend 的头像 img（先加类、重建后补图的顺序才对）；
  ③ 冒烟桩 querySelector 自动造元素，"查询存在性"必须用自有条件不用 DOM 查询
  （坑 27 家族再+1）。
- **回归（本次实测）**：信令 **153/153**（头像全链路 4 断言 + G6 5 断言 + 短 TTL
  过期实测）+ 冒烟 **159/159**；真机：注册选头像→成员行显示 av-03、AI 格子
  idle→thinking→speaking 三态切换、TTS 并行朗读。

#### 5.28.1 ★ 09-26b AI 助理深化三连（矢量动画头像/逐字字幕/唤醒词「小明」）

- **头像 v2：静态 PNG 切换 → 内联 SVG 矢量小人**（素材：`apple-avatar/gufeng/handdraw/`
  丫髻童子，作者逐笔手绘的矢量版）。为什么它"生动"：①呼吸浮动/眨眼/摇头/发带摆动
  全是 CSS 关键帧，任意帧率平滑（PNG 切换是"换照片"，SVG 是"活物"）；②五态只切
  **眼形（睁/弯）与嘴形（笑/张/平）**的显隐，瞬时完成无跳变；③几 KB、无损缩放、
  改一个数值就能微调——作者在素材页里写的对比表（"AI 生成人物五官崩坏率 vs 逐笔
  控制"）本身就是很好的设计论证。工程形态：`aiAvatarSvg(st, cls)` 生成器，格子与
  成员行小头像共用同一函数（尺寸由 CSS 类裁剪）。
- **发言字幕逐字化**：speaking 帧现在**带全文**（server：`emit('ai-state', {state:'speaking', text: r.text})`），
  前端在 AI 格子上方的字幕条里**逐字打出**——标点带停顿（逗号 150ms/句号 320ms/
  普通字 55ms），模拟说话的呼吸。为什么不走流式 delta：Mock 轨没有流、LLM 流受
  网络节奏影响，本地逐字动画在两种轨道上表现完全一致（**确定性的"生动"**）。
  实修坑：ai-state 监听只解构了 state 没传 text——逐字条静默空白（"监听参数要与
  广播载荷同步演进"，又一个变体）。
- **唤醒词「小明」**：字幕成稿（emitCaption）里检测到名字 + AI 在场 → 自动把整句
  作为提问发给 ai-ask。挂客户端的原因：字幕在每端本地识别，谁嘴里说出"小明"谁
  触发——服务端音频管线没有转写，这是当前架构下最自然的挂点。改名只动
  `AI_NICKNAME` 常量 + server 的 bot 显示名。
- **断言语义演化**：09-25 的"ai-ask 只有一个发送点"断言被唤醒词打破——唤醒词是
  **合法的第二入口**（语义不同的触发方式），断言改为"恰好两处+sendAiQuestion 仍在"。
  教训：断言写"唯一性"之前先想清楚未来合法的第二入口。
- **回归（本次实测）**：信令 **154/154**（+1：speaking 帧带全文）+ 冒烟 **159/159**；
  真机：手动字幕喊"小明，介绍一下你自己"→ thinking（思考中…）→ speaking（正在
  发言…+字幕条逐字打出 RAG 检索后的诚实回答，检索不到就明说"没提到"而不编造）。

#### 5.28.2 ★ 09-26c/e 头像 v3→v4 与语音去 AI 味（两轮"还不够"的迭代复盘）

- **v3(精修 SVG 小人)的教训**：在"火柴童子"上加双眼皮/眉毛/发丝高光，方向对但
  **上限就在那里**——手绘矢量小人的"可爱度天花板"远低于一张精心生成的精美原画。
  用户连续两轮"还是不好看"教会的事：**美化到瓶颈时，换资产比继续雕参数有效**。
- **v4(最终版)的设计哲学转变**：**"一张好图 + 动效系统"**——底图用 meihua4 的
  国风双丸子头精美原画(一张图解决 90% 的美)，"生动"交给 CSS 动效分层：
  常驻呼吸缩放；speaking 时**声波条**(7 根错峰弹跳的竖条=声音可视化)+头像轻弹；
  thinking 暗化+💭 漂浮；happy 弹跳闪光。所有状态由格子 class 驱动，切换靠
  transition 过渡——**底图负责美，动效负责活**，这个组合才是"生动"的正解。
- **实修坑(SVG 尺寸链)**：`.ai-face-wrap`(grid 容器)里 `.ai-svg{width:100%}`
  在容器无显式高度时失控放大——**100% 需要每一层父级都有确定尺寸**，否则按内容
  或按视口乱猜。修法：容器给 78%/88% 显式值 + `svg{display:block}`。
- **语音去 AI 味三层**：① **音色选择策略**——Windows 的 `Online (Natural)` 神经
  音色与老式 SAPI 音色的差距就是"AI 味"与"真人味"的差距，按优先级数组匹配
  (Online Natural → 常见自然音色名 → Premium → 老音色兜底)；② **分句队列**——
  长答案按句末标点切段排队，句间 120ms 停顿+语调重新起势，接近真人节奏
  (新回答 cancel+清队列，"只说最新"语义不变；超时截止防句柄丢失无限念)；
  ③ 参数：rate 1.02/pitch 1.05。三者叠加，TTS 从"机器人念稿"到"基本能听"。
- **暖场系统(09-26d)**：AI 在场且 10 分钟无发言→主动说一句(有 key 用 LLM 按
  最近字幕生成邀请性发言，无 key 用模板)；`lastActivity` 由 chat-message 刷新；
  格子开关(ai-warm 信令)全房一致。**打扰边界**：默认开但可一键关——AI 主动
  说话是双刃剑，开关必须交给用户。

#### 5.28.3 ★ 09-26f "上档次"终版：空灵水墨仙童 + 瓷盘展陈

- v3(SVG 精修)与 v4 初版(可爱风)两轮都被否——复盘:**"可爱"与"上档次"是两条
  路线**,用户要的是后者。终版选 meihua2 的**空灵水墨仙童**(月轮/飘带/云雾/留白),
  与本产品"水墨丹青"主题同源——高级感来自**气质统一**,不来自元素堆砌。
- **呈现方式 = 瓷盘展陈**:深色格子中央一枚宣纸白圆盘(径向渐变纸色),画作内嵌
  其中,外圈鎏金双环细边,下方投影悬浮——像博物馆展柜里被灯光打亮的一件瓷器。
  底图放大 1.18 倍把右下 AI 水印裁出视野(object-position 聚焦脸部)。
- **实修小坑**:换底图后浏览器仍显示旧图(HTTP 缓存)——静态资源加 `?v=2`
  版本参数突破;**给会变的资源留版本参数位**是 SW 时代的基本卫生。

#### 5.28.4 ★ 09-26g 最终定稿：动画 webp 头像（用户三连否定后的正解）

- 三轮迭代（丫髻 SVG 小人 → meihua4 静态精美图+动效 → 空灵水墨仙童）都被
  "太丑/不是动态的"否定后，回头翻素材库发现 **ruishou/videos/crane-256.webp 本身
  就是 121 帧循环的动画 webp**（仙鹤水墨动画：圆月+墨线丹顶鹤+朱砂红顶）——
  **`<img src="*.webp">` 浏览器原生播放动画 webp**，零依赖、321KB、真"活物"。
- **教训（值得刻在脑子里）**：用户第一句话就说了"动态头像"，我却在"静态图+CSS
  动效"上迭代了三轮——**素材库先看全**（videos/ 目录就是答案），需求里的关键词
  （"动态"）不该被自己的方案惯性翻译掉。
- 状态机叠加在动画之上：thinking 泡泡/speaking 声波条+金环脉冲/happy 弹跳仍在
  （动画负责"活着"，状态叠加负责"表达"）；webp 帧内右下含水印 → 放大裁切
  （object-position 50% 42% + 118% 缩放）。

#### 5.28.4 ★ 09-26g 最终定稿：动画 webp 头像（用户三连否定后的正解）

- 三轮迭代（丫髻 SVG 小人 → meihua4 静态精美图+动效 → 空灵水墨仙童）都被
  "太丑/不是动态的"否定后，回头翻素材库发现 **ruishou/videos/crane-256.webp 本身
  就是 121 帧循环的动画 webp**（仙鹤水墨动画：圆月+墨线丹顶鹤+朱砂红顶）——
  **`<img src="*.webp">` 浏览器原生播放动画 webp**，零依赖、321KB、真"活物"。
- **教训（值得刻在脑子里）**：用户第一句话就说了"动态头像"，我却在"静态图+CSS
  动效"上迭代了三轮——**素材库先看全**（videos/ 目录就是答案），需求里的关键词
  （"动态"）不该被自己的方案惯性翻译掉。
- 状态机叠加在动画之上：thinking 泡泡/speaking 声波条+金环脉冲/happy 弹跳仍在
  （动画负责"活着"，状态叠加负责"表达"）；webp 帧内右下含水印 → 放大裁切
  （object-position 50% 42% + 118% 缩放）。

#### 5.29 ★ 09-27 服务端 ASR 字幕转写（AI 小明的"真实听觉"）+ AI 回答去 AI 味

- **用户点名的两件事一起解**："AI 味还是很重"+"开启那个字幕转写"。
- **AI 味的另一半真相**：TTS 音色之外，**回答文案本身的客套腔**（"好的""以下是"
  "根据会议记录""首先/其次"）同样是 AI 味。brain.js 的 system prompt 重写为
  **口语化人格**："像坐在旁边的同事随口回答——口语、短句、直接说结论，不要开场白，
  不要列举腔，一两句话说完"。**连带效应**：LLM 口语化后把"11 月 20 日"说成
  "11 月 20 号"，四处旧断言的精确匹配全部过时——断言演化为"语义等价匹配"
  （日/号均可、"没聊到"算如实）。**prompt 改动的连带影响必须全量回归才能看清**。
- **服务端 ASR（字幕转写）**：AI 听觉管线（PlainTransport→ffmpeg）此前只算响度；
  现在检测到 **whisper 命令行**（`pip install -U openai-whisper`）即切换为
  **分段转写模式**：每路音频 15s 一段 wav → whisper（tiny 模型、中文）→ 文本追加进
  字幕账本 jsonl（`source:'asr'`）→ **@ai 问答/RAG/纪要/唤醒词全部自动升级为
  真实会议内容驱动**（不再依赖客户端 Web Speech）。未装 whisper → 明确提示安装
  方式，功能静默关闭（客户端字幕不受影响）。隐私边界：音频不出本机（本地推理）。
- **工程事故与自救（本节最重要的一段）**：注入过程中工作区 `sfu/server.js`
  **两次被清空**（4574 行→0）——脚本异常路径 + 并发写手（并行会话）叠加。
  自救三步：`git checkout -- sfu/server.js` 恢复 → 注入脚本改**原子写**
  （临时文件 + os.replace，写前长度断言）→ **恢复后立即 commit 锁定**。
  教训：**多人/多会话共同编辑同一工作区时，"改完就提交"不是形式，是数据安全**。
- **回归（本次实测）**：信令 **154/154** + 冒烟 **159/159** + test:ai-brain **70/70**
  （含 LLM 轨口语化适配）。

#### 5.29 ★ 09-27 服务端 ASR 字幕转写（AI 小明的"真实听觉"）+ AI 回答去 AI 味

- **用户点名的两件事一起解**："AI 味还是很重"+"开启那个字幕转写"。
- **AI 味的另一半真相**：TTS 音色之外，**回答文案本身的客套腔**（"好的""以下是"
  "根据会议记录""首先/其次"）同样是 AI 味。brain.js 的 system prompt 重写为
  **口语化人格**："像坐在旁边的同事随口回答——口语、短句、直接说结论，不要开场白，
  不要列举腔，一两句话说完"。**连带效应**：LLM 口语化后把"11 月 20 日"说成
  "11 月 20 号"，四处旧断言的精确匹配全部过时——断言演化为"语义等价匹配"
  （日/号均可、"没聊到"算如实）。**prompt 改动的连带影响必须全量回归才能看清**。
- **服务端 ASR（字幕转写）**：AI 听觉管线（PlainTransport→ffmpeg）此前只算响度；
  现在检测到 **whisper 命令行**（`pip install -U openai-whisper`）即切换为
  **分段转写模式**：每路音频 15s 一段 wav → whisper（tiny 模型、中文）→ 文本追加进
  字幕账本 jsonl（`source:'asr'`）→ **@ai 问答/RAG/纪要/唤醒词全部自动升级为
  真实会议内容驱动**（不再依赖客户端 Web Speech）。未装 whisper → 明确提示安装
  方式，功能静默关闭（客户端字幕不受影响）。隐私边界：音频不出本机（本地推理）。
- **工程事故与自救（本节最重要的一段）**：注入过程中工作区 `sfu/server.js`
  **两次被清空**（4574 行→0）——脚本异常路径 + 并发写手（并行会话）叠加。
  自救三步：`git checkout -- sfu/server.js` 恢复 → 注入脚本改**原子写**
  （临时文件 + os.replace，写前长度断言）→ **恢复后立即 commit 锁定**。
  教训：**多人/多会话共同编辑同一工作区时，"改完就提交"不是形式，是数据安全**。
- **回归（本次实测）**：信令 **154/154** + 冒烟 **159/159** + test:ai-brain **70/70**
  （含 LLM 轨口语化适配）。

#### 5.29.1 ★ 09-27d 字幕降级重构：Web Speech 失败不再"动不动报错"

- **用户反馈**："字幕识别失败，动不动就报错"——根因：Web Speech 依赖浏览器厂商云端
  （Chrome/Edge 的 Google/Microsoft 语音服务），**国内网络不可达时每次开字幕都是
  一轮重试+报错循环**，而此时**服务端 whisper 转写明明已经可用**。
- **重构**：`network` 连败达阈值时不再只是报错关闭，而是**自动降级**：
  - `/config.json` 下发 `asrEnabled`（server 的 WHISPER_BIN 运行时状态）；
  - 服务端转写可用 → 徽标切"🖥️ 服务器转写模式"+ 一次性提示"邀请 🤖 AI 后正常
    说话即可上字幕"——用户完全不用碰字幕开关；
  - 不可用 → 保留原报错+"手动字幕"兜底指引。
- **架构意义**：字幕从"单源（客户端 ASR）"变为**双源自动降级**（客户端 Web Speech
  失败 → 服务端 whisper）——两条来源最终汇入同一个字幕条（asr-caption /
  type:caption），用户看到的体验一致。
- 冒烟补降级断言（160/160）；信令 154/154 不变。

#### 5.29.2 ★ 09-27d 降级阈值修正：第一次失败就切（不再"动不动报错"）

- 初版降级沿用了旧退避阈值（连败 12 次≈45 分钟）——用户实测"动不动就报错"：
  **降级路径存在但永远等不到**。修正：`serverAsrEnabled` 时 **network 第 1 次失败
  立即降级**（浏览器云端不可达是稳定状态，退避毫无意义）；不可用才保留退避。
- 教训：**降级路径的触发阈值要按"新路径的价值"定，不是沿用旧路径的容错参数**。
- 冒烟 fetch 桩同步支持 /config.json（返回 asrEnabled），降级路径 161/161 全覆盖。

#### 5.29.3 ★ 09-27e 降级时序修复：serverAsrEnabled 要在"开字幕之前"就位

- 用户三连"还是没改好"后的最终定位：降级逻辑本身没错，**错在降级依据的赋值时机**——
  `serverAsrEnabled` 只在 initSFU（进房）时拉取，而用户**在预览页/进房前就开字幕**，
  此时它还是 false → network 失败走旧退避 → 反复报错。
- **两层修复**：
  ① 页面加载即拉 /config.json（顶层 async，与 startLocalMedia 并行）；
  ② 双保险：network 失败时若从未拉过（`cap.asrChecked` 标志），**现场补拉一次**，
     拉到 asrEnabled=true 且字幕仍开着 → 徽标现场切"服务器转写模式"+提示。
- 教训：**降级依据的全局状态，必须在"任何可能触发降级的动作"之前就位**——
  拉取时机跟着初始化流程走（进房），就会漏掉"流程外"的触发点（字幕开关不进房也能开）。
- 冒烟 160/160（fetch 桩支持 /config.json 返回 asrEnabled，降级路径全覆盖）。

#### 5.30 ★ 09-28 服务端 ASR 成为唯一识别路径 + AI 多轮语音对话（"不要再用浏览器的了"）

- **用户诉求**：whisper 已经装好了（openai-whisper 20250625，tiny/small 模型已缓存），
  但**实际开会时字幕还是走浏览器识别**——"让 AI 参会能正常对话实现起来"。
- **根因（本次最有价值的发现，三段式）**：
  1. **探测命令在中文 Windows 上必然失败**：服务器用 `whisper --help` 判存活，
     而 whisper CLI 打印帮助文本时会撞上 **GBK 控制台的 UnicodeEncodeError →
     进程退出码 1** → 服务器认定"没装 whisper" → `asrEnabled=false` → 前端退回
     Web Speech。**装了却用不上**，正是用户看到的现象。
  2. **兜底候选写错了**：`__py__` 分支用 `process.execPath`（= node.exe）配 `-m whisper`
     ——把 node 当 python 用，永远不可能成功。
  3. **浏览器优先的旧契约**：就算探测成功，前端也只是"等 Web Speech 失败才降级"，
     而不是"能服务端就服务端"。用户说得很直白：不要再用浏览器的了。
- **修法一：抽成唯一实现层 `sfu/ai/asr.js`**（与 `password.js` 同一条教训——
  同一事实只能有一份实现，否则两边漂移）：
  · 所有 whisper 子进程带 `PYTHONIOENCODING=utf-8 / PYTHONUTF8=1`（编码是硬要求）；
  · 探测口径固定为"`--help` 退出码 0"（超时 25s，python 首次 import torch 要几秒）；
  · 候选：PATH 名 → pip --user 的 whisper.exe 全路径 → `python/python3/py -m whisper`；
  · **形态白名单**：只认"名叫 whisper 的可执行文件"或"python -m whisper"，防配置投毒；
  · 转写参数集中拼装：`--initial_prompt` 点名"用简体中文输出"（tiny 原本偶尔吐繁体，
    实测加提示词后稳定输出简体）；`--verbose False` 少写 stdout。
- **修法二：模型与分段的性能取舍（实测数据说话）**：同一段 4s 中文语音，
  **tiny = 4.2s（RTF≈1.05）**、**small = 10.8s（RTF≈2.7）**——默认模型从 small 改回
  **tiny**（会话延迟从 20s+ 降到 5~10s），要更准再用 `config.asrModel` 换回 small。
  分段从写死的 8s 改为可配（默认 **5s**），并用**信号量**把跨说话人的并发 whisper
  压到 `ASR_CONCURRENCY`（默认 2）——8 人同时开麦时不会把 CPU 打满拖垮媒体转发。
- **修法三：多人会议才会暴露的两个真缺陷**（都在分段录音分支里）：
  ① **目录冲突**：原来所有成员共用 `asr-<房间号>/seg-%04d.wav`——A 的 `seg-0003.wav`
     会被 B 的同名文件覆盖，两人同时说话时转写错乱/丢失。现在**按 memberId 分目录**；
  ② **读半截文件**：原来扫到"大小 ≥40000 字节"就转，而 ffmpeg 此刻可能正往最新那段写
     → 每句话的尾巴丢在未落盘的部分。现在**跳过最新那段**（它必然在写）+ 两次采样
     大小一致双保险；producerclose 后再**补转最后一段**，不丢最后一句话。
- **修法四：ASR 字幕必须走"入库唯一通道"**：服务端转写原先直接 `appendFileSync`，
  **绕过了 `feedBoard`** → 在"只用服务端转写"的会议里 AI 看板永远是空的。
  现在抽了 `ingestCaptions(room, entries)`：HTTP 归档与 ASR 转写共用它
  （落盘 + 喂看板），行为完全一致。
- **修法五：前端契约反转（服务端优先）**：
  · `toggleCaptions()` 现在先看 `asrEnabled`：**有 whisper → 服务端模式，绝不启动浏览器识别器**；
    没有才退回 Web Speech（旧逻辑与自检/退避原样保留，作为无 whisper 环境的兜底）；
  · 配置拉取改成**记忆化 promise**（`ensureAsrConfig`）+ 条件 await：配置已知则走
    同步快速路径（点击零延迟），只有"刚打开页面就点"才等一次——修掉"降级依据没就位"；
  · 服务端模式**自动邀请 AI**：AI 的音频管线就是服务端转写的"耳朵"，
    要字幕就把助理请进来（送走 AI 即停止转写）；关掉字幕只隐藏显示、不打断服务端；
  · **看门狗加模式闸门**：否则每 30s 会偷偷拉起一个 Web Speech 识别器（新契约白改）；
  · `asr-caption` 进本地历史账本但**不回传服务器**（服务器已落盘，防重复入库让统计翻倍），
    并单独记 `serverTotal`；
  · AI 说话时若语音开关没开，**一次性提示**可以开「AI 语音」听它说话（对话闭环的手感）。
- **修法六：AI 多轮对话（"对话"不是"命令"）**：唤醒后**追问窗口**默认 20s
  （`config.aiChatWindowSec`，0 = 关闭）——窗口内继续说话**不必再喊"小明"**，
  当成追问喂给同一会话记忆；每次接话顺延窗口，形成连续对话。唤醒词容错
  （小明/小鸣/小名/小铭——识别听岔也算）。字幕与提问都带**说话人昵称**
  （`memberDisplayName`），AI 才知道"是谁在说"。
- **顺带修一个"照文档做反而出事"的陷阱**：`config.example.json` 里带 `//` 注释，
  而 README 让人"复制改名"，可加载器是严格 `JSON.parse` → 注释让配置**静默失效**
  （服务器 catch 后按默认值跑）。新增 `sfu/jsonc.js`（字符串感知的注释剥离 + 尾逗号容错），
  服务器与 doctor 共用；`test:asr` 增加"模板可解析"断言。
- **可自动化验证的部分（本次实测）**：新增 `npm run test:asr` **15/15**——
  ① 探测必须成功（本条就是本次事故的回归断言）；② 用 Windows 系统 TTS 合成中文语音
  → whisper 真转写 → 断言认得出"小明"与关键词；③ 唤醒词容错 + 追问窗口纯逻辑；
  ④ 在线服务器 `asrEnabled` 必须为 true；⑤ 带注释的配置模板可解析。
  其它回归：信令 **154/154**、冒烟 **168/168**（+9：服务端字幕模式 9 条断言，
  浏览器路径用 `window.__SFU_ASR__` 显式覆盖来分别验证两条路）、doctor whisper 项 ✅。
- **必须人工在浏览器里验的（命令行验不了）**：两个 Chrome 窗口进同一房间 →
  点「字幕」→ 应显示"🖥️ 服务器转写（whisper）"且**不再出现浏览器识别的报错** →
  说一句"小明，帮我记一下明天下午三点开会" → 5~10s 内字幕条出现转写 →
  AI 回话（聊天气泡 + 若开了「AI 语音」则朗读）→ 紧接着**不喊名字**直接说
  "那后天呢"，应被当作追问继续回答（多轮窗口生效）。
- **教训**：① **"装了" ≠ "用上了"**——能力探测必须用一条在该平台上稳定成功的命令，
  并且探测结果要与"用户实际走的路径"绑在同一个开关上；② 与当初 mediasoup/pip 同源：
  **Windows + GBK 控制台**是这套技术栈里反复出现的"隐形杀手"，凡是会往 stdout 打
  非 ASCII 的子进程，一律先给它 UTF-8 环境；③ 测试要盯"能力开关"，不只盯功能函数——
  本次事故任何单测都不会红（函数都对），**红的是那条没人写的"探测必须成功"断言**。

---

## 第 5.39 节 ★ 设备码配对直连 + 真桌面画质档：一次"有边界地借鉴开源项目"（09-30b）

> 用户给的参照项目是 **`galaxy-s10/billd-desk`**（TypeScript + Electron + 硬件编码的开源远程桌面），
> 要求"学其可取之处，取长补短完善本项目，尤其是远程控制"。
> 这一节既讲**做了什么**，也讲**为什么没做另外一半**——后者才是"取长补短"真正的技术含量。

### 5.39.1 billd 身上值得取的三样，和不该取的两样

先读它的交互模型，得到一份"体验清单"：

| billd 的做法 | 本项目要不要 | 为什么 |
|---|---|---|
| **稳定设备码**：被控端启动即得一个码，主控端只输码就能连 | ✅ 取 | 本项目老用法要"先在网页建房 → 拿到房号 → 代理 `--room 房号` 加入"，**把被控端当成会议成员在用**，远程桌面的手感全丢了 |
| **连接口令 + 无人值守安全口令**两级 | ✅ 取 | 正是"临时授权"与"自己家电脑不用等人按确认"的真实需求分层 |
| **画质档**（流畅/标准/高清） | ✅ 取 | 09-30 早一点那轮只做了"闭环自适应帧率"，是**机器自己调**；用户想要**自己也能点** |
| **常用设备列表 / 设备持久化** | ⏸ 押后 | 要做就得落库、要处理改名与解绑，属于产品化第二轮（本项目红线：一次别铺太大） |
| **Electron 原生客户端 + 全 OS 控制**（开始菜单/记事本都能控） | ❌ 不取 | 浏览器安全模型不允许网页移动真实光标，所以商业方案**必须装客户端**；本项目已有的 `agent/`（手写 CDP）已经把"远程浏览器工作区"做到了，全 OS 要另写原生壳 |
| **H.264/H.265 硬件编码视频流** | ❌ 不取 | 需要原生编码器；本项目是 **零依赖红线**（`AGENTS.md` 第 3 节），CDP screencast 的 JPEG 逐帧虽糙但可用 |

**一句话方法论：借鉴开源项目先拆"交互模型"和"实现栈"两层——交互模型几乎总能取，实现栈大概率不能取。**

### 5.39.2 本节最重要的一个决策：设备码**就是**房号

新加"设备码"最容易写成"另一套独立的配对系统"——新的 Map、新的门禁、新的事件。
本项目的答案是**不新造**：

```js
// sfu/server.js：desk-register 里
rooms.set(deviceCode, {
  password: ..., members: new Set(), router: null, ownerId: socket.id,
  isDesk: true,            // ★ 只多这两个标记
  agentId: null,           //   代理进房后回填
  connectPassword, securePassword,
});
```

**设备码 = 一个私有 `isDesk` 房间的房号。**于是：

- `remote-frame` 的**三道闸门**（①`isAgent` 身份闸 ②`remoteCtl` 里那一对的授权闸 ③≤900KB + 120 帧/秒体量闸）
  一行没改就继续保护新的连接方式；
- 16 字节二进制帧的编解码、canvas 控制台、手机 Pointer Events 单指/双指**全部原样复用**；
- 授权链路（`remote-request` → `remote-answer` → 登记 → 广播 `remote-state`）本来就不认识"agent 特权"，
  所以它也**天然认识**设备码这条新路。

代价只有一个：控制端要能"进这个房"，但**绝不能把整套会议逻辑拖进来**
（订阅媒体、广播成员、建房主迁移……）。所以做了**轻量进房**：

```js
const deskEnterRoom = (roomNumber) => {
  socket.join(roomNumber);      // 收得到 io.to(房号) 的 remote-state 等广播
  room.members.add(socket);     // 让 isRoommate() 认得这对控制关系
  socket.roomNumber = roomNumber;
  // ★ 刻意不做的：不建 Transport、不订阅任何 Producer、不 broadcastRoomState
};
```

> **这就是"复用"的真实形状**：不是"调用同一个函数"，而是"让新概念长成老概念的数据形状"。
> 反过来讲，如果你发现新功能要改老门禁的判断条件，通常说明抽象选错了。

另外一条小设计：代理离线时桌面房**立刻销毁**（会议房是 60s 宽限，D+4）。
理由写在注释里——设备没人时留着码毫无意义，反而占号。

### 5.39.3 两条授权路径，但前端只听一个事件

```
路径①（无人值守）：口令 == securePassword
  → 服务器直接 remoteCtl.set(...) + 广播 remote-state + 发 desk-granted{unattended:true}

路径②（需人工确认）：口令 == connectPassword（或房没设连接密码）
  → 服务器把请求转给代理（remote-request，代理终端按 y/拒绝）
  → 给控制端发 desk-pending（"已发送请求，等对方确认"）
  → 代理确认后走**通用** remote-answer 处理器登记 + 广播
  → 该处理器结尾补一条：if (room.isDesk) io.to(控制端).emit('desk-granted', {unattended:false})
```

**为什么两条路都要发 `desk-granted`**：否则前端就得写"我刚才走的是哪条路"的分支判断——
那正是坑 47（一个概念只能有一个来源）在 UI 层的变体。现在前端只有一条开控制台的代码：

```js
socket.on('desk-granted', ({ hostId, hostName }) => openRemoteDesk(hostId, { name: hostName }));
```

⚠️ 还有一个**只在测试里才会踩到**的时序（`AGENTS.md` 坑 61）：
服务器是"**先 emit 事件、后 return ack**"，所以 `await request('desk-connect')` 一 resolve 就去断言
`resp.data.granted`，会读到 `undefined`——**代码没错，是断言站错了时间位置**。
断言前要等一拍（`await sleep(400)`），并且 `remote-state` 这类事件的监听器必须**先注册再触发**。

### 5.39.4 画质档为什么走 `remote-input`（老通道新语义）

前端点"高清"时发的是：

```js
socket.emit('remote-input', { to: rdHostId, event: { kind: 'quality', preset: 'hd' } });
```

**故意不发新事件**：`remote-input` 在服务器端已经有门禁（只允许在册控制端 → 被控端）
和二进制帧的垃圾包过滤。改指令语义而不改通道 = **白拿这两层保护**，
也让"AI 操作员 / 会议内控制 / 设备码直连"三条路径自动获得同一个能力。

代理侧的落地（`agent/index.js` → `applyQuality`）会同时改**三个**维度，而不只是帧率：

| 档 | JPEG 质量 | fps | 长边上限 | 适用 |
|---|---|---|---|---|
| `smooth` 流畅 | 30 | **6** | 1280×800 | 公网/手机热点，滚动和看视频不卡 |
| `standard` 标准 | 55 | 12 | 1600×1000 | 默认，一般宽带 |
| `hd` 高清 | 80 | 20 | 1920×1200 | 局域网，看细节/读小字 |

改完还要**重开抓屏**（`cdp.setScreencast()`：先 `Page.stopScreencast` 再带新参数 start）。
这里必须防一件事：重开时若再挂一次 `Page.screencastFrame` 监听器，就会**每帧多次 ack、多次回调**
——所以用 `_scListenerBound` 只绑一次。断言 ⑥e4 守的就是这条。

### 5.39.5 ★ 三层帧率分工：一个执行器不能有两个控制回路（本节最容易设计错的地方）

闭环自适应（`remote-quality` 回传 fps）比画质档**先存在**。两轮叠在一起，
两边都写同一个 `agent._frameGap` → 冲突长这样：

```
流畅档把 _frameGap 设成 5fps  →  客户端下一拍把建议顶回硬下限 RD_FPS_MIN=6
   表现："我明明选了流畅，帧率却没真降下去"，而且没有任何报错。
```

正解是**把"该用多少"和"再怎么乱来也不许超出"分成三层**，并让每一层只有一个写入方：

| 层 | 谁负责 | 取值 | 职责 |
|---|---|---|---|
| **策略层** | `RD_PRESETS` / `setRdPreset` | 定**中枢** `rdTargetFps`（6/12/20） | "正常该用多少" |
| **执行层** | `rdDecideFps` + `remote-quality` | 只在中枢附近 **±2**，区间 6~24 | 链路变差时微调 |
| **硬安全层** | 代理/服务器 `Math.max(2, Math.min(24, fps))` | **2~24** | "别人乱传也不许把对端拖垮" |

三条必须一起记住的约束：

1. **档位 fps 下限 == 自适应下限**（两处 `5→6` 同改）。区间不重叠，两个来源就会互相拉扯。
2. **切档时清空采样状态**（`rdIntervals.length = 0` / `rdLastFrameAt = 0`）。
   否则拿"切档前的旧节奏"当"新链路的状态"判断，会立刻误降一档。
3. **安全线不与策略线合并**。以后想加"3fps 超省流档"时，不该顺带放宽
   "别人能不能给我设成 0.1fps"——那是两问（同 `test-agent.js` ⑥b~⑥d 的分层注释）。

> 通用判据（`AGENTS.md` 坑 62）：**给某个状态新增一个写入方之前，先 grep 谁还在写它。**

### 5.39.6 测试侧三条教训（本轮红的三条全是我的测试写错，代码没错）

1. **ack 比事件后到**（坑 61，见 5.39.3）。
2. **测"变化才推帧"要制造真的会变色**的变化（坑 63）：
   第一版用 `document.title = "t" + Date.now()` 当触发器，帧数几乎不涨 → ⑥e3 红，
   症状和"重开 screencast 把链路搞断了"**一模一样**。根因是 CDP screencast 做**合成器级**变化检测，
   改标题不动一个像素。正解：`document.body.style.background = "hsl(...)"` 每 60ms 变一次。
   **断言"某机制还活着"之前，先确认你真的产生了它所依赖的那个条件。**
3. **冒烟里查 payload 要查整条、不要查内层 event**（坑 51 家族）：
   `rec.remoteInputPayloads.map(p => p.event).find(...)` 之后再读 `.to` 永远是 `undefined`——
   `to` 在**外层 payload**上，内层只有 `kind/preset`。

### 5.39.7 怎么用 + 回归 + 诚实边界

```bash
# 被控电脑（三种起步方式，从最简到最可控）
npm run agent                                                   # 设备码模式：启动即打印 6 位码
node agent/index.js --connect-password 1234                     # 主控端要输连接密码
node agent/index.js --code 888888 --secure-password s3cr3t      # 固定设备码 + 无人值守（不用按 y）

# 主控端（手机或另一台电脑的浏览器）
# 登录页 → 「🖥️ 用设备码远程控电脑」→ 输 6 位码 + 密码 → 连接 → 控制台全屏
```

- **自动化回归（2026-09-30 实测，本轮重跑 6 组 476 项全绿）**：
  信令 **184/184**（+19：设备码格式/设备不在线/错口令/`busy` 互斥/
  无人值守直授权/待确认→y 后开控制台/**口令错时绝不发 granted**/桌面房内房间码照旧受三道闸/
  释放后帧流全停/代理离线毁房）；
  冒烟 **189/189**（+11：入口按钮与 Overlay、设备码路径不复用会议内 `remote-request` 逻辑、
  切档发出 `{kind:'quality'}`、自适应只在策略区间取值、自动档开关、未知档名降级）；
  `test:agent` **24/24**（真 Chromium：切档改到帧率**和**编码参数、切档后仍持续推帧、
  无重复 ack、未知档不致命）；`test:e2e` **15/15**（真双窗 + 390×844 手机视口，
  页面自证 `client.js` 版本指纹）。
- **必须人工在浏览器里验的（命令行验不了）**：
  ① 设备码直连的完整手感（登录页入口 → 输码 → 控制台全屏，**全程不建房不进会议**）；
  ② 无人值守（`--secure-password`，秒连）与需确认（终端按 y）两条路径各走一遍；
  ③ 四颗画质按钮的**观感差**（流畅 vs 高清要肉眼看得出来）；
  ④ 弱网下"自动"档是否真的降档（可先用浏览器 DevTools 限流模拟）。
- **诚实边界（不要吹）**：
  ① 设备码**只存内存**——代理重启就换码，所以本项目现在**做不到** billd 的"常用设备列表"（那要持久化）；
  ② 连接/安全口令在服务器内存里**明文比较**（教学级；HTTPS 自签只是传输层兜底，不是存储层安全）；
  ③ 能力边界仍是 **CDP 只控 Chromium 窗口内部**（开始菜单/记事本控不了，见 5.29）；
  ④ 桌面房仍然吃同一份 `remoteCtl` 互斥——**一台设备同时只能被一个人控**，这是有意的。


## 第 5.40 节 ★ 语音双轨：AI 的"耳朵"与"嘴巴"为什么都放服务器上（09-29/09-30）

> 这一节把 09-29/09-30 两轮语音升级串成一个故事：**耳朵 = whisper 常驻 worker（ASR），
> 嘴巴 = Edge 神经语音（TTS）**，两条都遵守同一条项目纪律——"唯一实现层 + 探测双轨 +
> 失败自动回落"，外加一个对话礼仪问题：**用户开口，AI 必须闭嘴**。

### 5.40.1 耳朵：为什么 whisper 命令行"能跑"但"不能用"（09-29）

whisper 命令行每转一段音频都要**重启 Python + 重新加载模型**。本机实测：

| 方式 | 转写 4 秒语音 |
|---|---|
| CLI 每段（旧） | 10 ~ 14 秒（大半在加载模型） |
| 常驻 worker（新） | 第 1 次 13.4s（含加载），**之后 0.8 ~ 3.0s** |

服务端管线是"5 秒一段持续转写"——CLI 模式每段都白付一次启动钱，字幕越攒越慢，
这就是用户说"识别不灵敏"的最大单一根因。`sfu/ai/asr_worker.py` 是一个常驻 Python 进程，
stdin/stdout 走 JSONL（`{"id":7,"wav":"..."}` → `{"id":7,"text":"..."}`），模型只加载一次；
`asr.js` 的 `createResidentTranscriber()` 管生命周期（连崩 3 次自动回退 CLI 路径）。

**验证闭环**：`npm run test:asr-live` 用 ffmpeg 把 TTS 合成的语音以 RTP 推进真实听觉管线，
断言字幕账本出现转写——改管线代码不再只能靠真人开麦验证（TEST_RECORD 的同款思路）。

### 5.40.2 嘴巴：浏览器 TTS 的天花板与 Edge 神经语音（09-30c）

浏览器 `speechSynthesis` 读的是**用户机器上装了什么音色**——多数 Windows 只有老式
SAPI 音色（Huihui 一族），这就是"AI 味/难听"的来源。修法是把合成搬到服务器：
`sfu/ai/tts.js` 手写 Edge 神经语音（晓晓）的 WebSocket 协议，合成 MP3 下发给前端 `<audio>`。

**协议三步**（无官方 SDK，逆向自公开行为）：
1. 连 `wss://speech.platform.bing.com/...`，带 `Sec-MS-GEC` 防滥用令牌
   （= SHA256(按 300s 取整的 Windows 纪元 tick + 固定 token) 大写 hex）；
2. 发两条文本帧：`speech.config`（声明输出格式）→ `ssml`（音色/语速/文本）；
3. 收二进制帧（前 2 字节大端 = 头长，其后是 MP3 分片），`Path:turn.end` 收尾。

**双轨探测**（同 ASR 的老教训"装了 ≠ 用上了"）：端点可达性随网络出口 IP 而定
（本机经加速器实测四变体全 403）。服务器启动时探测一次（10 分钟重探），通过才在
`/config.json` 下发 `aiTtsEnabled:true`；不通过 → 前端自动回落浏览器 TTS。
**功能永不降级，状态永远可见**——启动日志明说走哪条路，doctor 的 A8 项同样体检它。

### 5.40.3 对话礼仪：用户开口，AI 闭嘴（抢话修复）

AI 回答是异步合成的，"用户说完唤醒词还在继续说"时 AI 声音会压上来。三层"让话"：

1. **即时闸**：会议中用 AnalyserNode 盯本地麦克风能量——峰值连续 8 帧（≈130ms）
   超阈 = 正在说话 → `speechSynthesis.cancel()` / `<audio>.pause()`。字幕要等 5 秒
   录音段+转写，靠它反应最慢 8 秒；本机能量是毫秒级信号；
2. **字幕闸**：新字幕（asr-caption）到达即 hush（排除 AI 自己的外放回声）；
3. **迟到不读**：回答送达时用户 2.5s 内刚说过话 → 这轮不念，文字照常进气泡。

### 5.40.4 一张表：语音链路所有"开关"与"回落"

| 能力 | 探测 | 启用条件 | 回落路径 | 观测 |
|---|---|---|---|---|
| 服务端转写（耳朵） | whisper `--help` 退出码 0 | asrEnabled=true | 浏览器 Web Speech | `/config.json` asrEnabled |
| 常驻 worker | `python -c "import whisper"` | 自动（起得来就用） | CLI 逐段转写 | `/metrics sfu_ai_asr_worker_enabled` |
| 神经语音（嘴巴） | 合成"你好"6s | aiTtsEnabled=true | 浏览器 speechSynthesis | `/metrics sfu_ai_tts_enabled` |

> **面试话术**："语音链路我做了三层回落设计——常驻 worker 崩了回 CLI，神经语音
> 不可达回浏览器 TTS，浏览器识别不可达回服务端字幕。每一层都有探测、有日志、
> 有指标，用户永远能听到声音，只是音色/延迟随环境浮动——**可用的下限比体验的上限更重要**。"

## 第 5.41 节 ★ 一次"AI 助理很怪"的排查全程：从五个症状回到一个根（2026-10-02）

> 这一节不是新功能介绍，而是**一次完整的排障记录**——面试里"你解决过最难的问题是什么"
> 最能打的回答，就是这种"症状很多、根只有一个、而且我是靠证据找到的"。
> 用户当时的原话是五句：**"一直收到重复的一句话"、"对话很混乱"、"延迟很大"、
> "后边它回答没有说话"、"刚刚都听不到声音"**。
> 如果按五句去改五处，一定会改错——它们其实是同一条链上的下游。

### 5.41.1 第一步不是改代码，是把"现场"翻出来

字幕账本是 append-only 的 jsonl（`sfu/captions/cap-<房间>-<日期>.jsonl`，第 30 步为过夜值守加的），
它忠实地记着那场会每一条字幕的文本与时间戳。把当天那份打出来看，规律一眼可见：

```
+4.0s  asr=True   请用简体中文输出。
+3.7s  asr=True   你好,小明。
+1.0s  asr=False  AI 小明：你好，我在。
+2.7s  asr=True   你好,小明。          ← 同一句又回来了
+3.0s  asr=True   请用简体中文输出。
...（每 2~4 秒一条，一模一样的句子刷了十几条）
```

**`请用简体中文输出。` 根本没人说过。** 那是 whisper 的 `--initial_prompt`
（"以下是普通话的会议对话，请用简体中文输出。"）——模型遇到**纯静音**没有内容可写，
就顺着提示词往下"续写"，把提示词的尾巴吐成了一句"转写结果"。

> 教训一：**"外部模型有输出"不等于"有内容"**。凡是拿第三方模型/API 的返回值当事实用，
> 都要先问一句"输入为空/无效时它会还我什么？"。它不会返回空，它会**编一个看起来很像输出的东西**。

### 5.41.2 为什么旧门槛挡不住：量错了那个量

管线里本来有一道"静音段不转写"的门槛：`if (size < 40000) 丢弃`。
听起来很合理，但它量的是**时长**——16k/单声道/16bit 的 wav，4 秒静音有 **128KB**，
远超 40000 字节，于是每一段静音都大摇大摆地进了模型。

正确的量是**能量**。修法是在 Node 里直接读 PCM 样本算峰值电平（`Asr.measureWavLevel()`）：
一次 64000 个样本的数组遍历，亚毫秒、零进程、零依赖；峰值低于 -45 dBFS 就删段，
**连模型都不叫**。实测纯静音 -99 dBFS、安静房间噪声 -60~-70、正常说话 -20~-10，阈值落在中间很安全。
并且它 **fail-open**：文件读不到、或 wav 不是预期的 PCM16 单声道，一律返回 `null` = "判断不了" → 照常转写。
**宁可漏过一次静音过滤，也绝不能把谁说的一句真话当静音删掉。**

### 5.41.3 一个源缺陷怎么长成三个体验灾难

```
静音段 → whisper 续写提示词 → 假字幕（每 2~4s 一条）
      ↓
假字幕落进 20 秒"追问窗口"（AI 答完之后的窗口内不必喊名字）
      ↓
每条假字幕都触发一次完整回答 → 应答风暴 + 账本被污染（纪要也跟着错）
      ↓
每条假字幕又把"最近有人在说话"的时间戳往前推
      ↓
浏览器朗读的"迟到不读"闸被永久关闭 → 用户看到的就是"它答应了却不说话"
```

所以下游补的三道闸（重复句闸、AI 回声闸、应答在途锁 + 最小间隔）都是**兜底**，
真正的修是**在源头断流**。上游干净了，下游的节流才不会变成"把功能调迟钝"。

> 教训二：症状的数量 ≠ 问题的数量。先找一条能同时解释所有症状的因果链，再动手。

### 5.41.4 "不出声"另有两条**真死锁**（跟幻觉无关）

这条链值得单独记，因为它是所有"双轨/降级"系统都会犯的错：

```js
function speakAiText(text) {
  if (aiTtsEnabled) return;      // 服务端神经语音可用 → 浏览器让位（防两个声音抢读）
  ...用 speechSynthesis 念...
}
socket.on('ai-tts-fail', ({ ts }) => speakAiText(pendingServerTts.get(ts)));  // ← 回落
```

服务器说"这条答案我会送音频"（`tts:'server'`）→ 浏览器让位不念 → 结果合成失败，
服务器补发 `ai-tts-fail` 请浏览器**回落朗读** → 浏览器调的还是同一个 `speakAiText` →
**被同一道让位闸挡回去** → MP3 没来、浏览器也不念 = **永久静音，零报错**。

再加一半：`aiTtsEnabled` 只在进房时从 `/config.json` 读一次就终身缓存，
而端点可达性是**会漂的**（Edge 的 403 随网络出口变化）——一次性快照必然失真。

三件修：① 让位闸加例外口 `speakAiText(text, { force: true })`，只有"确认服务端这条已失败"能绕；
② 状态漂移要**广播**（服务器定期重探 + 翻转时 `io.emit('ai-tts-state')`）；
③ 客户端连吃两次失败就本地临时停用服务端轨 5 分钟（自愈，不必等服务器重探）。

> 教训三：**写"降级/让位"条件时，要顺带检查"降级路径自己是否也被同一个条件挡住了"**；
> **凡是缓存下来的能力开关，都必须有一条失效或翻转时重新下发的通路。**

### 5.41.5 延迟不靠感觉：量出来才发现"好声音"是最大瓶颈

用 `npm run verify:voice`（本轮新增）实测同一次提问：

| 环节 | 实测 |
|---|---|
| 提问 → 答案首字上屏 | 2.8s |
| 提问 → 答案整段完成 | 3.0s |
| 答案上屏 → **本地 Qwen3-TTS 首句音频** | **44.1s** |
| 答案上屏 → 服务器判定"发不出音频"并通知回落 | **0.0s** |

也就是说：文字 3 秒就好了，声音要等 47 秒——用户那句"后边它回答没有说话"
**根本不是 bug，是 CPU 上跑神经音色的必然代价**。
据此把默认策略改成：**实时播报走浏览器朗读（即时）**，本地神经音色降级为显式开关
（`config.aiTtsLocalWait` / `AI_TTS_LOCAL_WAIT=1`），并把整段答案改成**按句流水线**
（`splitForTts` 最多 3 段，合成完一段立刻广播一段）。
判据 `serverVoiceReady()` **只写一处**，`tts:` 标记 / `/config.json` 的 `aiTtsEnabled` /
预热后的 `ai-tts-state` 广播三处共用它——原先各判各的，就会造出"页面让位、服务器不发"的两头静音。

> 教训四：**先问"用户感知的慢是被哪个量决定的"**，再决定优化哪一环。
> 这一轮如果不量，很可能会去优化 ASR（其实只占 2~3 秒），而真正等 44 秒的是 TTS。

### 5.41.6 顺手抓到的两个"假绿"（我自己写的）

- **换进程推流 = 换 UDP 源端口 = comedia transport 不再收包。**
  给"重复句"补测试时，第二次用**新的 ffmpeg 进程**往同一个 PlainTransport 推流，断言"账本新增 0 条"——
  通过了，但 `comedia: true` 只认**第一个发包者的 addr:port**，第二个进程的包整批被丢。
  音频根本没进系统，"没有重复字幕"当然成立。
  正解：所有需要多段音频的断言改成**一条拼接好的 wav、一个进程、一次推流**（说→停 6s→再说→停 3s）。
- **探测超时被当成"没装"，而且失败也打成功日志。**
  `import qwen_asr` 冷启动实测 **21.7s**、`import qwen_tts` **18.4s**（torch 一族），
  而三个模块的探测都写死 `timeout: 15000` + "报错即没装" → 机器一冷就误判、本地引擎悄悄不启用；
  更糟的是 `warm()` 恒返回 `undefined`，调用方 `.then()` 里无条件打印"🔥 已预热"。
  修法：收口成 `sfu/ai/pyprobe.js`（区分 enoent / ModuleNotFound / timeout，超时重试一趟长预算），
  并让 `warm()` 返回真实结果——**没人会去怀疑一行自己打的 🔥**。

> 教训五（`AGENTS.md` 坑 57/65/67 是同一条）：**假绿比假红危险得多**。
> 断言"某个量为 0"之前，先证明"输入真的进去了"；断言"某机制还活着"之前，先证明"你真的触发了它"。

### 5.41.7 头像"重影"：素材与 CSS 各演一套节奏

用户说"AI 助理头像有重影，而且一直重复一个动作"。抽帧看素材（`ffmpeg -i xiaoming-anim.webp f%02d.png`）：
第 41 帧头部与肩部有一圈**半透明偏移残影**——那是 AI 生成动画**烘进帧里**的交叉淡化痕迹；
而 CSS 又在这张"本来就在动"的图上叠了一层缩放呼吸 → 两套节奏同时演，看着就是重影 + 发抖。
"一直重复一个动作"则是循环素材的本性：它不可能看场合变招。

修法是**把形象与动作彻底分开**：形象 = 一张干净静帧（取循环的起始帧，行与格共用同一张，坑 47）；
动作 = 纯 CSS 关键帧 + JS 调度器，**每个元素同一时刻只允许一条动画**
（常驻呼吸在 `.ai-face`，状态律动与小动作互斥由 `armAiGestures()` 保证）；
idle/listening 每 7~14 秒随机演**一次性**小动作（点头/侧头/左看/右看/轻晃/深呼吸），演完摘类。
顺带修了圆盘尺寸：视频格是"扁的"（实测 403×227），旧写法按宽度取 `min(76%,320px)` 会顶天
（实测顶部留白 -3px、压名牌 -49px）→ 改**按高度**定尺寸。

> 教训六：跨文件的问题只在其中一个文件里断言 = 没断言。
> 本轮第一次让测试读 `style.css`（冒烟里新增 `cssSrc`），因为坑 26 那种 CSS 事故过去无人值守。

### 5.41.8 从 Piik 取的四条长（以及为什么是这四条）

先纠正一个前提：Piik **不是 AI 会议产品**，它是"给朋友的私有屏幕共享"（piik.tv，Go + Vite，MIT），
文档里没有任何转写/纪要/AI 字样。所以能取的不是"AI 能力"，而是**观众侧控制**的手感：

| 取来的东西 | 我们的落点 | 关键判断 |
|---|---|---|
| 每路独立音量 + 最高 200% 增强 | `client.js` 第 26 步音量控件 | **安全分层**：0~100% 走 `video.volume`（零风险），>100% 才挂 WebAudio `GainNode` 且此时必须把元素静音（否则双重回声）；增强不可用**回落 100% 而不是静音** |
| 观众只管自己那幅画面 | 新信令 `set-consumer-paused` | 前端 `display:none` **不省带宽**（包还在收），只有服务器 `consumer.pause()` 才真的停转发；权限按 `socket.consumers` 天然隔离，结构上关不掉别人的画面 |
| 点某个人的"沙发"只对 ta 回应 | react 消息加 `to` | mediasoup 数据通道是**广播**语义，"发给某人"只能靠定向头 + 应用层过滤（与 F5 批注同一套）；**定向 ≠ 隐私**，这条边界必须写在注释里 |
| 连不上时说人话 | 第 34 步 ICE 预检 | 把坑 36 那种"沉默故障"变成一句可执行的提示（relay/打洞/只有内网/UDP 被堵四档），并诚实说明它只测"本机到 ICE 服务器"，不代表与会议服务器一定通 |

> 教训七：借鉴开源项目时，**先纠正前提，再逐条判定"已有 / 部分有 / 真缺"**，
> 最后只挑不违背本项目红线的做（我们红线是零新依赖，所以它"浏览器编码一次 + 原进程重分发"
> 那套明确不学——那需要原生媒体进程，而我们的 mediasoup SFU 已是更简单正确的解）。

### 5.41.9 本节一句话总结（面试可直接用）

> "五个症状听起来像五个 bug，我先把字幕账本翻出来看时间戳，发现重复的句子是 whisper 在
> 静音段把提示词续写成了结果——旧门槛量的是时长不是能量。修完源头，我又发现'不出声'其实是
> 双轨让位闸把降级路径一起挡死了。全程我都用真音频推真管线来验，也顺手抓到自己写的两个假绿。
> 最后延迟的数字告诉我：慢的不是识别，是 CPU 上跑神经音色——所以默认让浏览器念，好声音做成开关。"

### 5.42 2026-10-02g：AI「不说话」查了三遍才查到的第三条死锁（外加界面在撒谎）

> 本节的价值不在功能，在**排查顺序**：同一个症状（"它答应了却没声音"）在这个项目里
> 前后有**三条互相独立的死锁**，前两条修完症状仍然在。教学点是——
> **"修完还在"不等于"修错了"，也可能是"这个症状本来就有多个原因"。**

#### 5.42.1 先问"用户凭什么这么说"，再问"真是这样吗"

用户第二轮反馈的原话是「**调用的还是 whisper**，延迟还是很慢」。去查配置：
`sfu/config.json` 里 `asrEngine` 早就是 `qwen-local`；跑 `test:asr-live`，日志里明明白白：

```
🤖 [ASR/qwen-local] 自测说话人（转写 1.4s）：小明。
🤖 [ASR/qwen-local] 自测说话人（转写 2.4s）：帮我记一下明天下午三点的评审会。
```

**引擎真的切过去了。**那用户为什么确信没有？因为他只能看见界面上那行字，而那行字是硬编码的：

| 位置 | 当时显示的内容 |
|---|---|
| 字幕状态徽标 | `🖥️ 服务器转写（whisper）` |
| 开字幕 toast | `…（本机 whisper，不依赖浏览器识别）` |
| 流程日志 | `…由本机 whisper 识别后上字幕…` |
| 服务器启动行 | `🎙 服务端转写已开启：<whisper.exe 路径>（模型 small…）` |

> ▎**教训：一条过期的 UI 声明，比一条缺失的声明更糟。**缺失只是没信息，
> 过期是**反向信息**——它会让人花时间去装已经装好的东西。
> 判据：**凡是界面/日志里"某能力是谁"这类句子，必须来自同一个运行时判据，不许写死**
> （本项目已经收口成 `/config.json` 下发 `asrEngine` + 前端 `asrEngineCn()` 一处翻译）。

#### 5.42.2 第三条死锁：闸门开的是"时间窗"，而答案总是落在自己开的窗里

前两条死锁（让位闸挡死回落、`aiTtsEnabled` 只读一次）记在 5.41。第三条在这里：

```
用户说完话
  → 服务器转写完成，把字幕推给页面           ← asr-caption 到达
  → 页面执行 hushAiSpeech()（礼仪：有人开口我就让）
      → 顺手开一个 serverTtsIgnoreUntil = now + 8000   ← ★ 元凶
  → 1.5~6 秒后，这条提问的**答案**音频到达
      → 落在自己刚开的 8 秒窗里 → 丢弃
      → 且顺手 pendingServerTts.delete(ts) → 浏览器回落账也没了
  = 服务端没声音、浏览器也不念，而且**一行报错都没有**
```

关键在于**时序是稳定的**：字幕总是先到、答案总是后到，所以这不是偶发抖动，是**每轮必撞**。
修法不是把窗口调短（那只是把误杀概率降低），而是换判据：

```js
// 拉黑「被打断的那一轮」的 ts；新一轮的答案是新 ts，天然放行
if (typeof serverTtsPlayingTs === 'number') serverTtsDropped.add(serverTtsPlayingTs);
for (const q of serverTtsQueue) if (typeof q.ts === 'number') serverTtsDropped.add(q.ts);
...
const interrupted = (typeof ts === 'number')
  ? serverTtsDropped.has(ts)          // 认人
  : Date.now() < serverTtsIgnoreUntil; // 没带 ts 才兜底认时间
```

> ▎**为什么用 ts 而不是时间窗**：① 语义正确——"这一轮别念了"指的是**那一轮**，
> 不是"接下来 8 秒内的任何东西"；② **不依赖两端时钟对齐**（服务器 `Date.now()`
> 与浏览器 `Date.now()` 跨机时可能差几百毫秒到几秒，时间窗判据在跨机部署下必然漂）。

浏览器那一轨（`speechSynthesis`）是同一个错误的更隐蔽版本：抢话闸写的是
"**2.5 秒内到过字幕** = 用户还在说话"。但**"字幕刚到"证明的是 1~3 秒前有人在说话**
（分段 + 转写的固有滞后），而答案恰恰紧跟在自己的字幕后面 → 每轮都被判成"还在说" →
"我要的是不乱说话，不是不说话"。改判据为**以麦克风即时信号为主**（AnalyserNode，
连续 8 帧 ≈130ms 就能确认此刻是否在出声），字幕窗只在"根本没有麦克风可量"时兜底。

#### 5.42.3 两个我自己写出来、被真浏览器抓走的坑（坑 68）

**① 读了一个"会被别人清空"的缓冲区。**给流式答案做"按句朗读"时写成
`speakStreamPart(box, box.buf)`。函数逻辑对、调用点接上了、语法过了——
但 `box.buf` 是 DOM 增量渲染的**攒批缓冲**，`applyStreamBuf()` 每帧
`textContent += box.buf` 之后就 `box.buf = ''`。于是朗读侧永远只看到
"一帧内的三五个字"，三五个字里不可能出现句末标点，切句永远切不出东西：
**通路静默空转，症状和"功能没做"一模一样**。正解是加一份不被消费的全文副本 `box.rawAll`。

> ▎通用判据：**写下"读 X 的当前值"之前，先 grep 谁还在写 X、谁会把它清空。**
> 一个变量有两个读者、而两个读者对它的生命周期假设不同，就一定会出事。

**② `cancel()` 只让旧句子"听不见"，不让它"不再回调"。**被取消的那句会**迟到地**
触发 `onerror`；如果此时新一轮的句子已经 push 进队列，旧回调里的
`aiSpeakQueue.length = 0` 就把新答案的上一句整个倒空——症状是
"**第一轮问候语念完之后，AI 就再也不出声了**"。修法是两件事一起做：
顺序改成 **cancel → 清队列/断泵 → 再 push**，并给泵一个代号 `aiSpeakGen`，
旧闭包发现代号不对就静默退出。

> ▎通用判据：**取消一个异步操作时，要连带取消它回调的所有权**（令牌 / 代号 / epoch 都行）。

#### 5.42.4 这次是怎么"直接测试"的（可复用的取证手法）

命令行验不了浏览器 TTS，所以在真浏览器里**让页面自己作证**——三招都值得记：

1. **猴补丁数调用**：`speechSynthesis.speak` 是可写的，包一层把每次调用的时刻与文本记下来，
   就有了"它到底念没念"的硬证据（`speechSynthesis.speaking` 只能看瞬时状态）。
2. **模块级函数在浏览器里是 `window` 上的属性**（classic script 的顶层 `function`），
   所以 `window.enqueueAiSpeech = wrap(...)` 能给内部逻辑装上探针——
   用它把"流式增量 → 切句 → 排队"这条链的每一环时刻都打出来，才发现 5.42.3① 那个空转。
3. **让被判据拒绝的分支也要被验证**：不只测"应该出声时出声了"，
   还测"此刻麦克风真出声 → **不出声**"，否则"改闸门"很容易改成"拆闸门"。

实测结果（真浏览器，房间 605280）：

| 断言 | 结果 |
|---|---|
| 字幕状态徽标显示引擎 | `🖥️ 服务器转写（本机 Qwen3-ASR）` ✅ |
| 字幕 1ms 前刚到 + 麦克风静默 → 是否出声 | `speak()` 被调用且 `speaking=true` ✅（旧 2500ms 闸此刻必吞） |
| 麦克风真出声 → 是否拦住 | 拦住，未调用 `speak()` ✅（礼仪没丢） |
| 唤醒 → 答案上屏 | 2.7s |
| 流式增量 → 分句排队 | 46 次增量 → 3 句依次入队 ✅ |

### 5.43 2026-10-03：三个"看起来正常其实根本没跑"的缺陷，都是被**新写的断言**抓出来的

> 本节挑三件本轮最有教学价值的事。它们的共同点：**代码写完了、测试也绿了、功能其实是死的。**

#### 5.43.1 选层器从来没被创建出来（时序竞态吃掉一个 UI）

给视频格加"选层器"这件事，从 09-11 的 D1 起就写在代码里。本轮第一次在真浏览器里断言
"DOM 里有没有 `.layer-pick`"，结果是**一个都没有**。

```
服务器 consume 处理体：
  ① socket.emit('layer-changed', { layerCount: 3, ... })   ← 通知先发
  ② return ok(callback, { consumerId, ... })                ← ack 后回
客户端：
  收到 ① 时，consumerTiles 里还没有这格（格子要等 ② 的 promise 回来才登记）
  → ensureLayerPicker(tile=undefined) 直接 return
  → 之后再也没有第二条 layer-changed（网络好就不会触发 auto-down）
```

> ▎这类缺陷的特征是：**两条正确的代码因为顺序错了而互相错过**。
>   修服务器那侧的 emit 时序也能治，但那是在为一个 UI 的细节去动一条被多处依赖的协议顺序。
>   正解是顺着本项目一直讲的"**一个概念只有一个来源**"：
>   `layerState`（客户端账本）才是"这路有几层"的权威，
>   **格子一出现就照账本补渲染**——顺序怎么变都不会漏，因为两边都会主动对齐一次。

同一轮还顺手用这条思路验证了"3 层 simulcast 真的协商出来了"（e2e 实测降层后
`videoWidth` 320 → 160）。**分层这件事，过去只有源码形状断言，从来没有真浏览器证据。**

#### 5.43.2 远程桌面"点下去半天才动"：不是慢，是没人报信

控制台原来显示 RTT 和帧率。本轮加了一个新读数：**输入发出 → 下一帧到达** 的毫秒数。
第一次量出来 **2287ms**。

RTT 只有几毫秒、帧率也正常——那 2.3 秒花在哪？答案是**根本没花**：
CDP 的 `Page.startScreencast` 是**合成器级变化检测**，像素没变就一帧都不发。
测试里那一下点在空白处，页面确实没变，于是控制端**收不到任何东西**，
直到别处（时钟、动画）恰好有个变化才飘来一帧。

> ▎用户说"它反应慢"，可能有两种病：**链路慢**（处方是加带宽/降分辨率）、
>   **没有反馈**（处方是主动补一次回声）。两者的表象一模一样，处方相反。
>   不量这个数，就会去调错的那一头。

修法（`agent/index.js` 的 `scheduleEcho()`）：注入输入后 120ms 复查，
若这期间抓屏没出过帧，就主动 `Page.captureScreenshot` 补一帧推过去。
**实测 2287ms → 153ms。** 三重限流防它变成风暴：突发输入合并成一次补帧、
抓屏已经出帧就不补、补出来的帧仍走帧间隔闸门。

> ▎通用判据：凡是"对端只在有变化时才说话"的通道（变化检测抓屏、diff 同步、
>   事件溯源广播），都要问一句"**我发了请求但它那边没变化，我怎么知道请求到了？**"
>   答案是配一个**回声/心跳**，而不是把超时调大。
> ▎顺带一条安全纪律：撤权（`stopStream()`）要把待发的回声定时器一起清掉——
>   控制权已经收回还去抓屏，等于多一次无谓的隐私面。

#### 5.43.3 一行 TDZ 错误，砍掉了文件末尾六个初始化

给首页加 hero 时写了：

```js
initIcePrecheck();
initHero();            // ← 调用点
/* ...几十行后... */
const HERO_TEXT = '…'; // ← 它依赖的常量
function initHero() { … }
```

`const` 有暂时性死区（TDZ），所以 `initHero()` 当场抛
"Cannot access 'HERO_TEXT' before initialization"。
**贵的那半不是这行错，而是它把本文件后面所有顶层语句一起砍掉**——
实测 `initAiChips / initBoardActions / initAiVoice / renderBoard / renderChatUnread / renderAiChips`
六个初始化一个都没跑。而页面看起来是好的（大部分初始化在更前面就做完了）。

> ▎更巧的是：同一轮用户正好在抱怨"AI 回答没声音"，而 `initAiVoice()` 就在这被砍掉的六个里面。
>   **一个"我新加的那行"的加载期异常，可以让三个不相干的功能同时静默失效。**
> ▎判据：① 顶层调用点写在它依赖的 const/函数**之后**；
>   ② 加完 init 调用，要在真浏览器里确认**文件末尾那几个 init 也跑了**；
>   ③ 静默截断比报错危险——报错有人会去看，截断不会。

#### 5.43.4 让测试去"占自己的端口"，而不是抢你的端口

本轮用户的一句反馈是"**测试的时候不要退出 agent 啊**"。原因很实在：
`test:sfu` 与 `test:asr-live` 都起在 3001/3443，跑回归就得先把你正在用的那台踢掉；
而"复用 3001 上已有的实例"又是坑 57 写过的假绿来源。

现在：**信令测试 3011、语音自测 3017 + `SFU_NO_HTTPS=1`，端口被占就明确拒绝并教你换端口。**
实测跑完两套回归，3001 上那个 PID 一个没变。

> ▎判据：**测试自起服务、自占端口**；`test:agent/e2e/e2e-media` 早就各占 3012/3013/3016，
>   这次是把最后两个抢 3001 的补齐。同一个反模式只修一半 = 等于没修（坑 57 原话）。

#### 5.43.5 本节一句话总结（面试可直接用）

> "这一轮我写的三个新功能，全都被我新加的断言判成'其实是死的'：
>  选层器因为服务器先发通知后回 ack 而从未被创建；远程桌面因为抓屏是变化驱动的，
>  '点下去没反应'被误判成链路慢（实测 2287ms，加输入回声后 153ms）；
>  一行 TDZ 让文件末尾六个初始化静默消失。
>  共同点是：**代码看起来对、老测试全绿**——只有把断言写到离用户最近的地方才能发现。"

---

### 5.44 2026-10-03b：先让延迟"看得见"，它才肯交代自己慢在哪一格

这一轮的教学价值不在"降了多少秒"，而在**为什么必须先把它做成一个数字**。

#### 5.44.1 为什么"感觉慢"不能直接优化

用户说"字幕还是慢"，我手里有两个已知量：分段窗口 4s、模型转写 1~3s。
拿这两个做算术，结论必然是"那差不多嘛"——**算术永远不会告诉你"今天变慢了"**，
也不会告诉你这 4s 里有多少是根本没在干活。

所以这一刀做的第一件事是：让每一次定稿字幕都带一个真数字。
起点选的是**服务器判定"这个人的最后有声时刻"**（`lastVoiceTs`，
即最后一个 RMS 高于阈值的 0.5s 窗到达的时刻）。于是：

```
说完 → [ 等待 wait ] → 转写开始 → [ 转写 trans ] → 定稿广播 → 上屏
       └──────────── latMs = 服务器实测的端到端延迟 ────────────┘
```

界面上是一枚 `⏱ 2.4s` 的三色徽标（≤3s 草绿 / ≤6s 苍黄 / 更慢胭脂红），
悬浮提示摊开拆分与近 8 句的均值、最慢值。

> ▎判据：**先问"用户感知的慢，是被哪个量决定的"**（坑 58 同一条）。
>   计算慢 → 量 CPU；等边界 → 量"最后有声 → 转写开始"；画面顿 → 量帧间隔。
>   量错指标，优化就会打在不存在的问题上。

#### 5.44.2 一个总数不够，要拆成"等待"和"干活"

拆开之后立刻看见：**模型根本不是瓶颈**（实测 `wait: 4195ms, trans: 1223ms`）。
这两种病的处方完全相反——

| 症状 | 处方 |
|---|---|
| `wait` 大 | 调 `asrSegmentSec` / 静音判定阈值 `FLUSH_MS` / 调度顺序 |
| `trans` 大 | 换引擎、降模型、上 GPU |

只有一个总秒数时，这两行看起来是同一个问题。
**"能拆开的度量"比"更小的数字"更值钱**——数字会变好也会变坏，
而拆分告诉你**该改哪里**。

顺带一条诚实纪律：这个数是**下限**。RMS 窗长 0.5s，"最后有声"的观测天然偏晚，
所以界面上的读数不会虚报"比实际更快"。**宁可保守，也不要在界面上哄人**。

#### 5.44.3 三个由这个数字牵出来的真缺陷

**① 同一句话被切成三句，AI 就答三次。**
4s 分段把「小明，帮我记一下明天下午三点的评审会」切成
「…三点的评审。」/「小明。」/「…3点的评审会。」，每段各自成句、各自唤醒。
原来的重复句闸要求"互相包含"，而**分段边界会带来写法漂移**
（模型把"三点"写成"3点"、尾字被截断），两者互不包含 → 闸在这里等于不存在。

修法是一个纯函数 `Asr.isFragmentOf(前一句, 这一句)`，核心是**方向性**：

```js
// 只算"新句被旧句覆盖多少"，而不是对称相似度
覆盖率 = |新句 ∩ 旧句| / |新句|
判为碎片 = 覆盖率 ≥ 0.6 且 新句里没被覆盖的 bigram ≤ 4
```

为什么必须讲方向：先说「小明」（打招呼）紧接着说「小明，把纪要生成一下」——
后者包含前者，但它是一句**信息更全的新问句**，对称相似度会把它当重复吞掉。
**丢一句真问题，比多答一句废话严重得多。**
另两条守卫：只比**同一个人**的前一句（两个人说同样的话是两件事）、
文本太短（bigram<3）不下结论（坑 53：样本小就别拿占比判够不够格）。

**② 兜底引擎的预热，在换主引擎那次被悄悄关掉了。**
09-30e 为"第一次识别特别慢"加了 whisper worker 开机预热；
09-30c 把主引擎切成 qwen-local 时，那段预热被改成"跳过"，理由也很正当：
两套模型同时驻留白占 1.5G 内存。代价是：**Qwen 冷启动要 ~55s，
这期间字幕全都由"现场起来的 whisper"承担，而那趟是带模型加载的**——
实测首段 15.0s，也就是说开机后第一分钟每句多等 15 秒，正是当年要消灭的症状原样复发。

新策略不是选边站，而是让两个目标同时成立：

```
兜底引擎照常预热 → 主引擎就绪那一刻 releaseFallbackAsr() 把它 kill 掉
（内存只在"两个都在"的重叠窗口翻倍，而首句延迟回到正常档）
```

实测：首段 15.0s → 11.3s，端到端 **9.2s → 5.3s**，qwen-local 就位后 **3.5~4.0s**。

> ▎通用判据（坑 71）：**改引擎/改架构时，把"当初为这件事专门写过的代码"列一遍**
>   （grep 关键词和日志文案），逐条问"它现在还生效吗"。
>   同一处改动会让另一处的正确性悄悄失效，而且两边都不报错。

**③ 我的自测被自己的历史污染了。**
字幕账本是 `<房间>-<UTC日期>.jsonl`、只追加，而自测固定用房间 999999，
收尾的删除又只写在 PASS 路径里。于是一次失败运行留下 2~3 条，
下一次把它们数进 `allAsr.length <= 2` → **从第二次运行起必然红**，
而报的错还是"重复句在刷屏"——把测试设施的问题说成了被测代码的缺陷。

修法三条缺一不可：开场先清场、读取按 `ts >= 本次起点` 过滤、清理挪进 `catch`。
判据（坑 72）：**回归结果不该依赖"上一次跑没跑干净"**；
凡是"上限型断言（≤N / =0）"，先证明你数的是这一次的数据。
还有一个方法论上的收获：修完之后我**连跑两次**才算验证通过——
第一次修完跑一次就 PASS，很容易就此交付，而它当时只是碰巧没撞上残留。

#### 5.44.4 可观测这件事要做满三处，而且必须同源

同一个数字，这次同时进了三个地方，且**都读同一个 `COLLAB.capLat` 对象**：

| 去处 | 形态 | 给谁看 |
|---|---|---|
| 字幕条 `⏱` 徽标 | 本句 + 近 8 句均值/最慢 | 开会的人 |
| `/metrics` | `avg / max / last` 三个 gauge + 样本数 counter | Prometheus、值守 |
| `/dashboard` | 概览单列一格（带阈值配色） | 运维一眼扫 |

> ▎为什么单列一格而不并进"转写引擎"那格：那一格讲"谁在转写、单次多久"，
>   这一格讲"从闭嘴到出字幕多久"。**两个语义挤一格，早晚漂移**（坑 47）。

告警侧也补了同样的分诊：`sfu_ai_asr_primary_ready` 让"在走兜底"这件事分成两种病——
**主引擎还没起来**（预热期，正确行为，先耐心等 N 轮）与
**起来了却不用**（真退化，两轮就报）。老服务器根本没有这一行时**退回旧判据**：
"读不到"和"读到 0"是两件事，否则那条告警会在老服务器上永远不响。

#### 5.44.5 顺手补掉一整类文档漏写

`sfu/protocol.js` 是"改 SFU 前后端先看"的总表，但它只列了 C→S 的请求，
**语音链路的服务器下行广播全缺**（`asr-caption`/`ai-state`/`ai-audio`/`ai-tts-fail`/
`ai-tts-state`/`board-state`/`board-record`/`remote-quality`）。
这类事件**没有 ack、没有重发**，漏写的后果是后来人只照请求侧改，
客户端监听挂漏了也不会报错——又是一类沉默故障。
补的时候每个名字都 `grep` 过服务器与客户端各一遍（坑 43：别给不存在的能力写文档）。

#### 5.44.6 本轮自己写出来的两个错（记下来免得只讲别人的）

- 用 `gaugeOf(base, kind)` 去读一个**没有 label 的 counter**，正则永远匹配不上 →
  那条告警的门槛恒为 0 → **它永远不会响**。是新写的合成输入断言当场判红的。
- 服务器算出了 `stage`，客户端 `socket.on('asr-caption', ({...}))` 的解构里**漏接**，
  于是拆分逻辑对、调用点接上、`node --check` 过，但界面上永远看不见——
  这是"内层算出来了、外层没带出来"（坑 56）在本项目的**第三次**复发。
  两个都是断言加在**离用户最近的地方**才抓到的。

#### 5.44.7 本节一句话总结（面试可直接用）

> "这一轮我没先优化延迟，先把它做成了界面上的一个数字，还拆成'等待'和'转写'两段。
>  拆完才发现模型只占 1.2s，另外 4s 是我们的调度在等；
>  也正因为开始量它，才撞出三个原来看不见的问题：
>  一句话被分段切成三句所以 AI 答三遍、换引擎时预热的老优化被顺手关掉、
>  还有我自己的自测在拿上一次运行的残留当本次结果。
>  **可观测性不是加分项，它是让'优化'这件事有反馈通路的前提。**"


---

### 5.45 2026-10-03c：把同一把尺子量第二条链路，然后三次推翻自己

5.44 讲的是"先让延迟看得见"。这一节讲**同一套做法用到第二条链路上会发生什么**——
以及它顺手带出的三次自我否定。面试时这一节比"我优化了多少秒"更值钱，
因为它证明的是方法，不是运气。

#### 5.45.1 第二条链路：读数好 copy，锚点不能 copy

字幕延迟的锚点是"人说完"→"字幕上屏"。播报延迟看起来长得一样，
但**两端都必须重新想一遍**：

| | 起点 | 终点 | 为什么不能照抄 |
|---|---|---|---|
| 字幕 | 最后一个有声 RMS 窗 | 定稿广播 | 服务器自己全程可见 |
| 播报 | **`chat-message` 到达**（文字到齐） | **`<audio>` 的 `onplaying`** | 起点若取"首字上屏"，就把 LLM 生成速度混进了"嘴"的延迟；终点若取"收到 ai-audio"，那只证明服务器发了，取文件失败/被自动播放策略拦掉时用户其实一声没出 |

> ▎判据：**换一个链路量一个数，先重问"这段等待由谁负责"**。
>   终点选错的话，读数会告诉你"1.6s，很快"，而屏幕上什么声音都没有——
>   那就是坑 66 那三次"答应了却不说话"的原始形态。

读数最终贴在**那条答案自己的气泡**上（`🔊 2.3s 后开口`），
而且插在正文节点与时间行**之间**：混进正文的话，朗读会把这个读数一起念出来。

#### 5.45.2 结构 vs 检查：跨人误吞这件事，不该靠"记得比一下 from"

原来的重复句闸拿的是**房间级单槽** `room.lastAsrUtterance`：

```
小张说「帮我记一下…评审。」 → 小李说了别的 → 小张的后半句到达
                            ↑ 它对比的是小李那句 → 碎片漏判，账本里两遍
```

反过来还会**误吞**：两个人先后说了相似的话，后一个人被当成"碎片"丢掉——
那是在改会议记录。修法不是多加一句 `if (prev.from === memberId)`（我当时就是这么写的），
而是**把锚点存到成员对象上，每人一条**：

```js
const sm = [...room.members].find((m) => m.id === memberId);
const prev = sm && sm.lastAsrUtterance;   // 跨人误吞在结构上不可能发生
```

> ▎通用判据（坑 47 的执行版）：**能用结构消除的判据，就不要靠每次记得检查**。
>   检查会被漏掉、会在下一个调用点忘记加；结构不会。
>   ▸ 也刻意**不另开一个 Map**：存成员对象上人走即散，
>     不需要额外的清理路径 —— 坑 20 那类"忘了清定时器"的根治办法是根本不另立状态。

#### 5.45.3 抽函数不是为了好看，是为了"能被断言"

这一轮抽了两个：

- `Asr.isDupOrFragment(prev, cur)` —— 字幕刷屏的**总闸**，原本是 server 里 12 行内联布尔。
  它控制着用户最反感的症状，却**没有任何测试碰得到它**。抽出后逐条断言 6 项，
  含"任一边为空不判重复"这种容易漏的边界。
- `buildSentryReport(all, sentry, voiceLats)` —— 原先整段拼串写在按钮回调里，
  谁都调不到，于是"日报里到底有没有这一节"只能靠人肉点一下看。
  返回 `{ md, speakerCount, durMin }` 而不是只返回字符串：
  日志行要用的统计**必须由同一趟计算给出**，让调用方再算一遍就是"一个概念两个来源"。

> ▎判据：**测试覆盖不到的地方，往往不是逻辑难，是它没被暴露成可调用**。
>   "重构以提高可测性"这句话在教学项目里同样成立。

#### 5.45.4 一个 52px 的小徽标，量出一个存在了很久的手机缺陷

给字幕条加 `⏱` 徽标时顺手写了条断言："390px 下这行不许溢出"。结果：

```
溢出 223px，正文宽度 0px
```

字幕条是一行**不换行的 flex**，里面七个元素除正文外全是 `flex-shrink:0`——
它在移动端**早就是坏的**，只是从来没人把宽度量出来。修法是 `flex-wrap` + 正文 `order:-1`
（手机上字幕本身才是主角，控件排到第二行），而不是"小屏藏掉几个按钮"：
**藏东西是在替用户决定他不要什么**。

然后做了一件更重要的事：**没有只修这一个**。把同样的断言铺到每一排常驻横向控件
（控制坞 / 顶栏 / 反应条 / 侧栏头 / hero 卡），实测全部零越界——
于是这条断言从"bug 报告"变成"护栏"：以后往这些排里加东西，挤爆了会当场红。

> ▎判据：**修好一个由度量暴露的缺陷之后，把同一把尺子在所有同类位置上都量一遍。**

#### 5.45.5 我推翻了我自己上一轮写进报告的结论

上一轮我根据 `bench:tts` 单跑一次的数据写下「`non_streaming_mode` 没有收益」。
这次把矩阵跑满（float32 / bfloat16 × 流式 / 非流式 / 三句一批），发现：
同一档位内部相差 1.7 倍，bf16 某一档反而是全表最慢的一条。
**这说明差异被机器噪声主导，n=1 根本排不了序。**

处理方式不是悄悄改掉那行字，而是：
1. 报告里**明写这条结论已被推翻**，并换成完整矩阵；
2. 操作结论保留，但换一条不依赖档位比较的理由：**所有档位 RTF 都 >1**
   （合成 1 秒音频要 4.5~7.8 秒），这是 CPU 自回归的结构性事实；
3. 给工具补上它本来就该有的能力：`npm run bench:tts -- --repeats 3`，
   每格跑三次，除 median 还打 **spread/min/max**——
   **方差本身就是结论**，只报中位数等于把"这两档差异小于抖动"藏起来。

> ▎通用判据：**凡是要用来"排序/选参数"的测量，先问自己重复了几次。**
>   一次都不重复的基准测试，只能估量级，不能做决策依据。
>   （坑 53 是同一个毛病的另一面：拿绝对阈值下判断。）

#### 5.45.6 顺手记三条流程级教训（都是我自己踩的）

- **往长文档插内容时，锚点要选唯一且不会被吞的整行**。这次我拿一段正文的首行当锚点，
  结果把「双版本架构形态」那段的开头替换掉了，而 `git diff` 只显示"1 增 1 删"——
  改坏了却看不出来。靠逐行核对 diff 才发现。
- **测试的期望值只要由时间推导，就必须带容差**。
  我写的 `=== 2300`（`Date.now()` 相减得来的数）在上一轮侥幸绿、这一轮偶发红。
- **CPU 重的基准不要和延迟断言同时跑**。本轮把 `--repeats 3` 单独跑，
  就是因为刚学过"抖动会淹没结论"。

#### 5.45.7 本节一句话总结（面试可直接用）

> "把延迟做成数字之后，我这一轮**三次推翻自己**：
>  一次实验（把静音判定调快 300ms）实测反而慢一倍；
>  一个基准结论（换 dtype 或流式档能提速）被证明是拿噪声当结论；
>  一个 52px 的小徽标量出移动端早就存在的布局溢出。
>  最后我把方法固化了下来：**排序要有重复次数的测量、判据要能写成纯函数、
>  约束要靠结构而不是每次记得检查、修好一处要把同一把尺子量遍同类位置。**"

### 5.46 2026-10-03d/e：GPU、真浏览器取证、与"从未生效的机制"（语音识别冲到能日常用）

> 这一轮的三个关键词：**本机有块 GPU 一直闲着**、**证据要来自真浏览器**、
> **机制"存在"不等于机制"生效"**。字幕定稿从 7.7s 一路砍到 1.4s。

#### 5.46.1 算力盘点：装了 CUDA 版 torch 之后

`nvidia-smi` 显示 RTX 4060 8GB，`torch.__version__` 却是 `+cpu`——
worker 注释里"CPU 保守可行"是在没人看显卡时写下的。换装（同版本号 cu130，`--no-deps --user`）
之后：单段转写 2.2s → 0.3~0.6s。**但裸基准一度显示 0.25s/9 倍**——那是合成音频只转出
2 个 token 的假象；自回归生成的耗时 ∝ 输出 token 数，基准样本必须像真实负载（坑 75）。
TTS 那边 GPU 上 RTF≈4.1（CPU 4.5）：瓶颈是逐 token 架构开销不是算力——
**数据把"本地音色当实时播报"这个念头正式埋了**。

#### 5.46.2 真浏览器取证：把 WAV 当麦克风

此前的语音证据全来自"服务器侧直推 RTP"，浏览器→WebRTC→AI 耳朵这一段零覆盖。
Chrome 的 `--use-file-for-fake-audio-capture=<wav>` 能把一段真实语音当成麦克风，
于是 `test:e2e-asr` 有了全真链路断言：转写上屏、⏱ 延迟读数、正解命中、AI 应答、
**第二个浏览器的字幕广播**、AI 房间动作双端同步。首跑就抓到五个真缺陷。

#### 5.46.3 从未生效的机制（本轮最重要的教训）

"静音抢跑快照"机制被注释、回归记录和成绩单引用了三天——全量打点发现它
**一次都没触发过**：ffmpeg `-f segment` 的 wav 段**写满才落盘**（in-flight 段
statSync 恒 0 字节），快照 copy 永远拿到 0 字节。三行诊断日志
（触发打点 / flush 评估 / size 输出）胜过三次盲改。真正的延迟下限 =
说完 → 分段边界，所以 GPU 时代把 `asrSegmentSec` 4→2 才是正解
（最坏等待 4s→2s，asr-live 实测 1.4~1.7s）。

#### 5.46.4 一张表：语音链路现在的延迟账

| 环节 | CPU 时代 | GPU + 2s 分段 |
|---|---|---|
| 说完 → 转写开始（静音判定+调度） | 1.2~4.2s | 0~2s（边界决定） |
| 转写一段 | 2.1~2.4s | 0.3~0.6s |
| 字幕定稿（受控 asr-live） | 6.4~7.6s | **1.4~1.7s** |
| AI 应答（LLM 首句） | +2~5s | +2~5s（网络账，与本机无关） |

#### 5.46.5 本节一句话总结（面试可直接用）

> "这一轮我学会三件事：**先盘点手里的硬件再谈优化**（有 GPU 的机器跑 CPU 推理
> 是最贵的浪费）；**证据要来自用户真实走过的路径**（服务器侧自测绿了不代表浏览器里能用，
> 我们抓到五个只有真浏览器才暴露的缺陷）；**每个自动机制都要有'它真的触发了'的证据**
> ——一个从未触发的优化机制，会在成绩单里领三天功劳。"

---

### 5.47 2026-10-03f ~ 10-04：界面这一轮（去 emoji、四个 reactbits 移植、白板盖字幕、等一轮再说）

> 这一轮的主题只有一个词：**看得见**。前面几十节都在讲"链路通不通"，
> 而这一轮的缺陷全都"逻辑正确、界面是坏的"——这类问题最难，因为
> `node --check` 不报、冒烟不红、日志干净，只有眼睛（或一条量真实盒子的断言）能发现。

#### 5.47.1 一条新纪律：加图标和给图标定尺寸，是同一件事

把彩色 emoji 换成线性 SVG 之后，漏写一条 CSS 尺寸规则的那颗图标会按 **300×150** 渲染，
直接把那块 UI 撑爆。而它不报错——`<svg>` 是替换元素，没有宽高就用默认尺寸。

这是坑 26（CSS 注释里的 `*/` 吞掉全站变量）的镜像版：**代码全对、界面塌掉、只有人眼能发现**。
解法不是"更细心"，是让浏览器把数字吐出来：

```js
// scripts/check-icon-sweep.js 的 B 项：量页面上每一个行内图标
for (const el of document.querySelectorAll('svg.i')) {
  const r = el.getBoundingClientRect();
  if (r.width > 24 || r.height > 24) bad.push(loc(el) + '@' + r.width + 'x' + r.height);
}
```

这条断言当场抓到 `.member-title` 的图标按 32×32 渲染。
**判据：凡是"样式缺失不会报错、只会让界面变丑"的改动，都要配一条量真实盒子的检查。**

#### 5.47.2 `textContent = …` 会顺手抹掉同一个节点里的图标

三处同源：字幕状态徽标、延迟读数、播报胶囊。给 HTML 加了静态图标之后，
JS 里那句 `el.textContent = '服务器转写'` 会把图标一起清掉——
**赋值 textContent 的语义是"清空子树，放一个文本节点"**。

两种正确写法，按语义选：

| 情况 | 写法 | 例子 |
|---|---|---|
| 图标固定、数字会变 | HTML 放图标，JS 只写子节点 | `#capLat` 里的 `svg` + `b#capLatNum` |
| 图标要随状态换 | JS 连图标一起渲染，判据只写一处 | `renderCapStatus()` 按 level + 文案选图标 |

顺带一条测试侧的：假 DOM 的 `innerHTML` 与 `textContent` **不聚合**（坑 27 家族），
所以改成 innerHTML 写法之后，10 条老断言要跟着改读 innerHTML。

#### 5.47.3 白板盖住字幕：界面"坏了"有时不是逻辑坏了，是被另一层盖住了

用户报"让 AI 调白板之后字幕不可用了"。字幕那套状态机（开关 / 账本 / 看门狗 / 服务端模式）
一个字都没错——白板覆盖层是 `inset:0; z-index:6`，而字幕条 + 控制坞在 z-index:5，
**白板一开，字幕条和整排按钮一起被吞掉**。

取证手法是这一轮最值得学的东西：**问页面自己**"我要点这块地方，你会把事件给谁"：

```js
const r = el.getBoundingClientRect();
const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
// 白板开着时，字幕条中心的 top 是 #boardCanvas —— 一句话定死结论
```

修法不是把 z-index 调小（那样按钮能点了，但白板底部那块画不到，等于换一个毛病），
而是**让位**：白板底边停在底部那一列之上。而"那一列多高"是**会变**的
（坞换行、字幕条开合、"允许远程协助"按钮出现），所以用 ResizeObserver 量真实高度
写进 `--stack-h`，全舞台只有这一个来源。

> **通用判据：当你在"调一个数让它别挡住另一个东西"，那通常是缺一个容器，不是一个数。**
> 这一轮的另一处同形问题：dB→电平 的换算原先埋在 `setSpeaking` 里，新加的"AI 耳朵"
> 要再抄一份 → 抽成唯一的 `dbToLevel()` 两处共用，否则改了阈值画面会亮而耳朵不亮。

#### 5.47.4 「它答应了却不说话」的第四种成因：判据对，处置错

把 `test:e2e-asr` 里那行"未采到 🔊 读数，**不判失败**"的 console.log 提成断言，
第一次跑就红，计数摆出真相：

```
asked=1  started=0  killed=0  gated.talking-now=1
```

"用户此刻在说话就不要插嘴"——判据完全正确。错在**处置**：直接 `return`
等于这一轮答案的声音**永远不会再出现**，而气泡上明明写着答案。
而"用户还在说"最常见的场景恰恰是 2s 分段把一句话切成三四条字幕陆续到达。

改法是等一轮（最多 6s），等不到才认输并留下计数：

```js
function waitForTurnThen(label, run) {
  const gen = ++speakTurnGen;              // 新一轮等待作废旧的（"只说最新"）
  const deadline = Date.now() + 6000;
  voiceTrace.deferred += 1;
  const tick = () => {
    if (gen !== speakTurnGen) return;
    if (!humanTalkingNow()) { voiceTrace.resumed += 1; return run(); }
    if (Date.now() >= deadline) return noteVoiceGate(`turn-timeout-${label}`);
    setTimeout(tick, 400);
  };
  setTimeout(tick, 400);
}
```

修完实测：`asked=10 / started=10 / killed=0`，气泡上贴出「3.2s 后开口」。

> **通用判据：一个"永远不会为沉默变红"的测试，等于没在测这件事。**
> 把 console.log 升级成断言，是这一轮性价比最高的一次改动。

#### 5.47.5 控制坞从来没放下去过（先量，再谈适配）

真浏览器 11 档视口扫一遍才看见：坞需要 1708px，而 1890px 视口只给它 1528px——
**连 1920 的屏都放不下**，右边那排按钮（省流 / 表情 / 字幕 / 白板）
藏在一条几乎看不见的横向滚动条后面。用户说"有些功能找不到"的真相就在这儿。

| 视口 | 舞台 | 坞需要 | 溢出 |
|---|---|---|---|
| 1890px | 1558 | 1708 | **180px** |
| 1570px | 1238 | 1687 | 479px |
| 1250px | 918 | 1708 | 820px |
| ≤760px | — | 363 | 0（早就有图标化降级） |

修法两步：① 坞按功能拆两行（会议控制 / 协作与 AI，**id 与顺序一个没动**）；
② 把"字幕条 + 坞"包进一个 `.bottom-stack` 列容器，两者改成 `position: static`。
第二步才是关键：原先两处各写一个 `bottom:96px / 128px` 猜坞的高度，
坞一长高两者就叠住——**同一个概念两个来源，迟早对不上**。

#### 5.47.6 无障碍：两条能量出来的硬指标

* **减弱动效**：CSS 里被引用的 39 个动画名，全部要在 `prefers-reduced-motion` 块里
  被点名或被 `animation: none !important` 一刀切盖住。
* **对比度**：要**在真实渲染结果上量**，不是拿 CSS 变量互算——文字常落在半透明玻璃上，
  实际底色只有布局完才知道。
* **可访问名**：小屏那条 `.btn:has(.i) span { display:none }` 把文字收掉之后，
  `display:none` 的内容不进可访问性树，于是手机上那排按钮**一个名字都没有**。
  解法是让 `setIconBtn` 顺手同步 `aria-label`，名字的唯一来源就是按钮上写着的那句话。

这三条都在 `npm run check:a11y` 里，实测结论：主题全部达到 WCAG AA，
减弱动效全覆盖（这是"没有缺陷"的结论，也是结论）。

#### 5.47.7 桩里缺一个能力，那条分支就**永久不测**（补桩之后立刻抓到第二条）

`speakStreamPart()` 里写了 `answerTs: id`，而那个作用域里根本没有 `id` 这个变量——
每次流式切出一整句就抛一次 `ReferenceError`，真浏览器控制台抓到 3 次，
而 `npm run test:smoke` **连跑两天 348 项全绿**。

原因不在断言写错，在假环境：**冒烟桩里没有 `speechSynthesis`**，于是
`SPEECH_OK = false`，那一行从来没被执行过。这类盲区不会自己露头——
它不是"测试通过"，是"测试根本没跑到"。

补桩的时候还要补得**像真的**：`speak()` 只记文本还不够，分句朗读的泵是靠
`onend` 接力到下一句的，桩里不回调 `onend` 就等于"队列永远只念第一句"——
又一个"只测了一半"。补成 `onstart`/`onend` 都按真浏览器语义回调之后，才敢断言
"哪一句真的上了嘴"（`speechStub.spoken`）。

红利立刻兑现：断言一跑起来就发现 `enqueueAiSpeech` 登记延迟锚点写的是

```js
if (replace && typeof answerTs === 'number') aiSpeakRoundTs = answerTs;   // 旧
```

而**流式那一轨传的是 `streamId`，它是字符串**（`asr-mrx3…`）。于是语音问答的答案
（基本都是流式的）永远登记不上锚点——"浏览器朗读的播报延迟"这个读数只在少数
非流式场景出现，`/metrics` 长期少一整类样本。判据应该是"能不能当配对用的键"，
不是"是不是数字"（`AGENTS.md` 坑 56：内层把 id 传出来了，外层按 ts 的类型判）。

> 通用判据：**凡是依赖宿主能力的分支，要问"我的假环境里有这个能力吗"**。
> 没有 = 永久不测；有但不完整 = 只测了一半。两种都不会红。

#### 5.47.8 两处"说实话"：徽标不能说胡话，AI 不该对着半句答题

**① 徽标拼出"服务器转写（服务器转写）"**。`client.js` 里有**三处**读 `/config.json`
（进房 `initSFU`、点字幕 `ensureAsrConfig`、浏览器识别失败兜底那次现场补拉），
而 `serverAsrEngine` 只有第一处会写。走第二处时 `asrEngineCn()` 取兜底文案，
而那句兜底**恰好也叫"服务器转写"**，与外层模板 `服务器转写（${引擎}）` 拼成胡话。
用户看到这种字只会得出一个结论：**引擎根本没切换**（坑 67 家族——含混的声明比缺失更糟）。

修法是把三处读取器合并成同一个 `applyServerConfig(cfg)`：**结构上不可能再漏一半**，
而不是"以后记得同步改"；兜底文案改成不与外层重复的"引擎待确认"。
另有一条测试教训：e2e 那条断言写的是"含不含'服务器转写'"，**所以它一直是绿的**——
只查关键词在不在，查不出这句话是不是人话。现在 `check:console` 断的是
"不自我重复、不露空括号、说'服务器转写'就得点明是哪个引擎"。

**② 光叫名字、没说事情**。分段窗口会把「小明，把纪要生成一下」切成两条，
其中一条**只剩名字**。旧代码只要文本里有名字就算"明确指令"，于是拿着一个光秃秃的
「小明」去问模型——模型没有新问题可答，只能把上一轮答案复述一遍（用户看到的
"它又在重复接话"）。新增纯函数 `Asr.isNameOnly(norm)`（去掉名字后剩不到 2 个字才算），
处置**不是丢掉、而是应一声不作答**：顺延追问窗口，让随后到达的那半句以追问身份被接住。
两种失败都试过了：**重复答**比**喊了不理**更烦，但把话切在半句上不理不答也不对。

#### 5.47.9 量具自己也是负载来源：`check:all` 第一天就抓到的三种自我干扰

十三套界面检查原先只能逐个跑，而"九条命令没人会逐个跑"——不被跑的检查等于没有。
于是加了 `npm run check:all`（自起服务器 3021、临时库、错峰、跑完对账清单）。
它第一次全量跑就红了两条，而**两条都不是产品缺陷**：

* **`?nosw=1` 让每次测量都注定撞上一次自我导航**。所有检查都按坑 40 的纪律带这个参数，
  而逃生舱的写法是"注销 SW → 清缓存 → 重载一次"。全新 profile 下其实没东西可清，
  那一趟跳转什么都换不来，却把 `Runtime.evaluate` 撞成 `target navigated or closed`
  ——表现为"红的档每次都换"（1920→1280→1152）。
  修法是两层：产品侧"真的清掉了东西才跳转"（不跳时用 `history.replaceState` 静默抹参数，
  它不产生导航）；量具侧改成"取值失败就重试到停稳" + 开跑前删掉自己那一档的 profile。
* **13 条检查共用同一个 CDP 端口 9333 和同一个 profile 目录**。单独跑各自没事，
  串起来跑就可能撞上"前一台刚 kill、后一台连上半死的实例"——这是真实隐患，所以
  `agent/cdp.js` 的默认端口改成认环境变量 `WB_CDP_PORT`（显式传入优先，真实使用的 9333 没动），
  `check:all` 给每条检查一个专属端口；profile 按端口派生，顺带把 SW/缓存也隔离了。
  ▸ **这里留一条自我推翻**：我一开始把 `check:pill` 那次"五条 hover 全 0.00"归因给它，
    随后被自己的复测推翻——**隔离端口之后它又红了一次，而同样的前缀序列又绿过两次**。
    所以这条改的是隐患，不是那次红的根因；根因**尚未定论**，如实挂着。
    能做的是让下一次的红会自己解释自己：给 pill 补了**前提断言**——先轮询到按钮真的占了
    一块面积，再用 `elementFromPoint` 问"这块地方的事件归谁"。下次再 0.00，报的会是
    "没显示"或"被盖住"，而不是一句没法查的"鼠标没落上"。
    ▸ **归因错比不归因更贵**：一句"已经修好了"会让所有人停止观察这一条。
* **临时库用固定名 = 上一轮的账号被这一轮数进去**。`test:e2e-asr` 在设置阶段就报
  "用户名已被注册"——那是它自己上一轮留下的库（坑 72 第四次复发）。
  正解是向多数派写法对齐：库名带 `pid + 时刻`，**每次运行天然是空的**，
  而不是"记得开场清一次"。

> 一句话：**"检查自己偶尔红"的时候，先找检查自己注入了什么副作用**（参数、跳转、端口、
> 缓存、负载、上一轮的残留）。这类红会移动、会自愈，而产品代码里根本没有那个毛病；
> 按它去改产品代码，就是拿假红当真缺陷。


#### 5.47.10 本节一句话总结（面试可直接用）

> "这一轮我做的是界面，但我学到的东西不在界面：**'逻辑对、界面坏'的缺陷只能靠量真实
> 渲染结果来发现**——所以我给每一类改动都配了一条会看浏览器算出来的值的检查
> （图标尺寸、命中测试、对比度、坞的溢出、导出的 PNG 里到底有没有笔迹）。
> 最值的一次是把一行'不判失败'的日志改成断言，它当场抓到 AI 的答案被抢话闸永久丢弃——
> 判据是对的，处置是错的，而这种错法在任何日志里都不留痕迹。"
>
> 收尾这半轮又加了两句，都是"查自己"的：
> ① **"测试全绿"不等于"测到了"**——假环境缺一种宿主能力（这里是 `speechSynthesis`），
> 那条分支就永久不跑，代码里放着一个能抛错的引用也没人看见；补桩要补得**像真的**，
> 回调链也得补全，否则只是把"永久不测"从整条分支缩小到一半。
> ② **量具自己也是负载来源**——把 13 条检查串成一条命令之后，红的第一批全是
> 检查自己的副作用（共用的调试端口、排障参数带来的一次自我导航、上一轮留下的临时库），
> 而不是被测代码。所以判据是：**红的会不会自己挪地方**；会挪就别去改产品代码。

### 5.48 三把尺子都是拿响麦克风定的：安静的人就这样"没字幕"（2026-10-05）

> 用户拿着自己一场会的截图问："语音识别怎么这么乱、延迟还很大、到底接的哪个模型、
> TTS 是千问还是浏览器的？"这一节的值钱之处不在修了什么，而在**每个答案都是从
> 他自己那 66 秒的日志里读出来的**，没有一句是猜的。

#### 5.48.1 先取证，再回答

```
sfu/logs/app-2026-10-05.jsonl（房间 283648，18:43:08 建房 → 18:45:49 TTL 销毁）
  asr-segment          4 次     ← 只有 4 段进了转写
  asr-silence-skipped  8 次     ← peakDb = -56 / -59 / -56 / -63 / -57 / -57 / -65 / -56
  ai-tts              157 次（全天）  engine 全是 "edge"
sfu/captions/cap-283648-20261005.jsonl
  「你好 下面」/「你好 小米 下面」/「小明」      lat=0.0s / 0.0s / 缺
```

三句话就把问题钉死了：**这个人说话的声音太小**（峰值 -56~-65 dBFS，而阈值是 -55），
所以**六成语音被当静音删掉**；**TTS 用的是微软 Edge（晓晓），千问一次都没用上**；
**界面上那个 ⏱ 0.0s 是假的**（同一句的真实等待是 18:43:16 出段 → 18:43:26 定稿，约 10 秒）。

#### 5.48.2 一条经验：绝对阈值 + 外部世界的幅度 = 必须问"这数是谁定的"

链路里有三把尺子，全都是"当初能跑起来"那天写下的，而那天喂的是 **TTS 合成的全幅语音**：

| 尺子 | 原值 | 它回答什么问题 | 对安静麦克风的后果 |
|---|---|---|---|
| 能量闸 `asrMinPeakDb` | -55 | 这段有没有出声 | 真语音被当静音删（没字幕） |
| 增益上限 | +20dB | 要不要把声音提上去 | 放行段仍停在 ≈-36dBFS（模型听不清 → 错字碎片） |
| RMS 语音阈值 `FLUSH_DB` | -38 | **此刻**有没有人在说 | 整场不刷新 → 静音确认快路径失效 + 延迟读数没有锚 |

改成 -62 / +40dB / -50，并且**三条一起改**：只放宽闸门不提增益，换来的是
"有字幕但全是错字"——比没字幕更让人以为功能坏了。

> 判据：**凡是"绝对阈值 + 外部世界幅度"的组合，都要问一句这个数是拿什么样本定的**。
> 同一份代码在合成语音上跑得好，在真笔记本麦上静默失效——它不报错，只会少字幕。
> 这与坑 57（装了 ≠ 用上了）、坑 64（没人说话模型也还你一句话）是同族病。

`test:quiet-mic` 现在跑**两档**：-48dBFS（上一轮的用户）与 -60dBFS（这一轮的用户），
第二档专门钉"坐得远的人"：旧闸确实误杀 / 新闸确实放行 / 增益后模型输入 -19.7dBFS / 关键词 4/4。
顺带修掉一条**只会误报的断言**：原来写"增益版命中必须严格多于安静版"，可安静版本来就 4/4 时
它永远不可能成立——**"要求变好"的断言要写成"不得变差"**，否则它不保护功能，只制造假红。

#### 5.48.3 唤醒词：模型会把"小明"写成"小米"

真机字幕里明明白白是「你好 **小米** 下面」。旧容错表只有 明/鸣/名/铭，于是
"用户叫了它，服务器判定没叫" → 它不理。表放宽成 `[小晓笑孝筱][明鸣名铭茗米民密蜜命]`，
但**有意不收「小敏」**——那是常见人名，开会提到同事名字就插一句"我在，你说"，
比漏唤醒更让人想关掉整个功能。边界写在注释里，将来要放宽的人知道自己在取舍什么。

另一处更值得记：浏览器那一轨原先自己写 `text.includes('小明')`——同一个概念第二个来源
（坑 47）。跨运行时（服务端 / 浏览器）做不到只有一份，于是退一步：
服务器随定稿字幕下发 `wake` 字段，客户端只照办；再加一条**逐字比对两张表**的断言，
让"改一处忘改另一处"当场红，而不是变成"它有时理有时不理"。

#### 5.48.4 ⏱ 0.0s：读数宁可没有，也不能撒谎

`max-open` / `gap` 这两种定稿发生在**人还在说**的时刻，量出来的十几毫秒不是"说完→上屏"。
修法是把"为什么定稿"传下去：`finalizeUtterance(mid, reason)` 只有 `reason === 'silence'`
才产读数；客户端再加一道物理下限（<200ms 判不可靠，保持上一次读数）。
这条是坑 90 末段挂的待办，本轮清掉。

#### 5.48.5 用户说"用不到就删掉"，我做了什么、没做什么

取证显示千问本地 TTS 全天 0 次被用到（Edge 可达时轮不上，而它合成比播放慢 4 倍），
所以**默认不再预热那个 worker**——省下 ~1.5GB 显存与启动 ~20 秒，启动日志说实话。
但**没有删**模型权重（2.4GB）和代码：删文件不可逆，而"用不到"与"不许存在"是两件事，
后者需要用户点头。要自持音色时把 `aiTtsLocalWait` 设 true 就照旧生效。

---

### 5.49 模型给你的话，和它对空白的回答：一段 ASR 文本要过几道闸（2026-10-05 夜）

前面几节讲的都是"听不见"（能量闸）与"太慢"（分段与推理）。这一节讲第三种病：**听见了，
但话说错了**——它是用户第二张截图「全都是问题」的全部内容，也是本轮最有方法论价值的一轮。

#### 5.49.1 一条文本从模型到字幕条，中间有四道闸（全在 `sfu/ai/asr.js`，全是纯函数）

```
模型吐出的 raw
 → ① noiseRiffReason()   噪声被模型"自由发挥"成的求赞话术 → 整段判废（返回**为什么**）
 → ② HALLUCIN_FRAGS      提示词回显 /「字幕by」/「谢谢大家」→ 只擦这些片段
 → ③ 复读折叠            同一短句连说三遍 → 只留一遍
 → ④ fixDomainHomophones()  「既要生成」→「纪要生成」（只在贴着动作词时才改）
 → 剩下什么都不剩 → 返回 ''（= 这段没人说话，沿用 09-28 的空串约定）
```

为什么四道都要**纯函数**：它们决定用户看见什么、AI 听见什么，而这类判断**必须能穷举**。
`npm run test:asr` 里每一道都有正例 + 反例，反例尤其重要——③④ 的失败模式是"误杀真话"，
那比放过一条幻觉更糟（用户会说"我明明说了它没记"）。

#### 5.49.2 精确串匹配一定会被同音字打穿（坑 92）

上一轮写的幻觉正则长这样：`点赞[，,、]?订阅[，,、]?转发…`。第二天账本里的原文是
「请在下一个视频里面**打赞**，许多 clic，支持、**收养**、多泫，**看到更多** needL FI Ching」——
**打赞 ≠ 点赞、收养 ≠ 收藏**，四条一条都不命中。
> 判据的形状要换：**不要试图预测它说什么，改用"这类话的分布特征"**。
所以新判据是三类弱信号组合：强锚一个即丢（明镜与点点/字幕君/不吝/看到更多）；
否则"求赞家族"**且**"平台词"同时出现才丢；再加拉丁乱码计数。
两个细节值得记住：① **「转发」必须从平台词里踢掉**，否则"这个方案我点赞，大家转发一下"被误杀；
② **判据返回"命中理由"而不是布尔**——否则日志里"这句为什么没了"永远是黑盒（坑 76 同一条纪律）。

还有一条更贵的：**放宽一个阈值不会消灭问题，只会把它推到下一环。**
上一轮我把能量闸从 -55 放宽到 -62 去救安静的人，噪声段因此进了转写，"少字幕"就变成了"垃圾字幕"。
动阈值的那一次，必须同时回答"下一环接得住吗"。

#### 5.49.3 ★ 给模型加热词，必须用**空输入**验收一次（坑 93，本轮最值钱的一课）

「纪要」被听成「既要」，最直觉的方案是把会议热词塞进模型的 `context`（Qwen3-ASR 支持）。
本机跑了一次对照实验（同一份 fixture，量完就把脚本删掉），结论是**这条路要否掉**：

| 输入 | 无热词 | 有热词 |
|---|---|---|
| 整句音频 | 「小明，把纪要生成一下。」 | 「小明，把纪要生成一下。」（**本来就对**） |
| **纯静音** | 「嗯。」 | **「普通话会议对话，简体中文。常见词：小明 纪要 评审 白板…。」** |

右下的那一格是全部风险：**模型把你给它的提示原样还给了你**，而那句话里带「小明」——
幻觉会**自己唤醒自己**，正是 10-02 那场"AI 对着幻觉答一整轮"的事故换个入口复发。
> 通用判据：**任何 prompt / context / hotword 改动，验收里必须有一条"空输入"用例**，
> 断言"回来的东西不含我给它的话"。只测真话那一侧，永远测不出来。

于是改在文本侧（④），并且按坑 49 的"词 + 它该有的邻居"约束：`既要/记要` 只有紧邻
`生成|整理|总结|发|出|给…` 时才改成「纪要」；句中出现「又要」（并列连词的信号）整条不替换——
「既要保证质量又要加快进度」必须原样。

#### 5.49.4 念出来的话 ≠ 显示出来的话（`Tts.speakable`）

用户点名："纪要声明后边很长的那名字就不说了，费时间。" 「/minutes/945328/2026-10-05T22-33-07-终稿.md」
被逐字念出来要十几秒。修法：合成前洗一遍——**链接只留名字、路径换成「（文件）」、代码块换成「（代码块）」**。
关键约束是**两条播报轨（服务端 MP3 与浏览器朗读）必须共用同一套规则**，否则换引擎就换措辞
（坑 47）；`test:asr` 里有一条专门比对两轨的规则表。

#### 5.49.5 `latMs=0` 现在带着"为什么"（`fin`）

只有 `silence`（RMS 证明人停了）才能算"说完→定稿"；`max-open / max-age / gap / flush`
都发生在人还在说的时候。本轮把定稿原因以 `fin` 同时写进 `asr-caption` 和字幕账本，
于是延迟读数为空变成**可解释的空**。顺带修了自测自己：qwen 还在预热、这几句走 whisper 兜底
（单段 8~10s > 6s 时长保险丝），每句都以 `max-age` 定稿、读数诚实归零，而断言把这种
**降级路径的正常形态**报成了"读数丢了"。同轮还抓到一个**错的数**：日志里
「答案上屏→听到首段 23.5s」是配对配错（入会致辞也是 `from='ai-bot'`），按"音频之前最后一条应答"
配对后真实值 **2.4s**——如果一个数能让你去优化一个不存在的问题，那它比没有数更危险。



### 5.50 兜底要有时限、计数要去恒真、布局要看图：一次"它答应了却不说话"的收尾（2026-10-06）

这一轮没有新能力，全部在把**已经写好的东西证明它真的成立**，而且三次都是被自己的量具绊倒。
三件事各自对应一条可以复用的判据，值得单独记一节。

**① "等对方说一句道歉"的兜底，必须回答"对方说不出来怎么办"**

AI 语音有两条轨：服务端神经音色（MP3）与浏览器 `speechSynthesis`。设计是"服务端可用 → 浏览器让位"，
服务端合成失败就补发一条 `ai-tts-fail` 让浏览器**回落朗读**。这个设计对不对，取决于两个隐含假设：

| 隐含假设 | 现实 |
|---|---|
| 服务器总会说出那句"我发不出" | 它写在流水线收尾，而收尾 `await` 所有合成任务；Edge 内部超时 12s、并发闸只有 2 路 → 长答案最坏 20s+ 才承认 |
| 只要链路走完就一定会说 | 应答链路在收尾**之前**抛错（外层 catch 只打日志），这句话永远不会说出口，前端那笔回落账挂着不销 = 永久无声、零报错 |

修法分三层，**每一层都不可省**：

1. **决定要有截止时刻**（`TTS_DECIDE_MS = 8s`）。但截止时刻要**按引擎能力定**：
   显式打开 `aiTtsLocalWait` 的人买的就是"好听但慢"（本地神经音色一句实测 5~20s），
   统一 8s 会每次都抢在它前面把它判死——那个配置就此变成空转。
   ▎同一道理见字数预算：`slowEngineOnly` 才限 48 字。**约束按引擎的能力来定，一刀切等于给可用引擎降级。**
2. **合成预算显式写在调用点**（Edge 6s）。健康值是 1.4s/句，四倍余量；
   下游本来就配了"发不出就让浏览器念"，等满 12 秒买不到任何东西，只买到 12 秒静音。
3. **客户端自己装保险丝**（20s 到点没等到任何交代就自行回落），并且**回落时把这一轮的 ts 记进
   "不再念"的集合**——修了 1、2 之后"决定先于音频"第一次成了正常时序，
   不记就会浏览器念着、服务端音频晚到又叠一层（双声）。

配套还补了一条测试接缝 `TTS_FAKE_FAIL=1`（判在缓存之前）：Edge 端点可达性随网络出口漂，
没有这条缝，"探测通过、真合成失败"就只能等网络自己坏一次才验得到。
**桩/接缝缺一种能力，等于那条分支永久不测**——而且没有任何东西会红。

**② 计数断言里混进"恒存在的事件"，正向对照就永远绿**

`test:asr-live` 数"AI 应答了几次"时收的是所有 `from='ai-bot'` 的消息，而 AI 入会那句
「🎧 已接入…正在聆听」也是这个来源。后果有相反的两半：

- `must(应答 >= 1)` —— 致辞恒存在，**这条永远不会红**。它自称是"它真的接话了"的正向对照，实际什么都没证。
- `must(应答 <= 2)` —— 名额被致辞白占一条，于是"2s 分段把一句话切成两截、两截各自成句"
  这种正常形态会报成"应答风暴没刹住"。

一条断言同时会假绿又会假红，是最难查的量具。修法是入口就过滤掉致辞。
▸ 同族问题两个月前在 `test:e2e-asr` 上修过（气泡匹配要排除入会致辞），当时没 grep 全仓，
  于是自测这一处又活了两个月。**同项目同一个坑只修一半 = 半迁移 = 等于没修。**

**③ 布局改动的验收必须看图，不能只看数**

屏幕共享在宫格视图里和摄像头一样大，里面的文档字号等于没共享。第一版让共享格 `span` 两列，
三条几何断言全绿（宽度 2.04 倍、横向零溢出、`object-fit=contain`），**一张截图当场露馅**：
只放大一轴会让同一行的普通格变成"半块高 + 底下一片空黑"，行底边参差。
正解是横竖同倍数（`grid-column/grid-row` 都 `span var(--screen-span)`），
判据也随之从"够不够宽"改成"宽高比是否与普通格一致"。

▸ 那个 `--screen-span` 由 JS 量 `gridTemplateColumns` 数出列数写入，而不是 CSS 直接写 `span 2`：
  窄舞台只有 1 列时 `span 2` 会凭空造一条隐式列，右边那块被 `overflow:hidden` 裁掉——
  **把画面裁掉正是这次要修的病，不能换个地方再犯**（同一个教训的第三次：别猜别人的尺寸，量）。

**④ 顺手把"跨网"从每次自愈改成配一次就长期对**

新增 `sfu/nets.js` 作"本机该对外说哪个 IP"的唯一实现。真正的难点不是拿到列表，是**排序**：
一台开发机上 WLAN / VirtualBox / WSL / Docker / Tailscale 全都挂着"看起来像局域网"的地址，
挑错一个就是"本机全好、别人黑屏、日志一行异常都没有"。判据写成可断言的打分函数，
并新增 `npm run test:nets`（17 项）。配置侧新增 `announcedIp: "auto"`——
写死 IP 的真实下场是它会随 DHCP 漂，而 `"auto"` 是**不需要被兜底**的状态。

**教学要点回顾**：这一轮三个真缺陷，每一个都是"代码看起来完全正确"的那种——
 
- 让位闸挡住了回落路径（02d）→ 回落路径自己也走闸（坑 66）；
- 兜底信号发得太晚 / 可能永远不发（本轮）→ 兜底的时限要由我方耐心决定（坑 94）；
- 断言里混进恒真事件（本轮）→ 计数前先问有没有恒真的东西（坑 95）。

它们的共同形状是：**"我以为有人会负责"的地方，要没有一个负责者时怎么办**。

**⑤ 最贵的一条：按钮文字不是状态机（换过一次麦克风，声音就自己关了）**

这一条是被长跑工具"冤枉"出来的。`test:voice-longrun` 连续几个版本报告"定稿 0 条、识别一段时间就停了"，
而它自己的开麦逻辑是"按钮文字不是『静音』就点一下"——第 43 步给按钮加了**两层同样的字**之后，
`textContent` 读到的是「静音静音」，于是它连点三下把麦克风关掉，再报产品坏了。
顺着同一处写法查进产品代码，发现 `switchMic` / `switchCamera` 里各有一行一模一样的东西：

```js
newTrack.enabled = muteBtn.textContent === '静音';   // ← 永远 false
```

后果：**用户换过一次输入设备，麦克风（或摄像头）就自己关了**，日志还写着"已切换（成功）"，
界面上的图标也停在"未静音"那一套。这是"加入会议以后识别失败 / 用一会儿就不行"的
第四块独立成因——和端口撞号（10-04g）、能量闸错位（10-05）、听觉管线停更都不是同一件事。

▎判据：**给人看的字符串不许当机器的判据。** 它会随图标、动效、i18n、文案改版而变，
  而它坏掉的方式是"静默反转"——不抛错、不报错，只是永远走另一个分支。
  状态的唯一来源应该是**轨道自己**（`track.enabled`），按钮文字只是它的一个视图。
▸ 同一条纪律在项目里已经第三次应验：坑 77（`el.textContent = …` 把同节点的图标一起抹掉）、
  坑 82（同一份配置三处读取器只有一处写）、这次（同一个载体既当视图又当状态）。
  ▸ 防守做成了结构断言：冒烟里出现 `xxBtn.textContent === '…'` 直接红。

---

### 5.51 参数单位、噪声底，以及"量具能不能读出 0"（2026-10-06 下午）

> 这一节讲的都是**同一个主题**：我们以为在测的东西，和代码真正在测的东西，常常不是一回事。
> 三个具体故事，每个都留下了可重跑的 A/B 证据。

#### 5.51.1 `astats` 的 `reset` 是"每 N 帧"，不是"每 N 个采样"

AI 耳朵的录音命令里挂着一条"每 0.5 秒报一次响度"的滤镜：

```
-af astats=metadata=1:reset=8,ametadata=print:key=lavfi.astats.1.RMS_level:file=-:direct=1
```

原先写的是 `reset=8000`，理由是"16000Hz 每秒 16000 个采样，8000 就是半秒"。
**错在单位**：`reset` 数的是**帧**，一帧固定 1024 个采样 —— `reset=8000` = 512 秒才重置一次。

于是那一行读到的永远是从进程启动到现在的**累计**响度：只要之前有人说过话，
静音段的读数就被垫高到 -22dB 左右，"这人说完话了"这个判定**永远不成立**。
后果是一条链：不判静音 → 句子只能靠 10 秒的文本空闲保险丝收口 → 每句都被切得七零八落 →
⏱ 延迟读数按"诚实规则"显示为量不到 → 用户体感就是"识别一段时间就停了、延迟还很大"。

▸ **怎么确认的**：用 ffmpeg 直接跑一份"说 2 秒 + 静 3 秒"的音频，两种写法各来一遍。
  新写法静音段读到 `-inf`，旧写法读到 -22dB 级。**三行诊断日志胜过三次盲改**（坑 76 同一条）。
▸ **判据**：外部工具的参数名相同、单位不同是常态（ffmpeg 里 `reset` 是帧、`length` 才是秒）。
  凡"照直觉写出来的单位"，都要用一次**能区分对错**的实验钉住，而不是靠它跑起来没报错。

#### 5.51.2 阈值要跟着"这台机器的底噪"走

有了正确的窗，还剩一半问题：判定"有人在说话"的门限原先是一个绝对值（-50dB）。
一台开着空调、或者笔记本自动增益把底噪顶起来的机器上，人声和噪声都挤在门限下面，
表现与上一节一模一样——**只是原因不同**。

现在的判据是：`阈值 = min(绝对上限, 最近噪声底第 20 百分位 + 6dB)`，样本不足 8 个时**不猜**。
A/B 用的是同一份合成音频：安静麦克风从 **0/300 判有声 → 235/300**；
而吵房间因为被绝对上限钳住，**行为与修前一字不差**（这条反向对照很重要：
"更灵敏"很容易写成"什么都算说话"，那会把碎句问题放大而不是解决）。

> ⚠️ **本节这一条已被 2026-10-07 夜修正，请以 [5.55.4](#5554-一条常绿的断言保护的是一个 bug本节最贵的一段) 为准。**
> 错的就是上面那句加粗的"与修前一字不差"——它当时被当成**安全性质**写进断言，
> 而"修前"的行为是：房间底噪 −43 比阈值 −50 **更响** ⇒ 每一帧都判"有人在说话" ⇒
> 静音永不确认 ⇒ 三句话粘成一条 blob。判据现在是**双边钳位**
> `clamp(噪声底+6, −74, −42)`（上端那条硬线是为了不把安静麦克风用户弄聋）。
> 教训入册为 **AGENTS 坑 115**：反向对照要钉"这个场景本来该是什么行为"，不是钉"和昨天一样"。
> 上面 0/300 → 235/300 那半个结论**仍然成立**（安静档阈值 −66，一字未变）。

▸ 与坑 91（三把拿响麦克风定的尺子）是同一条纪律的第二段：**绝对阈值 + 外部世界 = 必须问"这数是谁定的"**。

#### 5.51.3 ★ 量具必须能读出 0：AI 表情的三次尝试

用户说"AI 助理的动态效果还是没有变化"。要回答这句话，只能拿像素说话。
我做了三版量具，前两版**都是绿的，而且都是错的**：

| 版本 | 做法 | 结果 | 为什么是错的 |
|---|---|---|---|
| 一 | 截"脸那块矩形"，700ms 后比像素 | Δ38.4（绿） | 矩形里还挂着跳动的波形条、逐字打出的字幕，以及音频驱动的亮度律动——**动的是别人的像素** |
| 二 | 用 `ctx.drawImage(img)` 取图元当前帧 | Δ0（绿） | Chrome 的 drawImage 只画动画 WebP 的**第一帧**，它看不见屏幕上正在播的东西 |
| 三 | 先按停所有非脸的律动、隐藏波形与字幕，再截同一块矩形 | 静帧 **Δ0.11** / 真口型素材 **Δ14~33** | ✅ 两个方向都能量出来 |

判据就是这次得到的：**任何"变化检测"型量具，先做一次"故意让它不该变"的实验**
（换成静图、断掉输入、停掉源），它必须读出≈0。只能报"变了"的量具，它报的绿灯毫无价值。

> 附带一条：我一度想用"嘴部差值 − 额头差值"当判据（差分能抵掉整体变亮）。
> 实测不行——这套口型素材连头一起动，额头也跟着变，差值被压到 7 上下，薄得像掷硬币。
> **差分判据要先问"干扰项是不是两边同等"**；这里"整块在闪"另有
> "speaking 时头像不再跑 CSS 动画"一条独立断言守着，各司其职比一个复合指标好。

#### 5.51.4 顺带挖到的两条"看起来静止"的真缺陷

量具修对之后，用户报的现象有了两个和动画无关的解释，都在 `sfu/public/client.js`：

1. **重复广播把随机调度饿死**。头像的偶发小动作是"排一个 7~14 秒的定时器"，
   而这段排程原先挂在每一条 `ai-state` 消息上，且函数第一件事是"清掉正在等的定时器"。
   服务器每建一条听觉管线就广播一次 `listening`（每个开麦的人一次、重连一次、换设备一次）。
   广播间隔只要短于 7 秒，等待就永远从头再来 → **小动作一次也演不出来**，而日志里毫无痕迹。
   ▸ 判据：**"重新安排"必须是"状态变了"的函数，不是"消息到了"的函数**（坑 90 的排程版）。
   ▸ 另一半同样必要：定时器进回调时要先把句柄归零，否则"手上有没有排程"读到的是旧值，第一条修法形同虚设。
2. **格子建得比状态消息晚**。状态先到、AI 格子后建，定时器到点时那张脸还不存在，回调直接 return，
   而这条链上没有任何地方会再排一次 → 从此永远静止。修法是在"建格子"的那一处补排一次。

这两条都不是"动画写得不够"，而是**接线时机**——这也是本项目反复出现的形状：
模块都对、调用点也对、中间那条线没人测（坑 41/56/73 同族）。

#### 5.51.5 两句可以带走的话

- **观测手段不许改变被测对象**：量具按停了页面的动画，就必须在 `finally` 里原样恢复（坑 84）。
- **红的其实是采样时机**：`e2e-asr` 的"正解命中"以前读"第一条定稿那一句 + 轮询瞬间的快照"，
  2 秒分段把长句切碎之后，关键词在快照里就是不在了——改成**累积轮询期间看到的每一条定稿**才算在测产品；
  同一次跑里"白板像素"也从"读一次"改成"等到出现为止"（B 页刚记到一个 3 秒长任务，
  笔迹到了但落在重排之后，单次读取撞在"还没画"那一刻）。

### 5.52 版本指纹、真账本复盘，以及"黑边该拿什么填"（2026-10-06 傍晚到夜里）

> 上一节（5.51）与再上一节（5.50）本来同号，是同日两轮改动撞出来的编号重复——这里顺手把下午那节改成 5.51。
> 编号重复在文档里不会报错，只会让"见 5.50"这种引用变成两句不同的话（坑 47 的文档版）。

> 这一节的四条，全都是**"把已经做过的事证明它真的到了用户手上"**：
> 代码改对了 ≠ 用户那边生效了 ≠ 数字能代表真人好用。

#### 5.52.1 版本指纹：让"我改了，你那边还是旧的"自己说出来

坑 40（Service Worker 绕过 HTTP 缓存头）修完之后，防线其实变成了两条**靠人记的规矩**：
改代码的人记得 bump `?v=`，看的人记得硬刷新。而用户报"AI 还是不行"的时候，
真相往往就是他那台还跑着旧版——本项目实测过不止一次。

现在的做法是把"版本"变成服务器与页面**共同持有的一份事实**：

```js
// 服务器：按内容哈希改写 index.html 里那几个会变的资源引用
function assetVersion(name) { /* sha1(文件内容)，缓存键 = mtime + size */ }
html.replace(/((?:src|href)=")(\.\/)?(client\.js|style\.css|countup\.js)(\?v=[^"]*)?(")/g, ...);
// /config.json 里同时下发 assetVersions，页面拿自己**实际加载到的** ?v= 与之比对
```

三个细节值得学：
- **哈希而不是时间戳**：内容没变就不该出现"新版本"，否则每次重启都提醒一遍（假警告比没有警告更糟）；
- **一致时不许弹**：横幅的显隐由**比对结果当下**决定，不做"报过一次就常驻"的锁存；
- 那个「用最新版打开」的按钮**保留查询串**——用户可能正在会中（`?room=…`），
  一键把他踢回首页是修一个不便制造一个事故。

▸ 读自己加载到的版本时踩过一个坑：`vendor/mediasoup-client.js` 的结尾也是 `client.js`，
  不加路径边界 `(?:^|\/)` 就会拿它的版本当自己的，于是自检**永远读不到版本**、静默失效。

#### 5.52.2 邀请面板：一处构造、双向赋值、失败兜底只写一次

"跨网那条链接"此前只写在流程日志里——日志在界面最底下还会被折叠，等于没有。
这一处 30 行的前端改动，教的其实是三条通用纪律：

1. **一个概念一个构造点**：`lanInviteLink()` 与 `crossInviteLink()` 各只有一处拼查询串，
   徽标、顶栏按钮、面板两行全部调它们。两处各拼一遍，迟早有一处漏掉 `?room=`，
   而"对方点开是首页"是这条功能最难自查的坏法（链接看着是完整的）。
2. **"没有就藏"必须两侧都写**：原先是 `if (cfg.tsUrl) tsUrl = cfg.tsUrl`——只写"有值"那一侧。
   于是页面活着期间撤掉 Tailscale，`tsUrl` 永远留着旧值，紧下面那句注释声称的
   "配置改回去按钮也不会骗人"就是**假的**。正解 `tsUrl = cfg.tsUrl || null`：
   "没有"也是一个要能被表达、被落地的状态（坑 76：机制在、从来没生效过）。
3. **兜底只写一次，三处才会一样好**：`navigator.clipboard.writeText` 在非 HTTPS 上下文里
   会直接 reject。原先三个调用点各写一份 try/catch，只有徽标那处写了失败提示，
   另外两处失败是**静默的**——点了按钮没反应，用户只会以为"链接没生成"。

▸ 还有一条断言写法值得记：「点徽标展开且同一趟点击没把它关掉」和「点外面会收起」**必须成对**。
  只写前一条，"document 上那条监听根本没挂"也能让它绿；两条一起写，才互相证明。

#### 5.52.3 `review:meeting`：判断"能不能用"，去看真账本，别只看自测

这个项目有一百多条回归，全部跑在**合成语音 + 固定节奏**上。它们能证明"代码没写错"，
证明不了"真人开会好用"——而这两件事在本项目**相反过两次**：
10-03 自测说定稿 1.4s，用户真实会议的账本量出来是中位 3.9s；10-05 全套自测全绿，
而真会里那个人的语音峰值只有 -56dB，被能量闸当静音删掉了。

于是把"读账本"做成一条命令：`sfu/captions/*.jsonl`（字幕账本）+ `sfu/logs/app-*.jsonl`（结构化事件）。
每一行结论都必须带样本量，样本不够就报 ❔（**❔ 不是 ✅**）。三个真实数据逼出来的修法：

| 写法 | 为什么会说谎 |
|---|---|
| `碎片 0/0 条（0%）✅` | 那场会根本没有定稿标记，0÷0 被算成"通过" |
| `连续性 ✅（未见停摆）` | 只有 3 条字幕——**没观察到 ≠ 观察到了没有** |
| 文件名过滤器 `slice(-12,-6)` | 少算一位 ⇒ 永远筛出 0 个文件 ⇒ "今天没有会议记录"，而这句话听起来完全合理 |

▸ 判据**复用生产代码那一个函数**（`Asr.noiseRiffReason` / `isDupOrFragment` / `normAsrText`）。
  复盘脚本自己另写一份"什么算噪声"，报告说的就和系统做的不是一回事了（坑 47）。
▸ 最有价值的一行是**从账本反推参数版本**：当前闸门是 -62dB，凡是峰值高于它却仍被跳过的段，
  说明那场会跑的不是现在这套参数——"我改了呀怎么还不行"第一次有了不用问人的答案。

#### 5.52.4 黑边拿什么填：一个 CSS 技巧与一次量具自我纠错

屏幕共享必须 `contain`（文档边缘被裁掉等于没共享），但 `contain` **一定留边**，
而暖墨底上的两条死黑边读起来像"贴图坏了"。比例由对方决定（16:10 笔记本、竖着的代码窗口、
4:3 老 PPT），不能为了填满去裁 ⇒ 只能让那块地方不再空着：**同一帧放大模糊垫在底下**
（Zoom / 腾讯会议的 fit 模式是同一招）。

实现上有个取舍值得记：为什么用**第二个 `<video>`** 而不是 canvas 逐帧画？
两个 video 元素共用同一条 `MediaStream` 时**解码只有一份**，而 `filter`/`transform`
都是合成层属性——模糊与缩放在合成器里做，主线程零工作。canvas 方案要自己跑 rAF + drawImage，
每帧一次主线程开销（第 28 步的滤镜管线就是这么算 CPU 账的）。

▸ 加这个子元素时踩到坑 103：它一旦插在格子里**第一个**位置，所有 `querySelector('video')`
  都会拿到这块糊的（画中画会弹出一窗模糊画面，而且不报错）。正解是**追加到末尾 + 层级交给 z-index**。
▸ 还有一次量具自我纠错：为了证明"走光边框真的在动"，第一版拿"卡片内部像素不变"当对照——
  可这张卡是磨砂玻璃，它内部本来就在跟着背景动。第二版拿 `prefers-reduced-motion` 当对照，
  结果它把环境也一起停了，两个零相减等于什么都没对照。第三版拿环带**平均**变化当判据，
  亮头只占周长约 6%，一平均只剩 1。**终版分三层**：读原因（`--ac-angle` 在不在长）、
  **只暂停这一条动画**比峰值与热点数、数环上亮像素。教训一句话：
  **对照实验的"关掉"，必须只关掉我正在量的那一个变量。**


### 5.53 会背题不等于会泛化：一次拿"真实账本"给规则判红（2026-10-06 深夜）

> 这一节的四段，围绕同一件小事：**规则是我写的，句子也是我写的，于是我的测试只会测我记得的东西。**
> 用户那句"AI 操控实体类的功能还是实现的不行"重复到第五次，我才换了个数据源去量它。

#### 5.53.1 背题型电池：全绿的测试测的是记忆，不是能力

`test:asr` 里有一组"房间动作"电池：32 句自然指令（「把白板打开」「切到宫格」「上字幕」……）
全部命中，一条不红。而用户的抱怨一模一样没变。

于是换一种输入：**写 28 句从未进过规则表的口语**——不查代码、不看电池，只按"开会的人真会怎么说"写：

| 说出来的话 | 期望 | 首跑实得 |
|---|---|---|
| 弄个白板 | 打开白板 | 什么都不做 |
| 白板不用了 | 关闭白板 | 什么都不做 |
| 字幕先停一下 | 关闭字幕 | 什么都不做 |
| 把刚才画的都擦掉 | 清空白板 | 什么都不做 |
| 刚才那一笔不要了 | 撤销一笔 | 什么都不做 |
| 把说话的人放大 | 切演讲者视图 | 什么都不做 |

**13/28 命中 = 54% 缺口**，比上一次量出来的 26% 更严重。为什么会这样？因为电池和规则
是同一只手同时写的：我为了过断言补的那几个动词，自然就进了电池；电池于是只覆盖
"我想到过的说法"。而真人的说法来自另一种心情——口语会**省宾语**（"撤销一下"）、会**倒装**
（"白板不用了"）、会用**量词**（"整一块白板"）、会带**礼貌前缀**（"能不能给我配个字幕"）。

三条可以复用的做法：
1. 电池里**明确标一组"泛化组"**：写完规则之后再专门塞新句子，这些句子在写规则时并不存在；
2. 泛化组第一次跑**要允许它红**（它的职责就是暴露，不是通过）；
3. 泛化不能只在纯函数里绿——同一批句子挑几句进**真浏览器**断言"界面真的动了"
   （`test:room-actions` 从 11 项加到 17 项）。"读对了动作 id"和"页面动了"之间
   还隔着一次广播和客户端那张表，中间任何一段没接上，用户看到的仍然是"我说了它不动"。

#### 5.53.2 中文的否定：中间夹一个轻动词，守卫就整条例了

「别切宫格，把白板打开」这句，旧代码会把**宫格执行掉**——用户说"别"，界面反倒切了。

原因很具体：这条命中的片段是名词「宫格」，而否定副词「别」和它之间夹了一个动词「切」。
旧守卫写的是"看命中点前面那几个字，末尾是不是否定词"：

```js
// 旧：要求否定词紧贴命中点
const NEG_RE = /(别|不要|不用|…)\s*$/;         // 面对 "别切|宫格" → 末尾是"切"，判不出否定
// 新：允许中间夹一个轻动词 + 一个插入语
const NEG_RE = /(别|不要|…)\s*(再|去|把|帮我|给我)?\s*(切|换|到|弄|开|关|收|…)?\s*$/;
```

这里有一个**值得停下来想的取舍**：为什么不干脆"整小句里只要有否定词就全部压掉"？
试了，更糟。语音送来的句子**常常没有标点**，「不要开白板把字幕关掉」按小句判会把后半句
一起压掉——用户要的"关字幕"反而不做了。判据是：

> **少做一个动作是可以补的（再说一遍就行）；做错方向是要人手动改回来的，代价不对称。**

所以只做**窄扩展**。并且用 A/B 证明这条断言真的能红：拿旧守卫的副本跑同一句，
旧 `["view-grid","board-open"]` → 新 `["board-open"]`，同时原有 10 条否定反例
（「别关字幕」「不要取消字幕」……）一条都没被误伤。**能红、又不牵连别的**，才算哨兵。

#### 5.53.3 ★ 改文本判据必须拿真实语料回扫：我这次正好写死了用户最常用的那句

上一段修 ③ 的时候，为了收「把会议录下来」，我在越界表里加了 `录(下来|一下)`。
中文没有词边界，于是：

```
「把这条记录一下」 →  记[录一下]  →  被规则当成"开录制" → 明确拒绝
```

这一句在 `sfu/captions` 的 **3332 句真人字幕里出现 11 次**，是用户对 AI 说得最多的一句求助，
而且它**本来真能办**（记进待办与纪要）。我把用户最常问的那件事，改成了一句"这个我不做"。

最要紧的地方是：**纯电池一条都不会红**。那 28 句泛化句子里恰好没有"记录一下"，
反例组也都是"我想到过的反例"。把它抓出来的只有**换数据源**这一件事：

```js
// 把真实账本的每一句拿去过一遍当前规则，数误触率
for (const line of 真实字幕) if (detectOutOfScopeCommand(line.text)) 误拒++;
// 修前：14 句被误拒   修后（(?<!记)）：1 句（那还是一句噪声幻觉，不是人话）
```

于是这件事没有停在"我下次记得扫一遍"（纪律一定会被忘掉，见坑 40 同一条教训），
而是变成**三处常驻**：
1. `npm run review:meeting` 每间房多一行「**指令回扫**」——按**当前**规则重放这场会的人话，
   报"读成动作 N 句 / 判越界 K 句 + 占比 + 一个例子"，人话不足 10 句报 ❔ 而不是"没问题"；
2. `test:review` 自检 +4 条，其中一条是**反向对照**："真祈使句必须数得出来"——
   没有它，这台仪表可以永远绿着，等于白装（坑 105 那条纪律的又一次应用）；
3. `test:asr` 加两条：记事求助不许被拒 + 全量账本回扫的上限断言。

顺带一个正则知识点给初学者：`(?<!记)录` 叫**否定后顾**（negative lookbehind），
意思是"匹配'录'，但它前面不能是'记'"。Node 与 Chrome 都支持。中文里没有空格分词，
所以"某个字组成的词会不会被别的词吃掉"必须显式写出来，不能靠人自觉。

#### 5.53.4 量过之后决定不做的事，和"上次没跑通"到底是不是代码问题

同一次回扫还纠正了**我自己读错的一处数据**——这个比发现缺陷更值得学。
第一版我把账本里所有**非 bot** 的条目都当成"人说的话"，于是得出
"3332 句里有 18 句会被读成房间动作，多数是 AI 自己的回答被麦克风收了回去"。
听起来是个真缺陷，我差点为此写一条"AI 说过就不执行"的抑制。

核了 `asr` 字段才发现：**其中 13 条是 AI 自己写进账本的存档回答**（`asr:false`、
`name: "AI 小明"`）——它们不是"有人说了这句话"，只是被存在同一张表里。
真正的**麦克风转写**只有 864 句，其中被读成动作的 **3 句**，而这 3 句
（「帮我开白板再白板这画」「小明，你打开白板」）**全都是真命令**。

⇒ **误触发 0，那个"回声自触发"的现象本来不存在**。要修的从来不是规则，
  而是**回扫的口径**（只数 `asr === true`）。

▸ 两个可以带走的一般结论：
  1. **报出一个现象之前，先确认每个字段的语义**——"这条数据代表有人说了这句话吗？"
     答错了你会去修一个不存在的 bug（这正是 5.52 那条"把没证据报成通过"的镜像：
     口径写错会**编出**一个证据）。
  2. 断言从"逐句金标准清单"改成**比例 + 样本量**（触发率 ≤2%、样本 <50 不下结论）。
     逐句清单会在用户说出新命令的那天变红——那是一条只会制造假红的断言。

另一件是**上一轮的遗留**：`test:voice-longrun`（真浏览器 5 分钟语音长跑）上次报"没跑通"，
两次都在浏览器启动阶段 CDP 超时。这次**没改那台工具一行代码**，只是等机器空出来再跑：
**7/7 全绿**——5 分钟 **31 条定稿，31 条全部是 `fin=silence` 收口**（不是靠 10 秒保险丝硬切）、
最大停摆 14s（红线 60s）、听觉进程 0 次崩溃 0 次永久放弃、AI 应答 28 次、
定稿延迟 **min 1.3s / 中位 1.8s / max 3.1s（n=31）**。

▸ 教学点：**"换个时间再跑一次"本身就是排查手段**。会移动、会自愈的失败，
  十有八九不在产品代码里（坑 80/87）——但结论要等它**真跑绿**那天才敢写下来，
  上次那句"没跑通"就该一直挂着，不许提前写成"已修复"。

#### 5.53.5 一句"喂假麦克风的话"写了四遍，以及复盘工具怎么改口

上面那条回扫做完，顺手查了一件事：`test:e2e-asr` / `test:e2e-reconnect` / `test:voice-longrun`
三个测试里，"要给假麦克风念哪几句中文"是**各自写一份**的，而 `review:meeting` 要分辨
"这场会是真人开的、还是我自测跑出来的"依据的恰恰就是这几句。同一个概念四处各写一份，
迟早有一份漂掉，而漂掉的后果是**复盘把自测当真人会议来数**（坑 47）。

于是把句子收进唯一一份（`scripts/voice-fixture.js` 的 `FIXTURE_SENTENCES`），三个测试改成引用它。
注意几件事：

- **字符串一个字符都没改**。这些句子和测试里的关键词断言绑死（"评审会""纪要"），
  改了句子就是改契约——所以合并只做"引用同一份"，不做"顺手统一措辞"。
- 同时导出 `looksLikeFixtureCaption(text)`：拿**大元组覆盖率 ≥0.6** 判"这句像不像念稿"。
  为什么不是相等：ASR 会把一句切成「一下明天下午三点的。」这种碎片，还会把"评审"写成"庭审"。
  为什么要设长度下限（<6 字不下结论）：「小明」两个字在任何一句里都出现，拿它当证据会到处命中（坑 53）。

有了这一份，`review:meeting` 就**必须改口**——它页脚原先写着：

> 本报告**不区分**真人会议与自测跑出来的房间（账本里没这个事实）。

这句话现在不成立了。留着它是什么后果？下次有人看到某场会延迟很差，去查那台服务器，
而那其实是我自己 5 分钟前跑完的 e2e。**过期声明比缺失更糟**（坑 82 的文档版）：
它会让人不去查一个已经变了的事实，也会让人去查一个不存在的毛病。

新加的「谁在说话」行给三档，而不是"命中过半算自测场"两档。理由是真实数据撞出来的：

```
房间 204534：21 条定稿里 10 条命中 fixture = 48%
  两档 ⇒ 报"真人场"（因为 <50%）
  但那里几乎每两句就有一句在念稿 —— 这个结论与直觉相反
```

一条判据在边界上给出与直觉相反的结论，说明**边界画错了位置**，不该怪那条数据（坑 53 同一条）。
所以：≥50% 自测场、20%~50% 混合场（有念稿成分）、<20% 真人场、定稿 <5 条报 ❔。

最后一条纪律值得单独记：新页脚**没有**写成"本工具已能区分真人场与自测场"。
它写的是"这是基于句子像不像念稿的**启发式**，真会里有人复述同一句也可能被标"。
因为**过度自信的声明与过期声明是同一种病**——都会让人拿着它做决定，而它撑不住。

---

### 5.54 「不叫小明，小明就不说话」：一个讲得通的设计怎么在真实场景里变成故障（2026-10-06 夜）

用户的话是：「这是一个正常的会议，如果不提到小明的名字小明不应该说话，只有叫到小明的时候小明才会说话思考回答。」
听起来像"把某个开关关掉就行"，实际牵出三条独立成因，而且**每一条当年都有正当理由**。

#### 5.54.1 先看账本，别先看代码

`sfu/captions/cap-286716-20261006.jsonl` 是用户抱怨的那一场：

```
21 条麦克风转写  →  只有 4 条提到名字  →  AI 应答了 18 次
「拍卖啊！」「咳咳。」「爱丽。」「你把手机放了吧。」 全被接话
```

这一步很关键：如果你不去数账本，你会以为是"唤醒词识别错了"，然后去改唤醒表——
而真正的元凶是一个 20 秒的窗口。**症状的形状要靠数据分诊，不能靠印象。**

#### 5.54.2 滚动续期的"免检窗口"，在输入源源不断时等于闸门失效

原设计（09-28）：AI 答完之后的 20 秒内，大家继续说话不用再喊名字——理由很正当，
"人跟人聊天不会每句都先叫对方名字"。**但它假设这是一场和 AI 的对话。**

真实会议的麦克风是常开的。于是：每次应答都把窗口往后推 20 秒 ⇒ 只要有人不停说话，
窗口**永远不关** ⇒ AI 把整场会都当成对自己说的。

> ▎通用判据：**"刚才发生过 X"不能当作"现在这句话与 X 有关"的证据。**
> 凡是"一段时间内放宽判据"的机制（免唤醒窗口、滑动续期 token、最近活跃就免检），
> 都要先问一句"**这段时间里输入是源源不断的吗？**"——是，那这个窗口就不是"便利"，是"闸门常开"。

修法不是把 20 秒调成 5 秒（那只是把闸门开小一点），而是**换成按"这一句是不是在叫它"判**，
并把窗口留成配置项（`aiChatWindowSec`，默认 0）+ 环境变量（`AI_CHAT_WINDOW_SEC`）——
后者是专门留给 A/B 的：**没有 env 开关，就无法证明这条断言在旧行为下会红**。

同一时间还关掉第二个"没人叫它也开口"的入口：`maybeAiSpeakUp` 的主动播报
（`aiProactiveSay` 默认 false）。注意它关的是**说**，不是**记**——看板照旧记账、纪要照旧生成。
"记"与"说"是两件事，把它们混成一个开关，就会出现"想安静一点就得放弃纪要"。

#### 5.54.3 唤醒判据要从"像不像名字"改成"是不是在叫它"

旧表一张 `[小晓笑孝筱][明鸣名铭茗米民密蜜命]` 把两类东西混在一起了：

* **明 / 鸣 / 名 / 铭 / 茗**：跟在"小"后面，中文里几乎只可能是叫它；
* **米 / 民 / 密 / 蜜 / 命**：`小米`（品牌/人名）、`小民`、`救命`、`密码` 都是**日常词**。
  那场比赛里的「说**小命**的话，他是最应该听见话」就是这么醒的。

所以分两层：强后缀任意位置都算；歧义后缀**必须再有称呼语境**（你好 / 帮我 / 打开 / 查一下…）。
为什么不干脆删掉歧义那一档？因为 10-05 的真机实锤是模型把「小明」写成了「**你好 小米** 下面」——
删掉就退回"我叫了它它不理"。**判据要窄，但不能窄到把真实输入砍掉。**

这里还踩了两次同一个中文老坑（**跨词命中**）：称呼词表第一版收了裸「在不」，
于是「如**在不**不」命中。中文没有词边界，两字 token 一定会跨词，所以只收多字说法。

#### 5.54.4 关掉窗口之后必须补的那一条：被分段切断的半句

纯唤醒模式有个必然副作用：分段窗口 2 秒，「小明，把纪要生成一下」会被切成
「小明。」+「把纪要生成一下。」——后半句没有名字，按新规则就不该答，
于是用户体验变成"喊它它不理"（这正是 10-05c 修过的那个抱怨会换个形式回来）。

补的不是"把窗口调回来一点"，而是一条**语义完全不同**的窄通道：

| | 追问窗口（默认已关） | 分段续接（一直在） |
|---|---|---|
| 什么时候开 | AI 答完一句之后 | **只在**上一轮只听到名字时 |
| 能用几次 | 窗口内每一条都算 | **一次性**，用完作废 |
| 会不会续命 | 每答一次顺延 20s | **不顺延** |

它回答的是"帮机器把一句话说完"，而不是"接下来几秒它都在线"。
**两个概念共用一个开关，就会有一个的概念被另一个绑架。**

#### 5.54.5 ★ 用户驳回了我一半证据，而他是对的

我把测试里那些「小明。/ 帮我记一下明天下午三。/ 点的评审会。」贴出去当结论，用户说：
**"你测试的音频乱的不像话。"** 这句话拆成两层，两层都得认：

1. 那些碎句是 **2 秒分段的原始切片**，不是界面上的一句话——我把中间产物当成了结果；
2. 更要紧的是：合成 fixture 每一句都写着「小明，…」，它**结构上测不出"没叫它也答话"**。
   拿这种音频说"唤醒逻辑验证通过"，等于拿自己写的题目考自己还考了满分。

于是停掉一件事、补一件事。**停掉**：正打算做的"用合成音频比 2s/3s/4s 分段谁更准"——
本项目已经因为"拿合成数据调生产阈值"翻过一次车（10-05e：放宽闸 → 下一环垃圾字幕）。
真人账本里 2 秒分段只有 3 场会、说话人各不相同，**样本量不支持任何结论**，所以 `asrSegmentSec` 一行没动。

**补上**：把判据搬到真实数据上，做成常驻仪表（`npm run review:meeting` 多两行）：

```
唤醒回扫：21 句人话按当前判据会醒 5 句 · 靠歧义写法醒的 0 句
          · 这场会实际应答 18 次，多出的 13 次来自已关闭的追问窗口/旧宽表 ⇒ 那场跑的是旧规则
字幕形态：平均 11.7 字 · 中位 8 字 · 最长 35 字 · ≤4 字碎片 33% · ≥25 字长条 10%
```

第一行顺手回答了那句"我改了呀怎么还不行"：**差值就是证据**——旧场次应答次数远大于
当前规则会醒的次数，说明它跑的是旧代码，要重启。第二行则把"识别不准"拆成
两个方向相反的病：被**切散**（碎片率）与被**粘住**（长条率），处方完全不同，
只报一个平均值就等于没报。

#### 5.54.6 三条可以带走的一般规律

1. **一个开关只管一个概念**：把"要不要接话"从"多久之内免检"里拆出来，
   把"记下来"从"说出来"里拆出来，把"续接被切断的半句"从"追问窗口"里拆出来。
   共用开关的组合，最后一定变成"想调 A 必须连带牺牲 B"。
2. **仪表必须能读 0**：新加的 `npm run check:wake` 把 21 句真实账本喂给**浏览器里的**判据函数，
   再拿它跟服务端逐句对表；然后把浏览器那份换回旧宽表复跑，看它**是不是精准红在那两句上**
   （「说小命的话」「我买了个小米手机」）。只会绿的仪表与复用到别人服务器的绿测试是同一种东西。
3. **数据比想象力便宜**：这次真正找出问题的不是那 130 条单元测试（它们全绿），
   而是用户账本里的两句闲聊。以后动"从自然语言里判意图"的任何规则，
   验收都要包含一次真实语料回扫（坑 106 / 107 到这条已经是第三次同一形状的事故）。

### 5.55 「识别太笨」不是模型笨，是我们只给它 2 秒：整句重转，以及它当天暴露的两个自己人（2026-10-07）

用户那句"识别的太笨了"听起来是抱怨模型，实际是一次**架构级**的问题。这一节讲三件事：
怎么把"笨"变成一个可复现的数字、一个新机制怎么在同一天反噬自己、
以及一条**常绿的断言怎么把一个 bug 冻结了一整天**。

#### 5.55.1 先承认一件事：我们只给模型 2 秒

听觉管线的形状一直是这样：

```
ffmpeg 持续分段（asrSegmentSec=2）→ 每段单独转写 → 用 mergeTranscript 把碎片拼成一句
```

分段是为了低延迟（说完不用等一整句），但**中文的词会被切在段边界上**。
当晚真跑打印过的病灶，原样抄在这里：

| 说的是什么 | 分段转出来 |
|---|---|
| 服务器 | 「服务。」+「起负载」 |
| 生成 | 「升」+「乘」 |
| 评审会 | 「评审。」+ 幻觉「怎会？」 |

最后一行最说明问题：**模型在只听见「评审」这两个字时，会自己补出一个词**。
它不是笨，它是**没有上下文**。

#### 5.55.2 一次对照实验（而不是"我觉得应该更好"）

同一批生产函数、同一段音频，只改"喂进去的粒度"：

| 粒度 | 逐字全对 | 多余字数 | 模型总耗时 |
|---|---|---|---|
| 2s 分段分别转再拼 | 1 / 6 | 6 | 4.34s |
| 整句一次转写 | **3 / 6** | 4 | **3.22s** |

注意第二列**不是 6/6**——整句也不是保证，只是把"能听对的机会"从 1/6 抬到 3/6。
这句话很重要，因为它决定了下面 5.55.4 的诚实记账。

落地方式：`uttAudio` 攒下这一句已经封口的 PCM 段（上限 12 秒，内存有界），
定稿前一次喂回模型，然后**由一个纯函数决定要不要采用**。
为什么必须是一个纯函数、必须有"不采用"的分支：

> 万一那一次整句推理失败、被清洗成空、或只转出半句，
> 无条件替换就是**为了修准确率而把人说的话弄丢**。丢字比切错词严重得多——
> 用户的原话是"要真正能用"，不是"要好看"。

#### 5.55.3 采用判据要长什么样（以及它自己踩的坑）

第一版只有三条，方向是"新比旧少要怀疑，新比旧多放行"：空的不换、一样的不换、
少掉四成以上的不换（用**比例**不用绝对字数，因为 2 字的「小明。」和 40 字的长句
不能用同一个"少 6 个字就不许换"）。

当天真跑就把第四、第五条逼了出来。`TEST_ASR_DEBUG=1 npm run test:asr-live` 复跑**由绿转红**，
现场是这一对：

```
拼接  「…明天下午三点的评审」
重转  「…明天下午三点的评审器真不错,拍麦亚。」   ← 多出来的是一整句别人的话
```

为什么重转会多出一句？因为那一轮房间很吵，**静音确认整条失效**（5.55.4），
三句话被粘成同一条 utterance，于是攒下的音频里**本来就含着下一句**——
重转只是如实转了出来。危害有两层：这条字幕更乱；更要紧的是变长的那条
会让**下一句的正确定稿被去重闸吞掉**（账本实测只剩 1 条）。
一次"修准确率"换来"丢一整句话"。

于是补两条膨胀上限。**但第一版把它们做成了无条件判据，立刻杀错了对象**：

```
拼接  「今天天气很大 武器真不错 拍卖呀」   （13 字、没标点）
重转  「今天天气真不错,拍麦呀！」           （更短、词全对、只是补了标点）  → 被拒 ❌
```

判据问错了问题。该问的是**"它听见了比这一句更多的东西吗"**，不是"标点多了吗"——
而一条**变短**的重转，结构上不可能藏着别人的句子。所以两条上限只在"变长"时才生效。

> 可以带走的一般规律：**为"可读性"动一个文本判据时，必须回头检查它有没有把自己正在保护的东西切掉。**
> 只写正例的判据，等于只测了自己的想象力。

#### 5.55.4 一条常绿的断言，保护的是一个 bug（本节最贵的一段）

"此刻有没有人在说话"这个判断，决定了一句话什么时候定稿。
2026-10-06 那版把它做成自适应的：`min(绝对阈值 −50, 噪声底 + 6dB)`，
注释里专门写了一句**卖点**：

> 吵房间 ⇒ 阈值仍被 −50 钳住 ⇒ **与今天一字不差**（只增灵敏度，不增误判）

并且真有一条断言钉着它。它绿了一整天。

它保护的是什么呢？当晚的诊断行把事实摊开了：

```
voiceThr=-50.0  floor=-42.9  →  1444 帧 RMS 里 495 帧判"有人在说话"
```

房间底噪是 **−43 dBFS**，而阈值是 **−50** —— **底噪本身就比阈值响**。
于是每一帧都被判成"有人在说" ⇒ `lastVoiceTs` 永不超时 ⇒
静音永不确认 ⇒ 句子只能等 10 秒保险丝 ⇒ **三句不相干的话粘成一条 blob**。
用户那句"识别这么乱"的一半就是这个 blob，而一条**常绿的断言正在保证它不被修好**。

改成双边钳位：`clamp(噪声底 + 6, −74, −42)`。两条线各挡一种过头：

- 下端 `−74`：再安静也不往下追，否则一次呼吸、一次翻页都被当成"有人在说"；
- 上端 `−42`：**绝不比这更迟钝**——因为把句子分开，不能以把
  2026-10-05d 那批 −56 dBFS 的安静麦克风用户**整个弄聋**为代价。

改完的 A/B（同一份 fixture，可红可绿才算证据）：

| 场景 | 旧版 | 新版 |
|---|---|---|
| 吵房间（底噪 −45 / 语音 −28） | **180/180 帧底噪被判有声** | 7/180（且那 7 帧是攒够样本前的暖机，另有断言守着） |
| 中等房间（底噪 −60） | 阈值 −54 | **−54（一字不差）** |
| 安静房间（底噪 −72） | 阈值 −66 | **−66（一字不差）** |

> **这条坑的名字叫"与修前一字不差"**（AGENTS 坑 115）：
> **"不改变旧行为"从来不是一条安全性质，它只是把旧行为冻结下来。**
> 反向对照要钉的是"**这个场景本来应该是什么行为**"，不是"和昨天一样"。
> 写"与修前一致"之前，先回答一句：修前在这类输入上**到底对不对**。

还有一个方法论值得单独抄一遍：发现它**不是靠读代码**——读代码时"只增灵敏度"听起来完全正确。
是靠**换数据源**：让自测把 `voiceThr / floor / 有声帧数` 摊开打印出来。
以后凡是"某个阈值决定了某个闸门"的地方，日志里就要有那个阈值和那个底噪的**当前值**。

#### 5.55.5 同一轮掉出来的两条真缺陷（都不是新写的代码，是一直在的代码）

1. **丢尾**：装句尾字的那一段还没被消费，定稿闸就放行了
   （挑"已封口的段"那条规则**永远跳过最新那段**）。于是「…评审会」的「会」
   凭空落进**下一句**的音频账本。修法：定稿前先看一眼"还有没有尾巴段没消费"。
2. **秒和毫秒混在一个表达式里**：

   ```js
   AI_ASK_TAIL_MS = Math.max(2000, Number(env.ASR_ASK_TAIL_SEC) || 6) * 1000;
   //                              ↑ 下限是毫秒语义      ↑ 括号里是秒语义
   ```

   取 max 之后 2000 胜出 ⇒ 6 秒变成 **33 分钟**（日志实证 `tailUntil剩余=1981680`）。
   症状不是报错，是**行为变成鬼**：只要有人喊过一声"小明"，之后半小时谁说话它都接——
   正是用户最反感的那件事。修法之后立了一条纪律：**一个表达式里不许同时出现秒和毫秒**；
   凡是 `* 1000`，左右两边必须都在"秒"这一侧。

#### 5.55.6 这一节的三条可带走规律

1. **粒度是一种输入**。换粒度 = 换输入分布，必须重测准确率，而不是"延迟降了所以更好"。
2. **新机制要有"触发计数 + 采用计数"两本账**。只有计数不知道它对不对；
   只打印采纳过的那些，就永远看不见它在帮倒忙（当晚：采纳 1 次、拒绝 3 次）。
3. **"和昨天一样"不是正确性**。断言要么钉住"本该如此的行为"，
   要么就是在给现状背书——而现状可能是个 bug。

#### 5.55.7 一个新机制的代价要在**它变贵的场景**里量（H5 / H5b）

上面的整句重转所有数字都是**单人**量出来的。而真实会议是 8 个人轮流说，
它们排的是**同一个单进程 worker**（一个必须先查清的事实：`ASR_CONCURRENCY` 那个信号量
只包 whisper CLI，而 qwen-local 直写 worker 的 stdin，排队发生在 Python 那一侧——
所以"生产有两路并行"是误读）。

于是写了 `npm run bench:asr-multi`：直接压真实的 qwen-local worker，把"几个人在说"当自变量，
三个档位对着比（只分段 / 每句都重转 / 重转但忙时让路）：

| 并发 | 分段 p95：基线 → 每句重转 | 吞吐保住 | 让路档 |
|---|---|---|---|
| 1 路 | 0.60s → 0.37s | 112% | **让路 0 次**（重转照做 3 次） |
| 4 路 | 1.48s → **2.02s** | **75%** ❌ | 1.45s（×0.98）· 92% |
| 8 路 | 2.80s → **4.20s** | **75%** ❌ | 3.01s（×1.08）· 94% |

处方是**忙时让路**：worker 还在处理别人的段时，这一句直接用拼接结果收口。
没有采用路线图原本写的"只给要送给 AI 的那句做整句"——那会把字幕质量在多人房里整体退回去，
而字幕正是用户抱怨的第一件事。

三件方法论在这半节里各出现一次：

1. **判据的参考点是"不做这件事时是什么样"，不是凭空定的毫秒数。**
   第一版判词用"分段 p95 ≤2500ms"评处方，于是 8 路那一档明明已经把 p95 拉回基线，
   仍被判成失败——因为**基线自己**就有 2.80s（那是这台 worker 的容量线，属 H1，不属重转）。
   错的判据会把人推向"关掉一个已经修好的东西"。
2. **反例守卫：让路做过头 = 功能整个不跑**，而报告上看起来与"延迟修好了"一模一样。
   所以"单人档一次都不许让路""多人档不许一次都不让"两条都要写进量具的判词。
3. **三本账分开**：`发起 n / 采用 fixed / 让路 skipped`。
   只有前两本，"一直在让路所以什么都没做"与"做了但都被 `preferRefined` 拒了"分不开（坑 76）。
   对外也各有出口：`/metrics` 的 `sfu_ai_asr_refine_skipped_busy_total`、
   以及"此刻到底有多忙"的那条 gauge `sfu_ai_asr_engine_busy`。

最后一件值得单独记：**看到 blob 先确认此刻是哪台引擎。**
同一套代码，加不加 `TEST_ASR_WAIT_WARM=1` 会给出两种结论——不加时它会红在
"没叫它的那句一条字幕都没转写出来"，而日志显示那一路走的是 **whisper 兜底、单段 10.7~11.2s**：
段在排队、句子在堆积，粘成 blob 与阈值判据毫无关系。
把降级路径的正常形态当成产品回退去改代码，是本项目第五六次踩到的同一形状（坑 57 家族）。
> ▸ **2026-10-09 改口**：这件事后来在**全量回归**里原样复发了一次（红点还是那句闲聊没字幕），
>   而这次的受害者是"忘记加那个环境变量的人"——也就是我自己。于是把它改成**默认就等主引擎就位**，
>   要测降级路径反而要显式写 `TEST_ASR_WAIT_WARM=0`；同时自测会把"喂音频那一刻主引擎到没到"
>   印进失败信息里。**判据：需要额外开关才能测到"用户真实配置"的测试，迟早会红错方向**——
>   默认值应该指向"用户在跑的那条路"，例外要人主动声明。

#### 5.55.8 容量这件事第一次被量出来：一条串行队列 ⇦ 按成员分片的 worker 池（H1a）

5.55.7 那张表里"8 路基线自己就要 2.80s"这一行，当时只能写一句"那是 worker 的容量线，属 H1"。
这一节把那条线**变成一个可以选择的旋钮**，顺便说清为什么它的默认值仍然是"老样子"。

**问题的形状**：`qwen-local` 是一个常驻 Python 进程，一次只能转一段（自回归推理）。
8 个人轮流说话时，第 8 个人的字幕排在前面 7 段后面——**这不是网络慢，也不是模型慢，是排队**。
面试里这句话值钱："我知道我的瓶颈在哪一层"。

**做法（两句话）**：把原来那个单例整体包进 `makeSlot()`（自愈那套预算/重启/冷却/判死**一字未改**），
外面挂 1..4 个槽；每次转写按**是谁说的话**决定走哪个槽。

**为什么是"按成员稳定分片"而不是轮询**——这是本节最容易设计错的一处：

> 同一个说话人的段必须**按顺序**回到同一句话的文本流里。
> 句内归并（`mergeTranscript`）、"尾巴段还没消费就不许定稿"（`pendingTailSegment`）、
> 整句重转攒的那段 PCM 账本，全都隐含假设"这一段属于这个人、且不会插进别人的段"。
> 轮询会让甲的第 2 段排在乙用的那个 worker 上、比甲的第 1 段先回来 ⇒
> 症状是"字幕半句颠三倒四"，而**日志里没有任何异常**。

这和 5.55.7 那条"ASR 的账要按人记"是同一条纪律的并发版：**共享的可变状态一旦按"事件"排队，
就必须按"实体"分区**（坑 58 早说过"并发测试要覆盖 ≥2 个实体"，这一节是它的原因）。

**槽死了怎么办**：先看属于我的槽，它被判死就退到**任意一个活着的槽**（宁可慢，别没人转）；
全死才返回空串——空串回到 `sfu/server.js` 会自动落 whisper 常驻 worker，**这段话不会丢**（10-05 立的规矩）。

**实测，以及"实测"这两个字要付的税**（`npm run bench:asr-multi`，8 路 + 开着让路，**同一场次跑 1→2→1 三次**）：

| 池 | 分段 p95 | 吞吐 |
|---|---|---|
| 1 个 worker | 3.14~3.18s | 2.59~2.62 次/秒 |
| 2 个 worker | **1.78s** | **4.30 次/秒**（≈1.65 倍） |
| 再跑 1 个 | 3.14s | 2.62（落回原值 ⇒ 差值不是"GPU 越跑越快"换来的） |

为什么非要跑第三次：第一版结论是拿"上一场的 1 槽 2.73s"比"这一场的 2 槽 1.34s"，
而本机 GPU 空闲时钟只有 285MHz，**冷跑和热跑差到一倍以上**。
▎**跨时间比的数不是实验结果。**（坑 117）

**为什么默认还是 1**：一个 worker 常驻 **≈1.9GB 显存**（两个同跑 `nvidia-smi` 读到 5.0GB），
而这台 8GB 卡上还住着浏览器视频解码与 whisper 兜底。显存不够时 torch **不报错**，
它只是悄悄把推理退回 CPU——于是"扩容"买回来的是更慢，而没有任何一行日志说明原因（10-04e 实测过）。
所以这条旋钮必须由人显式拧，并且开机前就有人替他算一遍：`npm run doctor` 的 **A7d** 就是这笔账
（配 1 个 → ✅；配 4 个 → ⚠️ 并直接给出改小的命令；把预留余量设成 0 → 又 ✅，
三档一起才证明**是那根线在做功**，而不是它恒绿）。

**"配了"不等于"起了"、"起了"不等于"活着"**：`/metrics` 因此有三条
（`sfu_ai_asr_qwen_workers` / `_alive` / `_in_flight`），`/api/rooms` 交出每个槽的 `{alive, dead, restarts}`。
只看配置数会把"2 号槽早就判死了"读成"扩容没效果"（坑 76 的第三次应验）。

最后一条留给写代码的人：**取值优先级只许有一份**。
`resolveWorkers(env, config)` 放在池模块里并导出，服务器和 doctor 都调它——
两处各写一份，将来就会出现"体检说配了 2 个、服务器实际起了 1 个"这种**没人会去怀疑的矛盾**（坑 47）。

---

### 5.56 ★ 共享文件浏览：不装任何库读 Word / Excel / PPT，以及"所有人同时看到同一页"怎么做到（2026-10-08，第 51 步）

这一节是全项目**技术密度最高的一节**，但它只用一句话就能说明白要做什么：
**开完会之后，房间里每个人屏幕上都是同一份文档的同一页。**

它拆成三个问题，每一个都值得单独讲：

1. **怎么在没有 pdf.js / mammoth / sheetjs 的世界里把 Office 文件画出来**（本项目的红线是零依赖 + 可离线）；
2. **怎么让"我在看哪一页"这件事同步**（一个状态、多人、还会随时有人晚进来）；
3. **怎么保证别人上传的字节不会变成我屏幕上的可执行代码**（这是新功能里唯一会死人的一条）。

#### 5.56.1 先看清文件格式长什么样：Office 2007+ 就是"一个 ZIP 包里的几份 XML"

把任何一个 `.docx` 后缀改成 `.zip` 双击打开，你会看到这样的目录：

```
word/document.xml          ← 正文全在这里
word/_rels/document.xml.rels  ← "关系表"：rId → 文件路径（图片、超链接都靠它）
word/styles.xml            ← 样式（"标题 1"长什么样）
word/numbering.xml         ← 编号（哪些列表是 1.2.3，哪些是 •••）
word/media/image1.png      ← 内嵌图片
[Content_Types].xml        ← 每个部件的类型声明
```

`.xlsx` 里是 `xl/worksheets/sheet1.xml` + `xl/sharedStrings.xml` + `xl/styles.xml`，
`.pptx` 里是 `ppt/slides/slide1.xml` 一张幻灯片一个文件。**三者是同一个家族（OOXML），只是词汇表不同。**

于是"读 Office"被拆成两件朴素的事：**解压 ZIP** + **解析 XML**。
而 ZIP 里的 deflate 解压，浏览器 2022 年起就自带了：

```js
const ds = new DecompressionStream('deflate-raw');   // Chrome 103+ / Edge / Safari 16.4+
```

▎**注意是 `deflate-raw` 不是 `deflate`**：ZIP 存的裸 deflate 流**不带 zlib 那两字节头**，
用 `'deflate'` 会直接格式错。这是这类实现最容易踩的第一脚。

所以 `sfu/public/fileview.js` 里那几百行"ZIP 读取器"就是它的全部魔法：
从文件**尾巴**往前找 `EOCD`（中央目录结尾记录，它告诉你目录在哪、有多少条目），
顺着中央目录把每个条目的「压缩方式 / 压缩后大小 / 本地头偏移」抄进一张表，
取谁才解谁（**不预解压**，一份 docx 里几十个部件，通常只用得到三四个）。

顺手补一条 **ZIP64**：Office 存大图片/大表格时，尺寸字段会填 `0xFFFFFFFF` 这个"哨兵值"，
真实数字躲在额外字段 `0x0001` 里——不认它，一份大 PPT 就报"不是合法的 ZIP"。

> **教学点**：`openZip()` 只读结构、`read(name)` 才解压；
> 报错永远带上**是哪个条目**（`解压 word/document.xml 失败：…`）。
> 一份 docx 里有几十个部件，一句"解压失败"等于没说。

#### 5.56.2 三种文档各自"最难的一件事"

| 文档 | 表面上是 | 真正要处理的是 | 一句话讲清 |
|---|---|---|---|
| **docx** | 段落流 | **列表是符号还是编号**、表格的跨列、图片、超链接 | `w:numPr` 只说"这个段落属于哪个编号定义"，是 • 还是 1. 要去 `word/numbering.xml` 查 `numFmt`；图片靠 `a:blip@r:embed` → 关系表 → `word/media/*` → 拼成 `data:` URL；超链接只有 `TargetMode="External"` 才敢变成 `<a>` |
| **xlsx** | 二维表 | **日期不是日期，是"数字 + 数字格式"** | 单元格里存的是 `45122`，靠 `xl/styles.xml` 的 `cellXfs → numFmtId` 才知道它是日期；内置日期格式 id 是 14~22/27~36/45~47/50~58，自定义的得看格式串。更绕的是格式串里的 **`m` 既可能是"月"也可能是"分钟"** ⇒ 判 `datePartsOf` 时先剥掉 `[hms:]` 那些"时间串"再找日期字母，否则 `h:mm:ss` 被当成日期、把 0.5 换算成 1899 年 |
| **pptx** | 一堆图片 | **坐标系是 EMU，字号要跟着卡片缩放** | 1 pt = 12700 EMU；幻灯片尺寸在 `p:sldSz` 里，形状位置在 `a:xfrm`（但**表格在 `p:graphicFrame/p:xfrm`**，两条路都要读）。要"一页幻灯片"在窄卡片和宽画布里都好看，就不能写 px，得写 `cqw`（容器的 1%）+ `container-type: inline-size` |

> **为什么旧版 `.doc/.xls/.ppt` 不做**：那是 1997~2003 的**二进制复合文档**（OLE CFS），
> 没有公开的稳定结构，任何"零依赖也能渲染它"的说法都是吹牛。
> 本项目的做法是**如实报**："这个文件在线看不了 —— 这是 1997~2003 版的二进制 Office 格式……
> 可以点右上角「下载」用本机的软件打开"。
> **能清楚地说出自己不做什么，比含糊地多做一件事更有价值**（答辩时这一条几乎必问）。

#### 5.56.3 最贵的一脚：同一段代码在 Node 全绿、在浏览器**永久卡住**

浏览器分支第一版长这样（**这是错的**，代码里留着注释）：

```js
const w = ds.writable.getWriter();
await w.write(b);
await w.close();                                     // ← 卡在这里
const buf = await new Response(ds.readable).arrayBuffer();  // ← 读者在下一行才诞生
```

`DecompressionStream` 是一个 **TransformStream**：**写侧要等读侧把队列排空才收工**。
而这里 `await w.close()` 卡住的时候，唯一会去读 `ds.readable` 的那行代码**还没执行到**——
关闭在等读者，读者在等关闭。这叫**自死锁**，它的失败形态是：
**整条 promise 永远不 settle**，不抛错、不超时、控制台干干净净。

于是现象是"点了 Word 文件，界面一片空白"，而 `npm run test:fileview` 的 178 条断言**全绿**。
为什么全绿？因为 **Node 18+ 也有全局 `DecompressionStream`**，
而当时的判据顺序是"浏览器分支在前"，Node 里 writer/close 的调度恰好不同，**测试跑的是同一条有毛病的路的另一副身体**。

三件修法缺一不可：

```js
// ① 判据顺序换过来：能力更弱但更确定的 zlib 先判（Node 走同步那条，根本没有流背压这回事）
if (typeof require === 'function') { /* zlib.inflateRawSync */ }
// ② 浏览器分支自己拿 reader 从头排，write/close 不 await
w.write(copy).catch(() => {});
w.close().catch(() => {});
const run = async () => { for (;;) { const { done, value } = await r.read(); /* … */ } };
// ③ 给"卡住"上保险丝：卡 = 报错，而不是沉默
return await withWatchdog(run(), INFLATE_WATCHDOG_MS, (ms) => `解压卡住了（${ms/1000}s 没回话）…`);
```

**测试怎么补才算补上了**（`test:fileview` 的 G2 组）：把 `fileview.js` 装进一个
**没有 `require`/`module` 的 vm 上下文**里加载 —— 于是 `defaultInflateRaw()` **只能**选浏览器那一支，
测的就是浏览器里真跑的那几行，而不是我另抄的一份。每条 await 再包一层 `within(p, 8000)`：
旧写法在这里会红成"8s 没回话"，而不是悄悄通过。

> **通用判据（这条比这个 bug 值钱）**：凡"平台分支"（浏览器/Node、真机/模拟器、同步/异步），
> 验收要**分别证明每一支都被执行过**。一条分支只在一个运行时被覆盖，
> 就等于另一个运行时的上线**没有测试**。见 `AGENTS.md` 坑 **118**。

顺带两条同一处的安全线：
* **解压上限**（`MAX_INFLATE_BYTES = 64MB`，可用 `{maxBytes}` 压低）——ZIP 压缩比能做到 1000:1，
  一兆的 docx 里塞 1GB 的 XML 完全合法。**测不到的安全线等于没有**，所以判据支持把上限调小来测；
* **报错要说人话**：解压器抛的 `TypeError` 有时候 `message` 是空的，
  直接冒上去用户看到的就是"未知错误"。所以每条解压失败都补齐"哪个条目 + 多少字节 + 可能原因"。

#### 5.56.4 同步模型：一个状态、N 个人、还会随时有人晚进来

这一段是本功能**设计上**最值得讲的部分。要同步的东西是"谁在带大家看哪一页"，形状有四个坑：

**① 权威只有一份，放在服务器。** `room.fileView = { name, page, scroll, zoom, byId, byName, ts }`。
不是"谁发我转给谁"，而是"房间现在在看什么"——于是**问一句就能答**，新人也能补。

**② 连续量节流，离散事件绕过节流。**
滚动是每秒几十次的连续量（不节流会把信令当带宽用）；
但"换文件""翻页"是低频、高价值的离散事件，**必须立刻到**——
否则最该被立刻同步的动作反而被限流吃掉了（这条很容易写成一刀切）。
服务器侧的判据长这样：

```js
const discrete = !prev || prev.name !== (next && next.name) || prev.page !== (next && next.page);
if (!discrete && now - (room.fileViewSentAt || 0) < FILE_VIEW_MIN_MS) return next;  // 只有连续量被节流
```

**③ 位置传**比例**（0~1），不传像素。**
每个人的浏览器窗口高度都不一样，传像素的话"我滚到 800"到了 4K 屏上就是半页。
`ratio = scrollTop / (scrollHeight - clientHeight)`，还原时反着乘回去。

**④ 断环：照别人做的那段时间，不许再往外广播。**
两个跟随者如果都"把自己的滚动上报出去"，就会互相拽着滚 —— 这是**回声**，
和网络里的桥接环路是同一类问题。客户端用一个标志位把这一小段时间闸住：

```js
let applyingRemote = false;             // 正在照别人的状态改自己
function emitFileView(immediate) { if (!myRoom || applyingRemote) return; /* … */ }
```

还有两个形状上的坑：

* **晚进来的人**：服务器在他进房那一刻**单播** `files-state`（清单 + 当前视角 + 配额），
  **空清单也要发** —— 因为"没有文件"是一个**事实**，而沉默会让前端去猜（猜错就成了"面板是坏的"）。
* **看得见"跟着谁"**：界面上写明「跟着 小张」。同步这件事必须**可见**，
  否则用户只会觉得"屏幕自己在动"，而不知道是谁在带、怎么关掉（这是产品感，不是技术细节）。

#### 5.56.5 安全：别人上传的字节，凭什么不会在我电脑上执行

两条防线，**缺一不可**：

* **渲染层**：所有文字**先转义再拼接**（结构上不可能产出用户给的标签）；
  链接只放行 `http/https/mailto/tel` 与相对路径，`javascript:` / `data:` 一律降级成纯文字，
  **并且先删掉控制字符与空白再判**（否则 `java\tscript:` 绕过）；
  属性上下文要**另转引号**（`fileAttr()`）——转义文本和转义属性是两种判据，只做一个必漏。
* **服务器层**：下载路由对**不在内联白名单里的扩展名**一律
  `Content-Type: application/octet-stream` + `Content-Disposition: attachment` + `X-Content-Type-Options: nosniff`。
  白名单只有 `pdf png jpg jpeg gif webp bmp ico avif` —— **`.html` 和 `.svg` 是有意不放的**
  （SVG 里可以带 `<script>`，浏览器直接打开就是 XSS 执行器）。

> 为什么两道都要有：只有前端转义，遇到"用户点右上角下载、在新标签里直接打开"就漏了；
> 只有服务器 attachment，遇到前端自己 `innerHTML=` 渲染 markdown 也漏了。
> `check:files` 里那条 XSS 探针（上传一份写着 `<img src=x onerror=...>` `<script>boom()</script>` 的 .md，
> 断言页面里 `img/script` 节点数 = 0、文本是转义后的、`window.boom` 不存在）测的是**这两道一起**的产物。

存储层的形状也有三条硬规矩：**超配额当场 `req.destroy()`**（不收下来再拒，否则一个人可以拿内存换你的服务）；
**先写 `.part` 再改名**（进程被杀不留半个文件）；**台账与磁盘对账**
（清单里有、盘上没有 → 不列出来；"清单里有一份但点开 404"是最难查的那种坏）。

#### 5.56.6 这一步的测试为什么必须有**两个**浏览器

| 层次 | 命令 | 项数 | 它能证明什么 |
|---|---|---|---|
| 渲染内核单测 | `npm run test:fileview` | 190 | 字节进、HTML 出：结构对不对、转义全不全、ZIP/ZIP64/坏输入、**G2 组逼出浏览器那一支** |
| 存储层单测 | `npm run test:files` | 59 | 名字消毒/穿越/配额/对账/`.part` 卫生/`since` 下界，**并自证没写进真实目录** |
| 信令回归 | `npm run test:sfu` | 270 | 事件真的**到了两个客户端**、权限（房主/admin/本人）在服务器判、新人补发、删除清视角 |
| 前端冒烟 | `npm run test:smoke` | 495 | 假 DOM 里跑真代码：跟随/断环/结构红线（"打开只有一个入口"这类） |
| **真浏览器双窗** | `npm run check:files` | 33 | **第二个个人页面上真的出现了同一份渲染结果**；滚动按比例跟到同一行；XSS 只是文字；命中测试证明界面点得到 |

最后那一行是别的层**替代不了**的：信令测试只能说"消息到了"，
冒烟测试只能说"我的假 DOM 里状态变了"，
只有真浏览器能回答用户真正关心的问题 —— **"我同事的屏幕上现在是什么？"**

#### 5.56.7 一句话的可讲版本（面试/答辩）

> "我加了一个共享文件浏览：房间里的所有人能同时看到同一份文档的同一页。
> 技术上最想讲的是两点 ——
> 第一，**没有引入任何依赖**：docx/xlsx/pptx 本质是 ZIP 里的几份 XML，
> 所以我手写了 ZIP 中央目录解析（含 ZIP64）和一个容错 XML 解析器，
> 解压用浏览器自带的 `DecompressionStream('deflate-raw')`；
> 期间踩到一个只存在于浏览器侧的 **TransformStream 自死锁**，
> 它让 178 条 Node 单测全绿而界面一片空白，最后我把源码放进一个**没有 `require` 的 vm 上下文**
> 才把那一支真的测到。
> 第二，**同步模型**：服务器持有唯一的权威状态，只在变化时广播，
> 滚动这种连续量节流但换页这种离散事件绕过节流，位置传比例不传像素，
> 客户端再加一个断环标志位防止两个跟随者互相拽着滚；晚进来的人靠进房单播补发。
> 安全上做了两道：渲染层先转义再拼接 + 链接协议白名单，
> 服务器对所有非白名单类型强制 `attachment` + `nosniff`，SVG/HTML 有意不放行。
> 验收用了**两个真浏览器**，断言的是第二个人页面上的文字，不是消息有没有到。"

#### 5.56.8 这一节留下的债（知道自己没做完什么，也是能力）**★ 2026-10-08 凌晨第二轮 / 2026-10-09 两轮刷新**

> ▸ **2026-10-09 还掉的债**：当时列在最后的"用户那份真文件"这一条，以及一句新的——
>   用户说"**word 什么的还是不能观看**"。两条都不是 `.docx` 那三种新格式的问题，而是
>   ① 旧版 `.doc/.xls/.ppt` 被**整类**拒收（那句"请下载后查看"就是我写的），
>   ② 新格式里"文档确实有、但我没画"的那些形状（样式继承的编号 / 文本框 / 域代码的**结果** /
>   Excel 的百分数与货币格式 / 合并单元格）。**两条都做完了，方法与教训在 5.57**（两个外部裁判：
>   python-docx/openpyxl 与本机真 Word/Excel/PowerPoint COM）。
>   ▸ 仍然挂着的：旧版只还原**文字与逐格数据**（版式/图片/母版没做，界面上明说）。

* ~~PDF 那一路没有真浏览器证据~~ → **I1 做完了，但结论换了**：真浏览器里确实验到了
  `<iframe class="files-pdf" src="blob:…#page=1">` 存在、下发头配对、翻页换了 DOM 节点，
  而**"它真的画出来了"这句仍然只能由人来验一次**——无头 Chrome 的插件像素不可靠
  （同一页四次读到 34% / 49% / 94% / 53% 黑色占比），所以像素降为观察值、判分只押稳定层（坑 122）。
  ▸ 顺带抓到一条**从上线起就存在的缺陷**：只改 URL 的 `#page=` 片段，内置阅读器**一动不动**
  （规范把这算成"页内导航"）。这就是 5.56.9 第一条要讲的东西（坑 121）。
* ~~手机形态没量过（I2）/ 长跑没混文件流量（I3）/ 复盘仪表不认识它（I4）~~ → **三条全部做完**，
  数字在 `AGENTS.md` 顶部 10-08 第二轮那块里。
* **渲染还原的是文字与结构**，不是版式：不分页、不做页眉页脚/图表/公式/条件格式/母版继承。
  这是教学版与商业渲染器的真实差距，写在代码头部注释里，不藏在"支持 Office"四个字后面。
* ★ ~~还剩一条最难的债（I8）~~ → **I8 当晚就做了第一轮**，而且它立刻值回票价：
  新增常驻仪表 `npm run review:office`（只报结构统计、绝不打印内容），扫本机现成的 25 份真 docx/xlsx/pptx，
  **抛错 0、"成功但文字极少"0**，但抓到一条**限额作用域**的真缺陷（下一节 5.56.10 讲它）。
  ▸ 原来那条判断是对的：**夹具能覆盖的范围 = 我想得到的范围**（和坑 106 那台"泛化量具"同一件事）。
  ▸ 债没还完：这只是第一轮，而且扫的是**我这台机器上的 25 份**。真用户的文件形状更多，
    所以这台仪表留在仓库里，不是当纪念，是**下次拿到新样本就要再跑一次**。
  夹具是我自己写的，所以这组断言的天花板就是我的想象力（和 10-06 那次
  "规则表与电池同一只手写出来，于是电池只覆盖我想到过的说法"是同一条坑 106）。
  真正的验收方式是：**把用户手头那份真 .docx / .xlsx 丢进会议里渲染一次**，
  渲染不出的每一处，变成一条新夹具 + 一条新断言。

#### 5.56.9 第二轮学到的五件事（每件都值得单独讲）

**① "我明明设置了"不等于"对方重做了"——内置阅读器吃 URL fragment**
`fr.src = blobUrl + '#page=2'` 这行代码看起来完全正确：`src` 属性真的变了，DOM 里查得到，
不报错、不崩溃。但 PDF 插件把它当成**同一个文档内的页内导航**，于是画面纹丝不动。
量出来才看得见：夹具第一页画一大块黑、第二页留白（设计上相差 47 个百分点），
而翻页前后我数到的黑色占比是 **58.9% vs 58.9%**。
修法不是"绕一下"（先把 `src` 置空再赋值 = 闪两下），而是**换节点**：
把旧 `<iframe>` 移除、插入一个新的并带上完整片段——浏览器见到新元素只能整份重挂。
同时必须配一条"同一页不重建"的守卫，否则跟随主讲每 120ms 节流一次，画面就重启一次。
> 可复用的判据：**跨引擎 / 跨插件的"我设置过了"不算数，要量"对方因此重做了没有"**。
> 能读节点身份（前后是不是同一个元素）就读身份；读不到再退到观察值。

**② 量不稳的读数不配当判据——观察值也是一种工程决定**
发现 fragment 那条之后，我很自然想给"翻页真的换了内容"加一条像素断言。第一版红得随机，
第二版把阈值放宽就永远绿。根因在浏览器内部：无头环境的插件渲染时机与合成器截图**不保序**，
它画了，但没有一帧"稳定画好"的状态留给我抓。
于是这条判据被**降级成打印观察值**，并把"PDF 翻页看起来对不对"写进人工验证清单。
> 可复用的判据：**"能测"与"测得稳"是两件事**。会随负载/时机变化的数写成断言，
> 就是在给未来的自己制造假红（或者更糟——假绿）。

**③ 真实文件里的形状，比你以为的多：`w:vMerge` 那一格去哪了**
Word 的纵向合并在 XML 里长这样：起始格写 `<w:vMerge w:val="restart"/>`，
而**被合并掉的那几格依然存在、只是不带内容，并且 `w:vMerge` 不带 `val`**（缺值 = "继续"）。
照 DOM 顺序直接输出，结果就是"负责人"那一格只占第一行，第二三行各多出一个空格子——
表格右下角错位，而这份文档其实完全正常。
两个容易写反的细节：① `val` 判反（缺值当起始）会让**每一格都成为新的合并开始**；
② 列号必须按 `gridSpan` **累加**，否则一个横向合并格会把后面所有格子的列坐标推歪，
纵向合并就"对不上号"（rowspan 消失 + 多一格空白）。
> 可复用的判据：**解析器的正确性由输入形状的多样性决定**，不由"我能跑通自己写的示例"决定。

**④ 规则表写得越"像清单"，泛化缺口越大：中文口语用远指 + 量词**
我给 AI 的"开文件面板"写的规则，名词侧是一份字面清单：`文件面板|资料面板|文档面板|文件列表…`。
电池 15 句全绿。另写 30 句**从没进过这张表**的说法一测，**只命中一半**——
因为人说话是这样的：「把**文件那块**弄出来」「**共享资料那块**打开来」「文件**那栏**」「文件面板**亮起来**」。
▸ 口语指代一个界面，靠的是**远指 + 量词**（那块/那栏/那里），不是"面板"这个技术名词；
  而动词经常**倒装**到名词后面。所以名词侧要按**成分**拼：〔可选"共享"〕+〔文件|资料|文档|材料〕+〔可选后缀〕，
  动词**两侧都收**。
▸ 还有一个只有中文会有的陷阱：**"能"有两个身份**。
  「能看下文件清单吗」里它是情态动词（= 请求，该做）；
  「能力打开白板吗」里它和"力"是一个名词（= 问能力，不该做）。
  直接把 `能` 加进"礼貌请求"的词表会把后者也接走，所以例外要写成
  `/^(?:能|能否)(?!力)[^。，,]{0,3}(?:看|打开|…)/`——**句首 + 紧跟一个动作动词**，`(?!力)` 挡名词化开头。
> 可复用的判据：**加宽任何"从自然语言判意图"的规则，验收要同时跑三组**——
> 泛化组（新说法必须接住）· 谈论组（只是提到这个词必须不动界面）· 有意不接组（把取舍写成语句，别写成沉默）。
> 只跑第一组那种"全绿"，等于把 50% 的缺口换个位置再犯一次（坑 106 / 124）。

**⑤ A/B 也要证明"我改的那一行今晚跑了"**
按纪律我给新加的"文件清单对账"做了反向对照：把删除改成"只从台账抹掉、不真删"，预期当场红。
结果它**照样全绿**——因为那一轮只上传 2 份，而修剪分支的条件是"台账 > 保留上限(3)"，
被我变异的那一行**根本没执行**。把上限调到 1 再跑，立刻红。
> 可复用的判据：**变异路径没被执行过的 A/B，同样是假绿**。
> 所以 soak 现在自己报一句"传了 N 份却一个都没删 = 修剪分支今晚没跑过，这条绿不算数"——
> 把这条纪律写进工具，比写进我的备忘录可靠（坑 40：纪律会被忘掉）。

#### 5.56.10 I8：拿真实文件回扫，一条"每份文档 16MB"的上限被证明其实是"每页 16MB"

共享文件上线时，我给内嵌图片写过一行注释：`MAX_IMG_TOTAL = 16MB // 一份文档内嵌图片总量上限`。
今天第一次拿**真实文件**跑它（`npm run review:office` 扫本机磁盘上现成的 Office 文档，只报结构、不读内容），
第一份就中：一份 25 页、`ppt/media` 解压后合计只有 **7.5MB** 的 PPT，被渲染成
**61 条 data URL / 40.4MB 的 HTML 字符串**。

▸ 根因不在数值，在**作用域**：`total` 是 `collectImages` 里的局部变量，而 pptx 是**逐页**调用它的
  ⇒ 每页从零开始。写代码的时候谁都没错，只是"文档级"这个词从来没落到实现上。
  > 可复用的判据：**任何"总量上限"落地时都要回答"这根计数器活在哪一层"**
  > （每次调用 / 每页 / 每份文档 / 每个房间）。答错一层的上限，只在**足够大的真实输入**上才暴露——
  > 而那种输入恰恰不在我自己写的夹具里。

▸ 更值得记的是**我先把动机写错了**：看见 40.4MB 我立刻写下"面板一插入就冻住标签页"，
  并打算据此把上限砍到很小。为了不再凭感觉调数，我写了台量具（`npm run bench:innerhtml`），实测：

  | HTML 长度 | 首次 innerHTML | 替换插入 |
  |---|---|---|
  | 0.5MB | 3ms | 2ms |
  | 8MB | 37ms | 27ms |
  | 16MB | 63ms | 47ms |
  | 40MB | 145ms | 104ms |

  **字符串插入根本不是瓶颈**（40MB 也才 145ms），代价在内存与图片解码。于是注释与代码一起改口：
  那两条上限是"防无界增长的体验保险丝"，不是"超过就卡死的悬崖"。
  > 可复用的判据：**"我觉得它会卡"不是证据**。凡是拿性能当理由改数值，
  > 先把那个数值对应的物理量量出来；量不出来就别写进注释——
  > 注释里一句没量过的因果，会被下一个人当成事实继续往下推（坑 125）。

▸ 修完的形状是**两条账各答一个问题**：
  · `decoded` = 唯一图片的解压字节（同一张图只算一次、也只解压一次）→ 管**解码内存**；
  · `emitted` = 每次引用都算一次（一张 logo 引 20 页就是 20 份字符串）→ 管 **DOM 里躺多少字符**。
  这两个数天然不一样，硬用一个上限就会两边都判错。那份真 PPT 现在是 21 张图 / 10.7MB，
  并且界面上明说「为流畅起见省略了 40 张内嵌图片，下载可看完整」——
  占位方块只说明"这里曾有图"，说明不了"为什么没有"（坑 82）。
  ▸ 还有一条不显然但很重要：**"这格式浏览器画不了"与"预算不够被裁掉"不许进同一个计数**，
    否则那句"省略了 N 张"就在谎报原因（把 `.emf` 改名成 `.png` 塞进 PPT 是常态）。

▸ 顺带一条**量具自己更贵**的教训（坑 126）：这台回扫脚本第一版报"10516 字只渲染出 24 字，文字大量丢失"，
  我差点据此去改遍历器。三个版本之后发现两次都是**探针自己的错**：
  ① 正则 `<w:t[^>]*>` 会连 `<w:tbl>`、`<w:tc>` 一起吞掉（`[^>]*` 能吃下 `bl`）；
  ② 我按想象中的节点形状 `{children, text}` 读解析器输出，而真实形状是 `{tag, attrs, kids}`。
  > 可复用的判据：**用一次性脚本去"看"被测对象之前，先用被测对象自己导出的 API 看一遍**。
  > 判据与产品不同源，报出来的"缺陷"就有一半是量具的故障——
  > 而它最贵的地方不是白跑，是**会把你引向一次不必要的产品改动**。
  最后真正站住的产品结论只有一条，而且是把那两次探针错误排除之后才站住的：
  那份"文字极少"的文档确实**没有文字层**（扫描件），不是渲染丢了。

#### 5.56.11 第三轮：两条"把用户的意思做反了"的缺陷，各自是怎么被抓出来的

这一轮不加任何功能，只把第 51 步的证据打厚。厚到能压住东西之后，掉出来两条**用户能直接看见、
而代码一行都不报错**的缺陷。它们的形状很值得单独讲一次，因为**同一个错误我在这个项目里已经犯过三回**。

**① 「跟随主讲」按下去是"抢主讲"**

跟随的模型是"人人平等，最后动的人赢"，服务器只有一份权威 `room.fileView`。客户端两半判据只写了一半：

| 该挡的方向 | 写了没有 | 后果 |
|---|---|---|
| 关跟随 → 不**收**别人的视角 | ✅ `applyRemoteView` 里 `if (!filesFollow) return;` | — |
| 关跟随 → 不**发**自己的视角 | ❌ `emitFileView` 只有断环守卫 | B 只想自己翻两页，**全房被 B 拽走** |
| 再点一次"跟随主讲" → 我跳回主讲 | ❌ 处理器里写的是 `emitFileView(true)` | 那颗按钮在做与它文案**相反**的事 |

真浏览器双窗实测（修前）：`A 现在=评审结论.md`（本该停在 A 那份）、`B 现在=(没跳回来)`、
A 的徽标变成"跟着 某位成员"——**三个人里没有任何一个人知道自己做错了什么**。

> 可复用的判据一：**"开关式解耦"要当场问它挡的是单向还是双向。**
> 只挡收不挡发，症状不是"没反应"，而是"我一动大家都动"——比原来更糟。
> 可复用判据二：**按钮的文案就是契约。** 写着"跟随 X"的按钮不许产生"成为 X"的效果。

修法里有一条值得学：`rejoinPresenterView()` 不自己写"怎么跟"，而是**复用** `applyRemoteView()`
那条正路。因为"跟"这件事的边界已经很多了：面板没开要开、同一份只调页码与滚动、
主讲把文件关了就别把我的屏一起抽走、我自己发的那条不许回环……
重写一份 = 迟早两份不一样（这就是本项目反复记的**坑 47：一个概念一个来源**）。

**② 「@ai 打开白板」根本没走到房间动作那一步**

聊天入口 `sendAiQuestion` 里从 09-19g 就有一句：

```js
if (/^(操作|打开|点击|帮我操作|远程)/.test(q)) { socket.emit('ai-op', { goal: q }); return true; }
```

它的本意是"帮我操作**那台电脑**"（C1 远程操作员）。但它只看**句首动词**，不看宾语的层级，
于是「打开白板」「打开共享文件面板」这类房间指令在**客户端**就被改道，
服务器的房间动作规则（`ROOM_ACTION_RULES`，排在 LLM 之前那条）**根本没机会跑**。
房间里没有被控端时，AI 回一句"先有人共享屏幕并打开「允许远程协助」…"——
听起来是一句合理的解释，实际是**答非所问**，而界面一个字没动。

> 为什么 17 项真浏览器用例一条都没抓到：那些用例的说法全是
> 「把白板打开」「开启实时字幕」「切到宫格视图」「白板不用了」——
> **没有一句以"打开"开头**。我把同一个动作测了十遍，却每次都绕开了坏掉的那条语序。
> 把它暴露出来的动作便宜到值得记住：给新功能加用例时，我只是按**最自然的语序**写了一遍而已。

修法不是给这条正则再补一个例外（那只能救我下次想到的那两句），而是**换判据的维度**：

```js
const AI_OP_CTX_RE = /(电脑|桌面|浏览器|网页|记事本|计算器|那台机器|这台机器|对方机器)/;  // 提到哪台机器
const AI_OP_VERB_RE = /(操作|控制|打开|点击|双击|单击|输入|敲|按一下|点一下|切到)/;      // 要做什么
const AI_OP_EXPLICIT_RE = /^(帮我)?(操作|远程控制|远程)/;                              // 没有第二种读法的说法
if (AI_OP_EXPLICIT_RE.test(q) || (AI_OP_CTX_RE.test(q) && AI_OP_VERB_RE.test(q))) { /* 走 ai-op */ }
```

为什么不合成一条大正则：把"电脑"和"打开"揉进同一个字面分支，就会退回到"只看句首动词"的老判据，
而中文两种语序都常见（「在他电脑上打开记事本」/「打开他电脑上的记事本」）。

冒烟里加了**三条**红线，缺一条都会留洞：① 服务器每条动作的中文名（AI 自己说出口的那句）不许被截走；
② 11 句自然说法不许被截走；③ **正例必须仍然走 ai-op**——只断"不许截走"，
把 C1 整条链路堵死也能全绿。三条正则**从 `client.js` 源码里抓**，不在测试里重抄一份
（重抄的那份漂了就是假绿）。旧判据复跑，三条里红两条，红得很准。

**③ 这一轮顺手修掉的两个"量具自己的错"**（都不是产品代码错，但都会把人引向错方向）

- 「焦点落在行上时操作区会显形」第一版报红，读到 `opacity=0`。CSS 有 `transition: opacity .14s`，
  而我在 `focus()` 之后**同一个 evaluate 里**取值 = 必然读到过渡起点。改成轮询到停住，判据一个字没动。
  （这是"量具在跟自己的动画赛跑"这条纪律**第六次**应验，前五次也都是栽在我刚写好的动效上。）
- 冒烟那组"跳回主讲"第一版直接调 `setFilesFollow(true); rejoinPresenterView();`，
  于是变异测试（把按钮处理器改回 `emitFileView(true)`）**只红了结构那条、行为断言跟着绿**——
  "按钮里究竟写的哪一行"没人测。桩本来就支持 `dispatch('click')`，改成真点那颗按钮之后同一个变异红 4 条。
  > 判据：**行为断言要绕开的是"内部函数"，不是"真入口"。** 绕开入口写的断言，测的是我脑子里的实现，不是用户点的那颗按钮。

**④ 顺手补的一块覆盖：那些"真实世界的怪形状"以前只走过 Node 那一轨**

G2 那组专门测"浏览器那一轨的解压"（因为 Node 18+ 也有 `DecompressionStream`，
不特意造一个**没有 require 的 vm**，单测跑的就永远是 zlib 那一支）。
但它原先只拿"我随手写的那份 docx"证了两轨一致——而 O 组那 22 条
（`w:vMerge` 缺 `val` = 继续、`gridSpan` 与 `vMerge` 同表混用、公式格没有缓存值、备注页不许算一页）
**一条都没在浏览器那一轨上渲染过**。两轨不一致不会报错，只会在浏览器里"表格少一列"。

现在四份形状各钉一条"两轨逐字一致"，再加两条**内容级正向对照**：
浏览器那一轨也要产出 `rowspan="3"`、被合并的标签只能出现一次。

> 为什么必须有那两条正向对照：**"两轨一致地什么都没渲染"也是一致。**
> 一致性断言只保证两边一样，不保证两边都对——这条纪律在本项目已经写过好几次
> （坑 65「断言 0 之前先证明输入真进去了」、坑 105「没证据不许报通过」），这次轮到它出现在
> "两个运行时比结果"的场景里。A/B 也做了：把浏览器轨换成一份没有 vMerge 的夹具，
> 两条内容级断言当场红（而一致那条仍然绿——它比的本来就是同一个 buf，这恰恰说明
> **"两轨一致"与"形状对不对"是两件事，必须分开钉**）。

---

### 5.57 ★ 不装库读**旧版** Word/Excel/PPT，以及"外面的人真能连进来"的那一条端口（2026-10-09，J 档 + K 档）

> 这一节接着 5.56 讲。5.56 解决的是"docx/xlsx/pptx 能不能不装库画出来"，
> 而用户用完之后说的是另一句：**"word 什么的还是不能观看"**。
> 这句话里没有技术名词，所以要先把模糊抱怨拆成可判定的两个问题（这是本节第一课）。

#### 5.57.1 把"还是不能观看"拆成两件不同的事

| 用户的说法 | 真正的问题 | 为什么以前没被发现 |
|---|---|---|
| "word 打不开" | 他手上那份是 **`.doc`（2003 及以前的二进制格式）**，而代码里对它的回应是一句"请下载后查看" | 5.56 的断言全部喂的是 `.docx`——**测的是我造出来的那种文件**（坑 106：电池只覆盖我想到过的形状） |
| "打开也是残缺的" | `.docx` 里**有**但**没画出来**的东西：从样式继承来的编号、文本框里的字、域代码的**结果**、Excel 的百分数与货币格式、合并单元格 | 我的解析器只处理了"最容易的那一层"，而测试用的夹具恰好也是我按那一层写的 |

两件事都成立，说明**同一个症状可能有两条独立成因**——这与语音那条线上反复出现的教训同形
（"加入会议后识别失败"当年有四块独立拼图：端口撞号 / 能量闸错位 / 换设备把麦关掉 / 引擎没切）。

#### 5.57.2 二进制格式的三门必修：字节序、整数宽度、编码分流

旧版 Office 是 **OLE2/CFB 复合文档**——名字听着玄，本质是"**一个文件里装了一套文件系统**"：

```
文件头（0x0601 那串签名 + 扇区大小）
  ├─ FAT   ："哪块扇区属于谁"的表（每个扇区 4 字节，负数是结束/坏块标记）
  ├─ DIFAT ：FAT 太长时，用这页记下"FAT 自己在哪几块"
  ├─ MiniFAT + 小流：小于 4096 字节的流挤在"ministream"里按 64 字节分块
  └─ 目录表：每 128 字节一条，写着"这个流叫什么、从哪块开始、多长"
```

于是读 `.doc` 变成三步：① 按上面这套把 **WordDocument** / **0Table** / **1Table** 三条流取出来；
② 从 WordDocument 的 FIB（File Information Block）里读几个**偏移量固定的字段**；
③ 按 **piece table** 把文字拼回来。

三条最容易做错的点，每一条都对应一个真实缺陷：

1. **字节序**：OLE2 全是**小端**（低字节在前）。用 `DataView` 时必须每个 `getXxx(offset, true)`
   都带 `true`；忘了就得到一个"看起来像数字但完全不对"的值——**它不会报错**。
2. **整数宽度**：BIFF8 的字符串表（SST）头部两个计数字段是 **4 字节（u32）**，我按 2 字节（u16）读，
   于是 `cstUnique` 读成一个巨大的怪数、字符串表解出 0 条 ⇒ **整张 Excel 表格全空**。
   ▸ 判据：**读二进制格式时，"字段是几字节"必须查规范或拿真文件反证，不能靠印象。**
3. **编码分流**：Word97 的 piece descriptor 里 `fc` 的 **bit30** 决定这段文字是
   "压缩过"（每字节一个字符，CP1252）还是 UTF-16（每字符两字节）。
   不判这一位，中文文档就会读出一半乱码。判法：
   ```js
   const compressed = (fc & 0x40000000) !== 0;
   const start = compressed ? (fc >>> 1) / 1 : fc / 2;   // 压缩态地址要 /2 还原成字符数
   ```

#### 5.57.3 ★ 裁判不能是我自己：三个不同源的实现互相作证

5.56 已经立过这条纪律（写 ZIP 的和读 ZIP 的必须是两份实现），这一批把它推到两端：

| 裁判 | 它负责证什么 | 为什么它算"别人" |
|---|---|---|
| `scripts/office-oracle.py`（python-docx / openpyxl） | 现代格式里"真 Office 会写出来的形状"：样式继承编号、`mc:AlternateContent`、域代码、文本框、OMML 公式、合并单元格、百分数与货币 | 这些库是**独立的 OOXML 实现**，它们怎么编码不由我决定；我拿它们生成的字节喂我的解析器，再拿它们读回的结果当预期 |
| `scripts/legacy-oracle.ps1`（**本机真 Word/Excel/PowerPoint COM**） | 旧版二进制格式抽出来的文字**对不对** | 裁判是微软自己的产品：`Word.Content.Text` / `Excel 每格 .Text` / `PPT 各 shape 文字`就是"它认为这篇文档写了什么" |
| 我的 `fileview.js` | 被审的那个 | — |

旧版那条断言的形状值得单独学：
**不写"必须等于某个字符串"，写"我抽出的文字对真值的覆盖率 ≥70%"**。
因为 Word 自己也会把域代码、页眉、批注算进 `Content.Text`，逐字相等永远做不到；
而"比例 + 反例（指令文本 `PAGE` 不许出现、页眉不许进正文）"既能容忍差异，又不许它整个坏掉（坑 53：判据要尺度无关）。

#### 5.57.4 只有真文件才会暴露的三个缺陷

1. **签名记错 ⇒ 整类输入被"干净地"拒收**：Word97 的 FIB 起手 `wIdent` 真值是 **`0xA5EC`**，
   我凭印象写成 `0x01A5` ⇒ 每份 `.doc` 都走到"这不是 Word 文档"那条路，
   没有异常、没有崩溃，只有一句用户能看见的"请下载后查看"（新坑 **131**）。
   ▸ 通用判据：**格式魔数/常量不许从记忆里写**。要么查规范，要么先拿一份真文件把这几个字节打出来核对。
2. **整数宽度读错**（见 5.57.2 第 2 点）：症状是"格式认出来了但内容是空的"——比拒收更难查，
   因为它看起来像是"这份文件本来就没内容"。
3. **漏一个 `await` ⇒ 那条路径一次都没走过**：`ooxmlKindOf()` 是异步的，而我拿它的返回值直接和
   `'docx'` 比较（Promise ≠ 'docx' 永远不成立）⇒ "`.doc` 里其实装着 docx 要改道"这条逻辑
   **写了但从没生效**（坑 76 家族；测试用一条"改名的 .doc 被渲染成 docx"正面钉住）。

#### 5.57.5 跨网这一层：用户那句"不同网也能进来"到底需要什么

先把一件容易搞混的事说清（本项目已因此误导过用户一次）：

> **SFU 版的媒体是"浏览器 ↔ 服务器"直连的，服务器不走 TURN。**
> `config` 里的 TURN 只服务于 Mesh 版的浏览器↔浏览器连接。
> 所以"装了 TURN 就能跨网"对 SFU 是**假话**——决定成败的是**服务器自己可不可被连上**。

三件事一起做，"外面进得来"才成立：

| 做的事 | 为什么 | 落在哪 |
|---|---|---|
| **一条固定端口 + 同端口 TCP** | mediasoup 默认给每条 Transport 从 40000-49999 里随机挑端口 ⇒ 家庭路由器/云安全组要转发一整段；而**封 UDP 的网络**（公司 VPN、酒店）直接没救。改用 **`WebRtcServer`**：所有传输的 RTP 汇到**一个端口**，并**在同一端口再开一份 TCP** ⇒ 只转发 `4443` 的 **UDP 和 TCP**，UDP 被封时 ICE 自己会退到 TCP 候选 | `sfu/server.js` 的 `attachRtcServer()` / `mediaListenInfos()`；`config.rtcServerPort` |
| **多地址通告** | 以前 `announcedIp` 只能填一个 ⇒ "改成 Tailscale IP 才能让外面进来"和"同 WiFi 的同事连不上"是**同一个旋钮的两端**，用户被迫选边。现在一条 Transport **同时**通告局域网地址和组网地址，ICE 给对端两条候选，各自挑能通的那条 | `sfu/nets.js` 的 `announceIps()`；`announceExtra:"tailscale"` |
| **虚拟网卡按名字挡** | `'all'`（通告所有地址）听着省事，但开发机上 VirtualBox/WSL 那些 `192.168.x.x` 是"**本机 ping 得通、别人根本路由不到**"的假局域网地址 ⇒ 发出去等于给对端一条连不上的候选。第一版我拿"打分符号"当过滤器，而 `vEthernet (WSL)` 的打分是 **+10** ⇒ 漏进来（**判据要用它真正代表的那个概念**，别用相关量代打，坑 47） | `sfu/nets.js` 的 `isVirtualNic()` |

#### 5.57.6 把"我在不在 NAT 后面"变成一行打印

`scripts/stun-probe.js` 手搓一个 STUN **Binding Request**（20 字节头 + 事务 ID），读回包里的
映射地址属性。两个协议细节值得记（都在 `test:stun` 里被合成响应钉住）：

- `XOR-MAPPED-ADDRESS` 的 **address family 是 1 字节**（不是 Socket 那种 2 字节），
  端口是 `读到的值 ^ (cookie 高 16 位)`，IPv4 是被 cookie 异或过的 4 字节；
- Google 的 STUN 实测还回**老式 `MAPPED-ADDRESS`（8 字节布局）**，与 RFC 5389 的 10 字节那种**两种都要解**
  ——只按"标准"写就会把真响应读成"没带映射属性"（又一个"我以为的格式 ≠ 线上的格式"）。

于是跨网自测的末尾能老老实实说一句人话：
`反射地址（本机公网出口 IP，不写进文档）≠ 通告地址 192.168.157.194 ⇒ 这台在 NAT 后面，
要转发的就是那一个端口（或者走 Tailscale）`。**这条不判红不判绿**——它是事实，不是断言。

#### 5.57.7 界面一处真缺陷：浮层的"高度上界"，以及测可达性要用真滚轮

全量回归自己报了一条红：邀请面板 762px 高，比窗口矮不了多少，
于是**最后一行连同"可复制的修复命令"掉到屏幕外面**，而浮层没有滚动条——
用户看不见自己丢了什么（零报错的失效）。

面板为什么变高？因为跨网自检从 5 条长到 7 条。**内容驱动高度的浮层，一旦加了内容就会顶穿视口**。
修法不是把 `top` 挪小、不是把字号调小（那还是在猜"内容大概这么高"，坑 79/114 同一条），
而是给它一条**结构性上界**：

```css
.invite-panel { max-height: calc(100dvh - 76px); overflow-y: auto; overscroll-behavior: contain; }
```

（`dvh` 而不是 `vh`：移动端地址栏收起时 `vh` 是"最大视口"，按它算会刚好溢出那一小条。）

配套的测试写法有个反直觉的点：**断"用户够不够得着"必须用真滚轮，不能用 JS 改属性**。
第一版我写的是 `p.scrollTop = p.scrollHeight` 然后断言最后一行可见——
把 CSS 改成 `overflow-y: hidden`（用户彻底滚不动）之后**这条断言照样绿**，
因为 `overflow:hidden` 的容器仍然允许脚本改 `scrollTop`。
换成 CDP 真发一个 `mouseWheel` 事件之后，同一个变异当场红（`scrollTop=0`）。
▸ 通用判据：**测"人能不能做到"，就要用人做的那个动作去测**（与坑 123"变异那行有没有跑过"、
坑 119"页面处在用户到得了的状态"同族）。

> ★ **这一条没有停在"修好一处"**（路线图 L7）：同一批的收尾把判据升级成**冒烟结构红线**——
>   "凡是锚定式（`position:fixed` + `top:`/`bottom:`）的浮层，都必须有 `max-height`"。
>   四条豁免各挡一类误报：整屏层（有 `inset:`）、上下双锚（高度天然由视口定）、
>   `pointer-events:none` 的装饰与标记层、有显式 `height:` 的 1px 隐形输入件；
>   而且**按选择器聚合再判**——一个组件的"基础规则"与"媒体查询里的覆盖"是两处，
>   只看单条规则会把"本来有界、只是窄屏换个位置"的合法写法判红。
>   它上线当天就抓到两处同样缺上界的浮层：`.remote-ask`（授权卡，文案来自远端）与
>   `.toast`（底部锚定 ⇒ 只会往上长，长提示把顶部顶出屏幕）。
>   ▸ 红线自己也要 A/B：把扫描正则改盲 ⇒ **覆盖面哨兵必须红**（报"扫到 0 个"）。
>     理由很直白：**正则一旦失配，这条红线会永远绿，而永远绿的红线就是白装**（坑 105）。

#### 5.57.8 一条量具的假红：默认值要指向用户的真实配置

`test:asr-live` 这次红在一条正向对照上（"没叫它的那句闲聊一条定稿都没有"）。
核日志发现：那一路走的是 **whisper 兜底**（前两段转写 8.8s/10.9s，而 `🔥 Qwen 已预热` 出现在它们**之后**）。
而用户 `config.json` 里写的是 `qwen-local` ⇒ **它测的不是用户跑的那条路**：
慢引擎把相邻句子粘成一条 blob，闲聊句自然没有自己的定稿——这是**降级路径的正常形态**，不是产品回退。

以前要避开这个坑得记得加 `TEST_ASR_WAIT_WARM=1`。这次把它**反过来**：默认就等主引擎就位，
要测降级路径才显式 `TEST_ASR_WAIT_WARM=0`，并把"喂音频那一刻主引擎到没到"印进失败信息。

▸ 通用判据：**需要额外开关才能测到"用户真实配置"的测试，迟早把人引向错误的红点方向**。
默认值应该指向生产形态，例外要人主动声明（同坑 110/117：假绿不需要代码出错，只需要判据站错位置）。

同一天另一条红长得完全不一样，**根因却是同一类**（"量具测的不是它以为在测的东西"）：
`check:theme` 报"默认主题 = 水墨"读到 `light`，一次红 10 条。查下来是**上一轮运行留下的 localStorage**——
这个检查中途会把主题切成浅色、末尾再清掉，而清理写在**正常路径**上：
只要那次运行中途抛错或被 timeout 掐掉，存储里就留着 `'light'`，
下一次运行的"默认档"断言量的就是它（headless Edge 的 `localStorage` **确实跨启动存活**：
profile 目录按 CDP 端口派生，`cdp.launch()` 只 mkdir 不删）。
▸ 修法：**开跑前清档 + 重载一次**，并加一条前提断言"存储里的主题选择确实已清空"
  （不能只在 JS 里抹掉 `data-theme`——那恰好把"首帧不闪"这条被测行为绕过去了）。
▸ 两向都量过（同一个 profile、同一份残留）：摘掉那两行 ⇒ **红得与原现场一字不差**
  （`theme=light 按钮="水墨"`）；留着 ⇒ 27/27 全绿。
  ▎通用判据：**"默认"不是可以旁观的状态，是要先制造再断言的状态**——
    任何断言"出厂 / 默认 / 首屏 / 未登录"的检查，开头都要问三句：
    上一轮有没有可能已经把这里改掉了？我清了吗？我**验证**清了吗？（最后这问最值钱：
    清档那一步自己也可能是一次"写了没生效"，坑 76。）

#### 5.57.9 一句话的可讲版本（面试/答辩）

> "共享文件这块我分两半补：新格式里那些**从样式继承来的结构**（编号、文本框、域结果、合并格、
> 数字格式码）我原来只画了最容易的一层；旧格式 `.doc/.xls/.ppt` 是 **OLE2 复合文档**，
> 我零依赖写了 CFB + Word97 piece table + BIFF8 记录流把它读出来。
> **验收的关键是裁判不是我**——用 python-docx/openpyxl 独立生成和读回，再用本机真 Office COM
> 交出它自己认为的正文，断言覆盖率 ≥70%。这三条路各自暴露了我一个错：签名常量记错、
> 整数字段宽度读错、漏一个 `await` 导致改道逻辑从没生效。
> 跨网那半边我把'外面的人进得来'做成可测的：媒体汇到**一个 UDP+TCP 的固定端口**，
> 一条 Transport **同时**通告局域网与组网地址，再用**手搓 STUN** 读出反射地址，
> 于是"这台在不在 NAT 后、该转发哪个端口"变成界面与日志里的一行事实。"

#### 5.57.10 这一节留下的债

- **旧版格式只还原"文字与逐格数据"**：`.doc` 的版式/图片、`.ppt` 的母版与图形没有还原
  （要还原得读几十个 BIFF/Escher 记录类）；界面上这句话是明说的，不许让人以为看到了全文。
- **"外面真的进来了"仍要人验**：本机没有第二张网，`test:crossnet` 证明的是
  "固定端口 UDP+TCP 都在听、通告地址有两个、判据说实话"，
  而"另一张网络的设备点开链接能看到画面"必须由人拿一台真设备走一次（0.2 清单 L1）。
- **回扫的天花板还是输入多样性**：本节的两个外部裁判只代表"我能想到的形状 + 我这台机器上的真文件"，
  用户那份"渲染不出来"的文档才是下一批夹具（`REAL_OFFICE_FILE=<路径> npm run check:files`）。




---

## 第 5.58 节 ★ 给"准确率"造一把尺：为什么先造工具、再改代码（2026-10-09，M 档）

> 这一节教的不是某个功能，是**一条工作方法**：当你发现自己反复在"凭感觉"决定一件事时，
> 那个感觉之所以不可信，通常是因为**那一维根本没有量具**。

### 5.58.1 症状：延迟有尺，准确率没有尺

语音这条线上我们已经有一堆读数：字幕条上的 `⏱ 2.8s`、`latMs` 的"等待 vs 转写"拆分、
`/metrics` 的 avg/max/last、`review:meeting` 的碎片率与 blob 率。**它们全部在量"多快"和"切在哪"。**
唯一在量"对不对"的是 `npm run bench:asr`，而它数的是关键词命中 `6/9`：

```js
{ text: '产品评审会定在十月十号，全员参加。', keys: ['评审', '十月', '参加'] }
// 转写成「产品庭审会定在10月10号」——三个关键词命中两个，看起来"还行"
```

问题在于：命中数是个**下限代理**。一句话错掉七成的字，只要关键词还在就算成功。
于是有两件事一直卡着：

- 路线图 H3 写着"词级天花板**等用户拍板**"——可云端 / 更大本地模型 / 靠近麦克风三条路，
  没有一张可比表，用户拿什么拍？
- 一堆 dB 阈值"不敢动"——因为改完只能看 blob% 变没变，看不出**听对没听对**。

### 5.58.2 造尺之前先定口径（三个决定，每个都要能解释）

`sfu/ai/accuracy.js` 是一个零依赖纯函数文件。它最有价值的部分不是编辑距离，是**三个口径决定**：

1. **单位**：中文按**字**算 token，连续拉丁/数字算一个 token。
   不说清单位，两份报告里的"CER"就是两个不同的东西。
2. **标点不参与比对**：转写引擎自带标点（期望「明天三点」实际「明天三点。」）。
   把标点算成错误，每一档都会虚高，而且波动随模型的标点习惯走——**那不是识别错误**。
3. **数字默认不折算**：「十号」≠「10号」。
   ▸ 这是**有意的保守**，也是这一节最值得学的一条：项目里已经有一个
   `Asr.normAsrText()`，它会把形近字、全半角归一，因为**判意图**时需要
   （「小铭把白板打开」要认成「小明」）。但拿归一化之后的文本去**量准确率**，
   等于用尺子的刻度去改被测物——指标会变好，而下游靠字面匹配的抽取（纪要、待办、
   指令回扫）该踩的坑一个不少。所以两套口径**分开命名**，并且提供 `{foldDigits:true}`
   显式开关：开关一开，结果里就带着 `foldDigits:true`，`diff()` 发现两次口径不同**直接拒比**。

还有一个"诚实线"必须写进代码，因为它决定这份报告会不会骗人：

| 情形 | 错误做法 | 现在的做法 | 为什么 |
|---|---|---|---|
| 引擎什么都没转出来 | 报 0%（没有错误） | **报 100%** | 那是最差，不是最好 |
| 期望文本是空的 | 报 0% | 判 `comparable:false`，不进任何均值 | 0÷0 会被读成"通过" |
| 只有 3 句样本 | 照样给结论 | `enough:false`，打印 ❔ | 样本不足的下结论是猜 |
| 转写比原文长很多 | 钳到 100% | 允许 CER > 100% | 那是真话 |

### 5.58.3 跑法：先自证尺子，再跑引擎

`npm run bench:asr-golden` 开头第一件事不是加载模型，是**四条反向对照**：
`ref≈ref` 必须正好 0%、空转写必须 100%、空期望必须"不可比"、一字之差必须 `sub=1`。
任何一条不对就退出。理由和 `check:avatar` 那次一样（坑 98）：
**能量出"不动"的量具，它报的"在动"才是证据**；一把只会报"CER 高了"的尺，没有资格说任何方案更好。

它还守了两条本项目反复用到的纪律：

- **增益走 `Asr.modelGainDb`**：量具必须复现"生产真正喂给模型的那份音频"。
  如果脚本自己再写一遍 `-8 - peak`，量的就是另一个东西（而且两份迟早漂）。
- **跳过必须说话**：显存不够、whisper 没装、云端没配 key，都打印 `SKIP：原因`，
  并在结论区列成"本次没测到的列"。**没有一列被偷偷当成"通过"**。

第一次跑出来的表（合成场，10 句 × 2 档距离）：

```
qwen-local(cuda)/near  micro 2.8% · 全对 9/10
whisper-small /near    micro 4.9% · 全对 5/10
      数字写法折算后 micro 3.5%（差 1.4 个百分点）
      ✗ 13%  期望「产品评审会定在十月十号，全员参加。」
         实得「产品评审会定在10月10号 全员参加」
```

两个病灶当场分开：`10月10号` 是**写法差异**（人听懂了，字面匹配会踩），
而另一句 `负载→附在` 是**真词错**。这种区分以前做不到——关键词命中把它们混成一个数。

### 5.58.4 一条诚实的边界：这张表回答不了"真人坐远会怎样"

far 档（模拟坐远）是把合成语音整体衰减到 -58 dBFS 再按生产的增益链提回来，
读数与 near 档**一模一样**。听起来像好消息，其实这个结论有限定：
**它只是把同一份干净语音调小了，房间噪声与混响没有跟着进来**——而"靠近麦克风"
那条路的代价恰恰是噪声。所以跑法自己在结论区写了这句话。
（同一条纪律的另一面：`review:meeting` 为什么要把"自测场/真人场"标出来。）

### 5.58.5 真人场：`/golden` 录制页与它的四个运行时

要拿到真人的分布，只能让人自己念一遍。链路是
**浏览器 MediaRecorder → HTTP raw body → ffmpeg 转 16k/mono/s16le → jsonl 账本**，
四个运行时串起来，任何一段断了都不会报错给用户看（页面停在"上传中"，
而跑表会安静回落合成语音，那张表**看起来完全正常**）。所以给它配了
`npm run check:golden`（11 项真浏览器断言）。三个设计点值得学：

1. **句子清单只有一份**（`sfu/golden.js`）。录制页要照着念、跑表没有真人录音时要合成同一批句子；
   两处各抄一份，就会出现"录的是 A 批、跑的是 B 批"，两张 CER 表根本不可比。
2. **回包里的 `peakDb` 用的是生产能量闸同一个函数**（`Asr.measureWavLevel`）。
   于是"这句在会议里会不会被当静音删掉"，你在**录的当场**就知道，而不是录完 20 句才发现整批是废的。
3. **麦克风三件套有意全关**（`echoCancellation/noiseSuppression/autoGainControl`）。
   这页要量的是"你的麦克风 + 这个房间"的真实条件；而会议里正相反——那边要开 AEC 防啸叫。
   **同一个设备、两种目的，参数就不该共用一份。**

顺带说两个当天写出来又被自己抓走的错，它们比"修好了什么"更值得记：

- **量具自己造原因**：失败分支里先 `L.kill()` 再读 `L.lastError`，而 `kill()` 会把真实原因冲掉，
  于是报出"worker 起不来：killed"，差点让我去查 GPU。（读证据要在动手之前。）
- **重录路径删掉刚写好的文件**：「转码覆盖同名 wav → 按旧记录 unlink → 记新账」，
  第二步删的其实是刚转好的那一份 → 账本指向不存在的 wav → 列表把它过滤掉 →
  "重录成功却查无此条"，零报错。是那条**去重断言**把它抓红的（坑 140）。

### 5.58.6 这把尺以后能干什么

- H3 从"等拍板"变成"看表选"：录完 20 句真人金标准，同一条命令就出真人场对照；
  配上 `DASHSCOPE_API_KEY` 还能多一列（前提是先确认能把会议音频送出外网）。
- 以后动任何阈值（`ASR_MIN_PEAK_DB`、增益上限、`asrSegmentSec`、底噪自适应）之前，
  `--compare=sfu/logs/golden-xxxx.json` 会告一句"准确率提升 / 下降 / 无显著变化"，
  而不是"看起来 blob 少了"。
- 播报那条也顺手改了：超预算的句子以前被**拦腰截断**，用户听到的就是"话说一半然后没声"；
  现在首句永远整句念、后续放不下就整句不念，同时语音问答那一路在生成时就被要求
  "结论进第一句"。**只改切法治不了根，只改提示词不保险，两侧一起。**


---

## 第 5.59 节 ★ 「登录」终于有了反面：退出、找回，以及"管理员到底特别在哪"（2026-10-09，第 52 步）

> 这一节讲的不是三颗按钮，是**一个状态必须有反面**这条工程纪律。
> 用户的原话是三句抱怨："没有退出登录的效果"、"没有忘记密码的效果"、"管理员没有实质的区别"。
> 三句各自对应一个不同的根因，而三个根因共享同一个形状：**只做了一半**。

### 5.59.1 先定位，别先写按钮

审计这个功能时我没有直接加按钮，先把"登录这件事在代码里到底住在哪"查了一遍，结果是这样：

| 查什么 | 查到的事实 | 于是缺什么 |
|---|---|---|
| 谁把登录卡收起来 | 全文件只有 `hideAuth()`；`remove('hidden')` 只出现在"设备码面板返回"两条路径上 | **没有反向**：登录后再没有路径能回到登录卡 |
| 登录态存在哪 | `localStorage.wb_auth`、模块级 `myDisplayName`、`myAvatar`、每小时的续期定时器 | **四处各一份**，没有一条统一的撤销路径 |
| 服务器认识谁 | `bindIdentity()` 把 username/displayName/avatar/role 绑在 socket 上，**只进不出** | 客户端就算自己忘了，**服务器还认得你** |
| 管理员的独占在哪 | 四个 HTTP 端点（`/dashboard` `/recordings.html` `/golden` `/metrics`）要 admin token | 界面与成员**一模一样**，差别只写在文档里 |

▎教学要点：**"某功能不好用"通常不是缺一个控件，是缺一个状态迁移。**
先问"这个状态从 A 到 B 有几条路，从 B 回 A 有几条路"，比先画按钮便宜得多。

### 5.59.2 状态的唯一来源，和它唯一的撤销入口

```js
const myAuth = { username: null, token: null, displayName: null, avatar: null, source: 'none' };

function clearAuthState(why) {          // ← "退出"的全部含义就在这一个函数里
  if (authStore) authStore.removeItem('wb_auth');
  myAuth.username = null; myAuth.token = null; myAuth.displayName = null; myAuth.avatar = null;
  myDisplayName = null; myAvatar = null;
  if (window.__authRefreshTimer) { clearInterval(window.__authRefreshTimer); window.__authRefreshTimer = null; }
  renderAccount();
}
```

三个容易做错的点，每一个都对应本项目踩过的一次事故：

1. **顶栏那颗身份牌的文字不是判据。** 它只是 `myAuth` 的一个视图。
   如果你写 `if (userChipTxt.textContent === '未登录')` 来判状态——恭喜，你重新发明了
   坑 97（那次是"换过一次麦克风，麦克风就自己关了"，因为按钮里加了一层动效文字，
   `textContent` 读出来变成「静音静音」，相等判断永远 false）。
   冒烟里有一条**全文件结构红线**：出现 `xxBtn.textContent === '…'` 这种判状态直接红。

2. **撤销要有唯一一个入口。** 一开始我在两处各写了 `removeItem('wb_auth')`：
   登出路径一处，"启动时存档失效"那处又一处。后者只清 localStorage，不清昵称/头像/定时器——
   于是"退出"和"票过期"这两种本该同构的状态迁移，行为不一样。
   收口之后（都走 `clearAuthState`）漂移在**结构上不可能发生**，这才是"一个概念一个来源"（坑 47）的用法：
   不是"记得同步改"，是**让你没法只改一处**。

3. **两条路径（连着 / 没连着）共用同一个 `finish()`。** 第一版把 toast 与面板提示只写在"有网"那一路，
   断网时点退出：状态清了，**一句反馈都没有**。
   这条是被冒烟抓的——而它之所以一直没被抓到，是因为**假 socket 桩里没有 `connected` 这个属性**
   （坑 83：假环境缺一种能力，那条分支就永久不测）。补上之后顺带发现
   白板信令兜底 `board-signal` 也从没在测试里被走到过。

### 5.59.3 服务器那半边：撤销身份，以及"不许顺手做别的事"

```js
socket.on('auth-logout', ({ token } = {}, callback) => {
  const held = token && authTokens.get(token);
  if (held && held.username !== socket.username) {
    return fail(callback, '这张票不属于当前连接');   // ① 拒绝，且**零副作用**
  }
  if (held) authTokens.delete(token);                // ② 只作废自己这张
  dropIdentity('logout');                             // ③ 身份落回游客 + 广播 room-state
  ok(callback, { ok: true });
});
```

▎**为什么①重要**：没有那道守卫，"退出登录"就变成一个能被任何人使用的
**把管理员踢下线**的入口（他只要把你的 token 发过来）。一条请求最坏要"无副作用"，
而不是"顺带做点别的"——所以被拒时连自己的身份都不动。

▎**为什么要 `dropIdentity`**：聊天广播的署名来自 `socket.displayName`（服务器填的），
成员列表的 role 来自服务器投影。客户端清了自己的 localStorage 而服务器不撤身份，就会出现
**"我这边写着游客，别人那边还是我的昵称，而且我还能录像"** —— 这类"两边各说各话"
是本项目最容易漏的一类缺陷，因为它**没有任何一处会报错**。
同一把刀也砍在 `auth-refresh` 判失败那一支（票过期 ⇒ 这条连接的身份同时撤销），
A/B 把这一行注释掉，断言精准红在"续期失败也撤身份"那条上。

▎一个诚实的语义差（写进 `sfu/protocol.js`，也写进测试名字）：
- `auth-logout {}`（不带票）= 只退**这条连接**，那张票还活着；
- `auth-logout {自己的票}` = 连票一起作废，之后 `auth-verify` 也过不了
  （否则刷新页面就"自己又回来了"）。
这两种是**不同的动作**，界面与文档都不许混着说。

### 5.59.4 「忘记密码」：不许演

这个项目零依赖、可以完全离线跑，**没有邮件也没有短信通道**。
所以这里最危险的写法是一个看起来很像产品的"重置链接已发送到你的邮箱"——
它会让人去查一个**根本不存在的邮箱**（坑 82：过期/虚构的声明比缺失更糟）。

给的是两条照着就能做的真路：

1. 服务器在你自己这台机器上 → 开终端跑 `npm run admin:passwd -- 你的用户名`（不给新密码就随机生成，只在终端显示一次）；
2. 服务器在别人/公司机器上 → 找那位管理员执行同一条命令。

▎**为什么两条都要写**：同一个提示要在**不同部署形态**下都成立，只写第一条就等于对
"部署在服务器上"的用户说了一句他做不到的话。
▎还有一条**反向对照断言**：那句提示里不许出现"已发送 / 请查收 / 重置链接已发"，
且点它**不发任何信令**（找回是本地/线下动作，做假动作等于骗界面"我在忙"）。

### 5.59.5 管理员的"实质区别"：说出来，而不是新造特权

先讲一个容易搞错的点：**会中权限本来就该相等。**
`kick-member` 与"删任何人的共享文件"判的都是 owner **或** admin（房主优先，
平台管理员是同级的治理角色）；`record-start` 那条只区分"登录了没有"（游客不能录，因为审计要身份）。
所以"我点了管理员按钮，会中却没什么不同"不是 bug——**是会议产品的语义**。

真正的独占是**四个 HTTP 端点**，普通成员打开是 401。修法是把它**说出来**：

- 顶栏一颗身份牌：未登录 / 成员 / 房主 / 平台管理员 四档文案（文字是视图，判据读变量）；
- 点开是账号面板：我是谁 + 退出（**两步确认**，不用原生弹窗——阻塞式模态会把重连状态机冻在中间）
  + 一块只对 `role=admin` 出现的**治理台**，四个链接就是那四个页面。

▎没有新造任何特权，也没有放宽任何门禁。**"差别要看得见"本身就是一项功能。**

### 5.59.6 这一节最贵的部分：三条我自己写出来的红线（都升级成判据）

| 事故 | 症状 | 为什么静态工具抓不到 | 现在的常驻判据 |
|---|---|---|---|
| HTML 注释用 CSS 的收尾序列写完（坑 141） | `<!--` 永不闭合 ⇒ 「忘记密码」按钮与 `#authMsg` 被吞，页面后半屏几何全 0 | `node --check` 不看 HTML；冒烟的假 DOM 会**替你把缺失的元素造出来**（坑 27） | ① id 契约（只算**注释之外**的内容）② HTML 注释体内不许出现那个序列（实测 105 条注释 0 误伤） |
| 模板字符串内部的反引号（坑 142） | 注入浏览器的代码被截断 ⇒ 那条检查 **0 条断言**就跑完，只留下"0 通过 / 0 失败" | 源文件语法完全正确——错在**拼出来的那个字符串** | `scripts/inject-check.js` 一处实现，12 个 check 脚本各接一行；守卫自己有 2 条单测（含"合法代码不许误伤"的反例） |
| 判据过期（坑 143） | 用户录完真人语音之后，"真实目录没被创建"变成一条结构上不可能通过的断言；另一处写成 `gDirExistedBefore ? true : …` 变成永真 | 它们都是"当时看起来对"的判据 | 判据改问真正的不变量：**我这批测试 id 有没有混进真实语料** / 跑前跑后逐文件 `路径\|字节\|mtime` 快照 |

▎三条合起来是一条方法论：**能误伤的判据就不该当硬红线**（先量误伤面，再决定要不要装），
而**"这次没坏"永远不等于"这写法安全"**（坑 26 原话，这次是它的第三次与第四次应验）。

### 5.59.7 自己检查一下你学会没有

1. 为什么"退出登录"必须同时改客户端与服务器？只改客户端会留下什么现象？
2. `clearAuthState()` 里那四行分别对应哪个落点？少清哪一行会造出什么症状？
3. 「跟随主讲」那颗按钮（第 51 步）和这颗「退出登录」按钮，犯的是同一类错吗？
   （提示：一个是"解耦只做了单向"，一个是"状态只有正向"。）
4. 为什么"重置链接已发送"比"没有找回功能"更糟？
5. 你要给一个浮层加内容，L7 那条红线要求你同时写哪三行 CSS？

> 想查证：`sfu/public/client.js` 搜「第 52 步」；`sfu/server.js` 搜 `dropIdentity`；
> 断言在 `scripts/test-sfu-client-smoke.js`（第 52 步那 33 条）与
> `scripts/test-sfu-signaling.js`（搜 `10-09 第 52 步`）。
> 跑法：`npm run test:smoke`、`TEST_SFU_PORT=3011 npm run test:sfu`、`npm run check:login`、`npm run check:theme`。

---

## 5.60 一夜的做法：怎么把一条"口头结论"结案，以及怎么审"只有正向没有反向"

> 这一节不讲新功能，讲**方法**。2026-10-10 通宵做的六批事（路线图 0.11）里，
> 没有一批是"加了一个界面"，但产出的可信度比加十个功能高——因为它把"我以为"变成了"仪表在替我看着"。
> 三条可复用的动作，每条都有当晚真实的失败形态做锚。

### 5.60.1 结案 = 装一把常驻的尺，不是在清单上打勾

项目里挂着两条口头结论好几天了：

- **H2**：「`ametadata` 打到管道上会按 ~4KB 成块交付 ⇒ 第一行 RMS 约 5 秒才到」；
- **H8b**：「底噪估计把 −99 的纯静音排除在样本外 ⇒ 噪声底系统性偏高」。

两条都是**我自己写的、没人能复核的说法**。上一轮我"验证过 H2 不复现"，凭的是一次日志里
看到的几行数字——而日志会被删（`sfu/logs/` 在 .gitignore 里），于是那条结论又变回"我记着"。

**结案的正当形式是让这件事以后每次开会都在被量**：

| 落点 | 具体做法 | 为什么必须这一层 |
|---|---|---|
| 瞬时值 | `/metrics` 的四格 gauge（首行多久到 / 首字节之后多久 / 最大空档 / 单次事件多大） | 运维面板与 Prometheus 能抓 |
| 分布 | 每代录音进程**退出时**写一条 `asr-rms-arrival` 事件 | gauge 只报"此刻这一代"，进程一重生就归零；要看的是真实会议里的**分布** |
| 复盘 | `npm run review:meeting` 多一行结论（样本 <3 报 ❔） | 拿真账本回答"这场到底怎么样"，而不是拿自测数字 |
| 告警 | `watch.js` 三条规则（管道慢 / 空档大 / 成块） | 不用人记着去看；**没人看的仪表等于没有仪表** |

**H2 的量到结果**：第一条 RMS **995ms**、最大空档 315ms、单次事件最大 959B（远低于 4KB）⇒ 逐行交付，那条假设不成立。
**H8b 的量到结果**：把 `silentDb` 设成 −80 / −120 / −70 三档，floor 与阈值**一字不差** ⇒ 那条排除规则在这批数据上量不到影响，所以**一行生产阈值都没动**。

>  teaching 点：**"负结果"也是结果**，而且它比"顺手改一下试试"便宜——改阈值要重跑整套保真度测试，
> 而"量了发现不用改"只花一台量具的成本。更关键的是：如果你不改，就必须留下**为什么不用改**的证据，
> 否则下一个人还会再去试一遍（本项目同一条坑已经踩过三次）。

### 5.60.2 量具的三条纪律（当晚每条都抓到我自己的错）

1. **量具必须能读出 0 和 1**。`bench:voice-floor --selftest` 里有一条 E2：
   故意把"纯静音"写成 −16dB 的响噪声，**排除计数必须读出 1**。
   没有这一条，"排除了 0 个窗"可能只是"我的尺根本不会排除任何东西"。
   （同一条纪律在坑 98「AI 表情像素量具」上救过一次：两版量具都被自己的 A/B 推翻。）
2. **生效参数要从被测对象身上读，不要抄第二份**。第一版把 −80 这个"我以为在跑的值"抄进了量具——
   而生产早已改成 −99。抄的那份常数会让量具稳定地测**一个不存在的配置**（坑 47/118）。
   现在用 `Asr.createVoiceTracker().params` 把真实值交出来。
3. **打分对象必须是产品真正留下的那份东西**。`bench:asr-golden` 之前打的是**模型原样**文本，
   而落账/上屏的是过完 `cleanTranscript()` 的那份 ⇒ **任何文本侧改动在这张表上都是零收益**。
   修好之后当晚那一刀（句尾回声折叠）立刻显出 **far 5.6% → 3.5%**。
   如果没修，我会写下"改了没变化，看来得换模型"——一个被错口径的尺引向的错方向。

### 5.60.3 「只有正向没有反向」是一种可批量搜索的缺陷形状

第 52 步（退出登录）修完之后，我把这个形状当成一把**搜索工具**用在整个仓库上：
**每一个"注册/挂载/攒账"的动作，它的反面（撤销/摘监听/删账）在几条路径上都做了？**

当晚的清单与结论（先证伪、再动手，两条因此没白改）：

| 正向 | 原来缺的反面 | 症状（都不报错） |
|---|---|---|
| `room.talk.set(id)` 每 400ms 攒发言秒数 | 离开时不删 | 幽灵条目留在**分母**里 ⇒ 在场每个人的占比一起被压低 |
| `socket.dataConsumers.set(...)` | 断线只 `clear()` 本地 Map、不 `close()` | 服务器侧漏对象；频道早关了台账还在 |
| `recordSessions.set(...)` | 房间销毁不停 ffmpeg | Router 一关它只是断粮，自己不会判断"上游没了"，端口一直被占 |
| `authTokens.set(...)` 无过期清扫 | 只有"懒删"（verify 命中才删） | 登录过就不再回来的人留一条永久条目，而它**不在任何房间投影里** |
| `pendingServerTts.set(ts)` + 20s 保险丝 | 房间作废不销账 | 人退回加入页，20 秒后 AI 在首页把死房间的答案念出来 |
| `blockedPeers.add(who)` | 没有解禁入口 | 单向门：说不解禁却会因重连自动失效 |
| `localStorage` 音量账（键 = socket.id） | 只写不剪 + 注释说"换场还认得" | 过期声明 + 单调增长的死条目 |

**修法之前先做一件事：把条数交出来。**`/metrics` 加 `sfu_auth_tokens`、`/api/rooms` 成员投影加
`talkEntries` / `dataConsumerCount`——因为**撤销是"某个数变小"这件事**，
而"变小"必须能被断言，否则只能靠读代码相信它（读代码得到的是"改了"，不是"发生了"，坑 76）。

> 两条**先证伪**：`destroyRoom` 里裸删 `remoteCtl` 在现存三条路径下都先走了 disconnect 的收口 ⇒ 今天不是活缺陷
> （但红线照装，它防的是**下一个调用点**）；`THEME_KEY 写了没人读` 是假阳性（三个页面都读）。
> **"看起来像缺陷"与"是缺陷"之间隔着一趟证伪**，而它平均能省一次错误的修改 + 一条错误的文档。

### 5.60.4 红了先怀疑自己：当晚三次

1. **`'***' + token`**（占位符当凭据）：新写的 `/api/rooms` 助手连续 401 四轮，我依次怀疑了
   "票被删 / TTL 被改短 / 请求写法 / 端口上有旧实例"，**全都错**。
   让它一步断掉的是给失败信息加上"我发的 token 前缀"与"401 页里那句为什么"。
   ⇒ **跨进程排查时，红话里要带上我方实际发出的字节**。
2. **未锚定的正则活在生产代码里**：坑 74 当年立的"锚行首"只修了测试脚本；
   `watch.js` 的四个取值助手都没锚定，于是 `# HELP …primary_ready 1 when…` 被读成"引擎已就绪"，
   那条**为了防误报而加**的分诊从上线那天起就在制造误报，而限流把它压成"偶尔响一次"。
   ⇒ 立纪律之后要 **grep 所有副本**，包括生产那份。
3. **一条注释承诺了、代码没实现**：e2e 那段注释一直写"中位数口径…一半以上慢必须红"，
   而代码只比了 `Math.min`。补上 `med ≤ 6s` 之后，那条线的意义才和注释一致。
   ⇒ 读注释里"这条断言防的是哪种失败"，然后去代码里**确认它真的防得住**。

### 5.60.5 自己检查一下你学会没有

1. 为什么说"日志里看到过 995ms"不足以结案一条性能假设？要补哪三层落点？
2. 一台只会报"排除了 N 个窗"的量具，缺哪一条自检就没有资格说"因此 floor 偏高"？
3. "把 −99 纯静音排除在外"这件事量出来是**没有影响**。为什么不顺手改成 −120 试试看？
4. 给 `room.talk` 补撤销时，为什么必须先往 `/api/rooms` 里加一个 `talkEntries`？
5. `destroyRoom` 裸删 `remoteCtl` 不是活缺陷，为什么还是要装那条结构红线？
6. 一条 `Bearer` 前缀的红线，落地之前为什么要先数一遍"全仓有几处、会误伤几处"？

> 想查证：`sfu/server.js` 搜 `2026-10-10`（四处撤销 + 两个新格）；`sfu/talk.js`（分母只算在场）；
> `sfu/ai/asr.js` 搜 `foldTailEcho`；`scripts/{watch,review-meeting,bench-voice-floor,soak}.js`；
> 第 7 节坑 **144 / 145 / 146 / 147** 与坑 129 的第四次应验。
> 跑法：`npm run test:watch`、`npm run test:review`、`npm run bench:voice-floor -- --selftest`、
> `npm run review:meeting -- --days 1`、`npm run test:sfu`（3011）、`npm run test:smoke`。

### 5.60.6 一条判据能不能生效，先看它要求的状态"物理上到不到得了"（C2 的三课）

字幕定稿延迟里有一块是"等含尾字的那一段被 ffmpeg 封口"，约 1.4 秒。给这道闸门加一条
"如果音频其实已经被听过就放行"的判据，我连错三次，每次都是一个独立的教训：

1. **判据要求了一个到不了的状态**。第一版写成"抢跑读到的字节 ≥ 文件当前大小"。听起来很安全，
   但分段文件在换段之前**一直在长**（16k 单声道 s16le = 32000 字节/秒，**静音也在写**），
   而抢跑的转写要 0.4~2 秒才回来。于是这条判据**永远差一截**，机制"写了"，生产里一次都没跑过。
   正确的问法不是"文件读满了吗"，而是"**这段话说过之后，还有没有没被听过的字节？**"
   ——把段内字节号换算成时刻（`第 N 字节 ≈ 段出生时刻 + N/32000 秒`），要求覆盖到
   "最后一次有声 + RMS 行滞后"为止就够了，之后的字节按定义是静音。
   ▸ 判据：**写下"必须等于/大于当前值"之前，先问这个当前值是不是在自己涨**。
2. **要求了一个不由它保护的安全条件**。第二版加了"那次抢跑必须真的转出了字"。
   实测三轮：段边界那段切片交回来的全是 `text=""`，**封口段自己也一样是 `""`**——
   句尾那个「会」字从来不是那一段转出来的，而是"整句音频一次重转"救回来的。
   于是这条要求把放行变成不可能，而它以为自己在保护的东西由另一条路保护。
   ▸ 判据：**一个条件的三个来源要分开命名**——音频覆盖到位（纯函数）×
     这一句真的会做整句重转（重转开着 / 段数够 / worker 不忙）× 这句不只叫了个名字。
     揉成一条"看起来更安全"的大判据，结果就是它永不生效（而这正是坑 76 的第四种形态）。
3. **"我觉得它是因为 X"必须有一个能把它打红的实验**。我猜模型不出字是因为切片缺了
   **段尾收尾点**，还顺手实现了一版"静音确认后从段首整段重读"。随后写了台量具
   （拿真人金标准 wav 切五种刀：完整 / 切 0.08s / 切 0.08s+补 0.25s 假静音 / 切 0.4s / 切 0.4s+补静音），
   实测**五种切片的转写一字不差** ⇒ 假设是假的，那一版代码全部撤回。
   ▸ 判据：为"我觉得"写代码之前，先花十分钟量一次；量完把**否证**留在断言注释里，
     否则下一个人（很可能就是三天后的我自己）会把同一个直觉再实现一遍。

还有一条结构性教训：**给一个已有容器增加写入方，会拆掉它原先的隐式保证**。
整句音频账本原先只有一个人写（封口段按顺序 push），所以"push 顺序 = 时间顺序"是免费的；
让抢跑的前缀也写进来之后，seg-0008 的切片会比 seg-0007 的余量**早到 150ms**，
拼出来就是"后半句在前半句前面"——**而模型照样会自信地转出文字**，不报错。
补法是两条显式判据顶上：切片带上段名 + 拼接前按段名排序（`seg-%04d.pcm` 补零 ⇒ 字典序=时间序）；
另开一本 `uttTake` 水位账，封口段只补没交过的那一截（否则同一段音频出现两遍）。

最后，默认值由**同场次 A/B** 决定而不是由数字好看决定：
关 `3.3s / 3.1s` → 开 `3.3s / 2.0s`，同时**定稿条数 2 / 应答 1 次 / 逐字全对含尾字「会」**三条红线
一条没变差，才把默认翻成开，并留 `ASR_TAIL_RUSH=0` 只撤这一个变量。
第一句两轮都还是 3.3s——它被另一道守卫（`segInFlight === 0`，"重复接话"的防线）挡着，
**不许记成本次没效果，也不许顺手去改那道守卫**。

> 想查证：`sfu/ai/asr.js` 搜 `tailCoveredByRush` / `uttOrdered` / `uttSegmentKinds`；
> `sfu/server.js` 搜 `scanTailSegments` / `refineWillRun` / `uttTake`；
> `scripts/test-asr.js` 的 **⑮ 组**（含 ⑮.20 那条反向钉）；第 7 节坑 **148 / 149**。
> 跑法：`npm run test:asr`、`ASR_DEBUG=1 npm run test:asr-live`（闸门两个判据都在这行日志里：
> `尾巴段未消费=严格/宽松`）、`npm run review:meeting -- --days 1`（「尾巴抢跑」那一行）。

### 5.60.7 「刚才那个再关回去」：规则表接不住的那一半，是**状态**不是动词（C3）

前面的几批把"一句说法 → 一个动作"的泛化缺口从 54% 打到 0%，但有一类说法永远接不住：

    「刚才那个再关回去」「撤销那一步」「恢复成之前的样子」「刚才那个算我没说」

它们的宾语**不在句子里**，在"刚才发生过什么"里。所以这一档要做的第一件事不是加正则，是**引入状态**：
一条挂在房间上的动作栈（`room.actionStack`，上限 8 条，随房间一起销毁）。

三个判据的形状，缺一条就会**做错方向**（做错方向比不做更糟——用户得手动改回来）：

1. **取反与重复是两个相反的动作**，却共享同一个回指前缀。判据分三层，顺序就是语义：
   强撤销词（撤销/关回去/算我没说）> 重复词（再来一遍/重新打开）> 光杆关闭词（关掉/收起/隐藏）。
   「把刚才那个**重新打开**」里的"打开"既是开启也是重复短语的一部分——先判关闭就会做成"把刚才那个关掉"。
2. **一个族只认最近一条**。第一版我按"逆动作相同就去重"，于是栈里"开字幕 → 关字幕"这两步
   被解成同时广播 `[关字幕, 开字幕]`。物理上讲不通：一个界面在同一时刻只能是开或关。
3. **不可逆就整条不做，并说清是哪一条挡住了**。`board-clear`（清空白板）没有"之前"可以回去。
   做一半（能撤的撤了、该说的没说）比全不做更难解释。

还有一条**边界要写进回话**而不是只写进注释：栈只记"通过我下达的动作"，
谁**手动**点了按钮，服务器看不见 ⇒ 栈空时明确说"我不知道你指哪一件，手动操作我看不见"。
不装作听得懂一切，是这套 AI 功能从第一天就在守的那条线（坑 82）。

> 这一档最贵的收获其实不是撤销本身：为了验"回话说清楚没有"，我在真浏览器里加了三条**文本断言**，
> 三条全红，顺藤抓出一条从 10-06 就在的空气缺陷——规则直答的路由在聊天里**只有徽标没有正文**
> （详见坑 150）。教训：**"服务端载荷正确"不等于"用户看得见"**，端到端功能至少要有一条断言
> 读用户那一侧的呈现（聊天区文本 / innerText / 截图像素）。

自己检查一下你学会没有：
1. 为什么"把刚才那个重新打开"不能按"关闭动词"来判？判错会造成什么用户可感知的后果？
2. 动作栈为什么挂在 `room` 上而不是全局 Map？两种写法各自的清理负担差在哪？
3. `board-clear` 为什么必须拒做而不是"尽力撤一下"？
4. 那三条文本断言为什么能红、而 21 项状态断言和 6 条信令断言全绿？你的测试里有没有同样的空档？
