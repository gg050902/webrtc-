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
⑤ SFU 主版本（第 5 节）       → 跑起来 + 逐文件导读；5.7~5.37 = 每一轮升级的教学记录
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
│       ├── client.js         # ★ SFU 版浏览器逻辑（步骤 1~29；14=远程协助，15~24=A/D 档，
│       │                     #   25~26=F 档，26b/26c/26d=回应举手/批注/白板，27=D+1 数据通道，
│       │                     #   28=F6 滤镜虚拟背景，29=实时字幕）
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

### 5.4 sfu/public/client.js 导读（步骤 1~29）

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
| `sfu/public/client.js`（步骤 1~31） | 浏览器的一切：登录→预览→媒体→协作→字幕→值守。**「第 N 步」编号就是目录** | 别的成员的状态权威（UI 可以缓存，真相在服务器） |

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
> 清理后**库里 9 个账号**；首个管理员是 **`Guoge`**（此前库里 0 个管理员，导致 `/dashboard`、`/metrics`
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
