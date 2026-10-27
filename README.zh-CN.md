<div align="center">

# dsh-devin2api

**把 [devin-2api-lite](https://github.com/Green-hats/devin-2api-lite) 接入 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的模型提供方插件。**

[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-0.2.1--rc.3-4d6bfe?style=flat-square)](https://github.com/deepseek-ai/deepseek-harness)
[![Gateway](https://img.shields.io/badge/gateway-devin--2api--lite-2ea44f?style=flat-square)](https://github.com/Green-hats/devin-2api-lite)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-339933?style=flat-square&logo=node.js&logoColor=white)](package.json)
[![License](https://img.shields.io/badge/license-MIT-2ea44f?style=flat-square)](LICENSE)
[![CI](https://github.com/Green-hats/dsh-devin2api/actions/workflows/ci.yml/badge.svg)](https://github.com/Green-hats/dsh-devin2api/actions/workflows/ci.yml)

[English](README.md) | 中文

[为什么](#为什么) · [快速开始](#快速开始) · [配置](#配置) · [界面](#界面) · [协议映射](#协议映射) · [排障](#排障)

</div>

---

> [!IMPORTANT]
> 本插件是**客户端半边**。[devin-2api-lite](https://github.com/Green-hats/devin-2api-lite) 负责 Devin 协议、模型目录、
> 额度快照和上游 token；插件只把 DeepSeek Harness 的模型调用适配到网关的 OpenAI 兼容 Chat Completions 端点。
>
> 先启动网关：没有网关时插件既列不出模型，也无法建立流式请求。

插件在 Harness 中注册提供方路由 **`devin2api`**：目录来自网关的 `GET /v1/models`，请求走
`POST /v1/chat/completions` 并翻译成 DSH 的 `StreamChunk`，同时在 Web UI 里提供设置页、模型开关和额度胶囊。

```
DSH Agent ──StreamChunk──► dsh-devin2api ──HTTP + SSE──► devin-2api-lite ──Connect RPC──► Devin
             ◄── OpenAI Chat Completions ─────────────┘
```

零构建，纯 ESM；除 DSH 自带的包外没有运行时依赖。

## 为什么

| 能力 | 内容 |
| --- | --- |
| **模型目录** | `/v1/models` 按 `refreshMinutes` 缓存、单飞刷新，失败时回退到配置的模型列表 |
| **对话** | 流式文本、`reasoning_content`、工具调用、usage、finish reason 映射 |
| **推理档位** | 读取 `reasoning_efforts`；目录声明 `high` 时默认 `high` |
| **图片** | 当前轮图片转 base64 data URL，按像素/字节预算缩放；历史图替换为占位文本 |
| **控制** | `models` 白名单 + 每模型开关（`modelVisibility`），全部关闭时安全回退 |
| **设置** | **设置 → 模型** 里的可编辑行，以及独立的 **设置 → Devin2API** 页面 |
| **额度** | 输入区的日/周剩余额度胶囊，点击跳过网关缓存 |
| **运维** | 鉴权、额度、超时、取消、图片预算都有稳定错误码；可选的本地排障日志 |

### 插件使用的网关端点

| 端点 | 调用方 | 凭据 |
| --- | --- | --- |
| `GET /healthz` | 设置面板 | 无 |
| `GET /v1/models` | 目录、模型开关、模型发现 | Host 带 `Bearer`；浏览器不带 |
| `GET /v1/quota` | 额度胶囊与面板 | 浏览器不带 |
| `POST /v1/chat/completions` | 每次模型调用 | `Bearer` |
| `POST /__clientlog` | 可选排障 | 无；仅本地 |

浏览器直接读取上述三个 GET 端点（网关必须像 lite 一样为它们开放 CORS），并且**不携带 API key**——见[界面](#界面)。

## 环境要求

- **DeepSeek Harness** `0.2.x`（在 `0.2.1-rc.3` 上验证）。Peer 包：
  `@deepseek-ai/dsh-llm >= 0.1.5-rc.1`、`@deepseek-ai/schemastery >= 3.18.0`。
- **Node.js** `^22.19.0 || >=24.0.0`。
- **devin-2api-lite**，并启用 `/v1/quota` 与只读端点 CORS（当前 lite 版本默认具备）。
- Host 的 `attachments` 服务（默认组合自带），用于图片输入。
- 网关同时能从 **Host** 和渲染设置页/额度胶囊的**浏览器**访问。

## 快速开始

### 1. 启动网关

```bash
git clone https://github.com/Green-hats/devin-2api-lite.git
cd devin-2api-lite
cp config.example.yaml config.yaml     # 填入 devin.token
go run ./cmd/devin-2api -config config.yaml

curl -s http://127.0.0.1:18089/healthz
# {"status":"ok"}
```

token、Docker 和完整配置见 lite 的[快速开始](https://github.com/Green-hats/devin-2api-lite/blob/main/README.zh-CN.md#快速开始)。

### 2. 安装插件

```bash
# 从 GitHub 安装
dsh plugin --profile desktop add github:Green-hats/dsh-devin2api

# 或从本地 checkout 安装
dsh plugin --profile desktop add /绝对路径/dsh-devin2api
```

安装后重启 profile（或重载插件）。bundle patch 会插入这一行：

```yaml
- id: devin2api
  name: dsh-devin2api
  config:
    providers:
      devin2api:
        displayName: Devin2API
        baseURL: http://127.0.0.1:18089/v1
        apiKeyEnv: DEVIN2API_API_KEY
        enabled: true
        images: true
        models: []
```

### 3. 指向网关

在 **设置 → 模型 → Devin2API** 行里改，或在 `$DSH_HOME/profiles/<profile>/cordis.patch.yml` 里覆盖同一个
`id`：

```yaml
- id: devin2api
  config:
    providers:
      devin2api:
        baseURL: http://127.0.0.1:18089/v1
        apiKeyEnv: DEVIN2API_API_KEY
```

### 4. 选择模型

在 DSH 里打开 `/model`，选择 **Devin2API**。目录来自网关的 `/v1/models`；修改 endpoint 或模型开关后，提供方
目录与模型发现会随之更新。

### 5. 验证

```bash
curl -s http://127.0.0.1:18089/v1/models | head -c 200
curl -s http://127.0.0.1:18089/v1/quota
```

## 配置

所有配置都在 `providers.devin2api` 下，这样 Models 页可以按一个 provider 对象定位
（`settingsPath: ["providers", "devin2api"]`）。

```yaml
- id: devin2api
  name: dsh-devin2api
  config:
    providers:
      devin2api:
        displayName: Devin2API
        baseURL: http://127.0.0.1:18089/v1
        apiKeyEnv: DEVIN2API_API_KEY
        apiKey: ''
        enabled: true
        models: []
        modelVisibility: {}
        images: true
        contextWindow: 262144
        maxTokens: 128000
        refreshMinutes: 5
        requestTimeoutMs: 300000
        imagePixelBudget: 4194304
        imageMaxBytes: 1048576
        maxRequestImageBytes: 20971520
```

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `displayName` | `Devin2API` | 模型选择器和提供方列表里的名字 |
| `baseURL` | `http://127.0.0.1:18089/v1` | 含 `/v1` 的网关根地址；末尾斜杠可有可无 |
| `apiKey` | `''` | 直写密钥；标了 `role('secret')`，设置文档会打码。建议优先用 `apiKeyEnv` |
| `apiKeyEnv` | `DEVIN2API_API_KEY` | `apiKey` 为空时，每次请求读取的环境变量名 |
| `enabled` | `true` | 挂载时判断：运行中修改需要重载插件或重启 profile |
| `models` | `[]` | 空 = 宣传网关全部模型；非空为白名单，条目是 id 或 `{ id, name }` |
| `modelVisibility` | `{}` | 设置页写入的每模型开关；`false` 表示隐藏（全部关闭时回退完整目录） |
| `images` | `true` | 对支持图片的模型声明图片输入；`false` 强制按纯文本投影 |
| `contextWindow` | `262144` | `/v1/models` 不报上下文长度，由插件补 |
| `maxTokens` | `128000` | 作为 `max_tokens` 发送的默认输出上限 |
| `refreshMinutes` | `5` | 目录缓存 TTL（最小 1 分钟） |
| `requestTimeoutMs` | `300000` | 单次请求总超时（含流式读取） |
| `imagePixelBudget` | `4194304` | 编码前的图片像素预算 |
| `imageMaxBytes` | `1048576` | 编码后单图字节上限 |
| `maxRequestImageBytes` | `20971520` | 单次请求允许的 base64 data URL 总字符数 |

`DEVIN2API_BASE_URL` 会作为 endpoint 环境提示上报给 Models 页；适配器自身的 `baseURL` 仍以配置为准。

### 热更新

除 `enabled` 外，所有可编辑字段都标了 `.volatile()`，设置页的写入会直接作用到运行中的适配器，无需重新挂载。
`enabled` 只在插件挂载时判断；运行中把它从 `false` 改成 `true`（或反向）需要重载插件。见[已知限制](#已知限制)。

## 界面

**设置 → Devin2API**（独立页面）：

- 网关连接状态与解析后的根地址；
- 今日/本周剩余额度、重置时间和 stale 快照标记；
- 模型目录：搜索、每模型开关、**全开** / **全关**、刷新。

**设置 → 模型 → Devin2API**（提供方行）：

- 可编辑 `baseURL`、API key、图片能力和模型发现。这一行属于共享的 Models 页，插件不在自己的面板里重复。

**输入区额度胶囊**（`conversation.input.right`）：

- 仅当会话选中的提供方是 `devin2api` 时出现；
- 每 60 秒请求一次 `GET /v1/quota`，端点不可用时自动隐藏；
- 点击请求 `?fresh=1`（lite 会跳过 5 分钟缓存）；
- 目前显示 `日 71% │ 周 65%`，UI 文案暂为中文（见[已知限制](#已知限制)）。

### 浏览器与凭据

面板和胶囊运行在渲染进程，直接请求网关，**不带** `Authorization`。因此当网关设置了 `auth.api_key` 时：

- 聊天仍可用（Host 会带 `Bearer`）；
- `GET /v1/models` 与 `GET /v1/quota` 会返回 `401`，面板没有目录、胶囊消失。

本地网关请让 `auth.api_key` 为空；或者在你控制的代理层终止 CORS/鉴权。lite 的 `GET /healthz` 与
`POST /__clientlog` 是公开端点，网关应只监听回环地址。

## 模型目录

- 目录通过 `GET /v1/models` 获取，按 `refreshMinutes` 缓存，并用单飞避免并发重复拉取。
- 刷新失败时使用上一次快照；没有快照时回退到 `models`，两者都为空则报 `EMPTY_CATALOG`。
- `models` 是白名单。若其中所有 id 都不在网关目录里，适配器会 warn 并改为宣传完整目录，而不是把选择器清空。
- `modelVisibility` 在白名单之后应用；如果剩余模型全部被关闭，宿主会宣传完整的剩余列表，避免选择器为空，
  面板会明确提示这一回退。

`GET /v1/models` 不提供上下文长度或输出上限，因此 `contextWindow` / `maxTokens` 是按提供方配置的值，而不是
自动发现的。

## 图片

- 只会上传**当前轮**。边界是最后一条 `user` 消息：该消息及其后 tool 结果里的图片保留；更早的图片替换为
  `[Image omitted from history]`。这样工具循环不会让图片掉线，也不会重复上传整段会话。
- 每张图按 `imagePixelBudget` 缩放，并受 `imageMaxBytes` 限制；整次请求的 data URL 超过
  `maxRequestImageBytes` 时报 `IMAGE_BUDGET`，不会发送截断的请求体。
- `images: false`、模型 `supports_images: false`、或缺少 `attachments` 服务时，DSH 会在请求前把图片投影成
  文本；网关不会收到它不支持的图片。
- 依赖 Host 的 `attachments` 服务（默认组合自带）。

## 协议映射

### 请求

| DSH 输入 | OpenAI Chat Completions 请求 |
| --- | --- |
| `options.system` + 开头的 `system` 消息 | 一条 `system` 消息 |
| `developer` 消息 | `system` 消息 |
| 历史中段的 `system` 消息 | `system` 消息（保留，不丢弃） |
| 用户文本 / 图片 | 字符串，或 `[{ type: "text" }, { type: "image_url", image_url: { url } }]` |
| assistant 文本 / 工具调用 | `{ role: "assistant", content, tool_calls }`，参数序列化为 JSON 字符串 |
| tool 结果 | `{ role: "tool", tool_call_id, content }` |
| `tools` | OpenAI `function` 工具；跳过 `deferLoading` 条目 |
| `maxTokens` | `max_tokens` |
| `reasoningEffort` | `reasoning_effort` |
| `temperature` / `stop` | `temperature` / `stop` |
| — | `stream: true`、`stream_options: { include_usage: true }` |

> [!NOTE]
> 当前 lite 版本固定采样参数（`max_tokens=128000`、`temperature=1`、`top_p=0.95`、`top_k=40`），会忽略客户端值；
> 本插件仍会原样转发，以便对接会尊重这些参数的网关。见 lite 的[注意事项](https://github.com/Green-hats/devin-2api-lite/blob/main/README.zh-CN.md#注意事项)。

### 流式

| DSH chunk | 上游来源 |
| --- | --- |
| `block-start` / `block-end` | 每个 reasoning、text 或 tool-call 块各一对 |
| `reasoning-delta` | `choices[0].delta.reasoning_content` |
| `text-delta` | `choices[0].delta.content` |
| `tool-call-delta` | `choices[0].delta.tool_calls[].function.arguments` |
| `usage` | 最终 `usage`（`prompt_tokens`、`completion_tokens`、`total_tokens`、缓存命中） |
| `finish` | `finish_reason`：`length` → `max-tokens`，`tool_calls` / `function_call` → `tool-calls`，其余 → `stop` |

### 错误码

| 错误码 | 含义 |
| --- | --- |
| `AUTH` | 网关 `401` / `403` |
| `QUOTA` | `429` |
| `INVALID_REQUEST` | `400` / `413` / `422` |
| `TIMEOUT` | `504`，或单次请求超时 |
| `ABORTED` | 调用方取消了请求/流 |
| `TRANSPORT` | 网关不可达、流中途断开或响应不可读 |
| `SERVER` | 其他 HTTP 状态 |
| `IMAGE_BUDGET` | 请求图片超过 `maxRequestImageBytes` |
| `IMAGE_UNAVAILABLE` | 附件读取失败 |
| `EMPTY_CATALOG` | `/v1/models` 没有可用条目 |
| `EMPTY_RESPONSE` | 流结束时既没有内容也没有 finish reason |
| `UPSTREAM_ERROR` | 网关返回错误分片 |

取消被报告为 `ABORTED`（而不是 `TRANSPORT`），宿主可以区分“用户停止”和“传输失败”。

## 架构

| 文件 | 作用 |
| --- | --- |
| `lib/index.js` | Host 适配器：注册、目录、流、图片、模型发现、设置策略 |
| `lib/protocol.js` | 消息/工具/SSE 翻译；不导入 DSH |
| `lib/catalog.js` | 目录与额度解析、可见性、错误映射、volatile 解包 |
| `lib/schema.js` | Config schema；每个可编辑字段都是 `.volatile()` |
| `lib/client.js` | Web UI：设置页、模型开关、额度胶囊 |
| `cordis.patch.yml` | bundle 插入的 profile 补丁 |
| `test/` | `node:test` 测试；`test/register.mjs` + `test/fixtures/dsh-llm` 让测试脱离 DSH 也能跑 |

## 排障

| 现象 | 检查 |
| --- | --- |
| `cannot reach the gateway` | `curl /healthz`、`baseURL`、防火墙；Host 也必须能访问 |
| 聊天报 `AUTH` | `apiKey` / `apiKeyEnv`；lite 的 `auth.api_key` 是否一致 |
| 模型选择器为空 | `curl /v1/models`；用 `models` 配一个回退列表；重载插件 |
| 图片变成占位文本 | 历史图属正常；检查 `images`、`supports_images`、`attachments` 与图片预算 |
| 设置页显示 unavailable | namespace 需要 volatile 字段；看 Host 日志和 `POST /__clientlog` |
| 模型开关不生效 | 设置是否只读；或全部关闭触发了“完整目录”回退 |
| 额度胶囊不出现 | 会话没选 `devin2api` 模型；网关未启动；CORS 被拦；`auth.api_key` 已设置 |
| 客户端渲染异常 | `POST /__clientlog`；lite 会把浏览器和 Host 上报追加到 `$TMPDIR/dsh-devin2api-client.log` |

卸载：从 profile 移除 bundle（`dsh plugin --profile desktop remove dsh-devin2api`）并重启；插入的行与配置会一起
消失。

## 已知限制

- **没有 replay state**：推理文本不会作为提供方状态回传；多轮只回放可见文本与工具调用。
- **一个插件实例只服务一个网关**：第二个 endpoint 需要第二个插件实例和 provider 路由。
- **`enabled` 需要重载**：路由在挂载时注册。
- **浏览器 UI 不带鉴权**：面板和胶囊直接请求网关；请使用 `auth.api_key` 为空的回环网关。
- **没有多账号容灾和本地用量看板**：这些属于网关（或未来的插件面）。
- **UI 文案暂为中文**：设置页和胶囊尚未接入 Client 的 locale 服务。
- **采样由网关决定**：当前 lite 会忽略客户端的 `max_tokens` / `temperature` / `stop`，见其注意事项。
- **提供方级限制**：`/v1/models` 不报上下文长度，`contextWindow` / `maxTokens` 是配置值而非发现值。

## 与 dsh-opencode-go 的差异

| | `dsh-opencode-go` | `dsh-devin2api` |
| --- | --- | --- |
| 协议 | OpenAI / Anthropic / Google SDK | OpenAI Chat Completions |
| 多账号容灾 | 支持 | 无 |
| 用量看板 | 本地日志扫描 | 网关 `/v1/quota` |
| 额度胶囊 | Host remote | 浏览器直连 + CORS |
| 图片 | 支持 | 当前轮 |
| 规模 | ~60k 行 + 构建链 | ~2.1k 行纯 ESM，零构建 |

## 开发

```bash
npm install --legacy-peer-deps   # 安装 schema 测试用的 schemastery
npm test                         # node --test，30 项
npm run check                    # 对每个 lib/*.js 跑 node --check
```

需要 `--legacy-peer-deps`，是因为 npm 上公开的 `@deepseek-ai/dsh-llm` 版本低于 DSH 运行时携带的版本；测试用
`test/register.mjs` 把这个 specifier 映射到 `test/fixtures/dsh-llm/index.js`，因此不安装 DSH 也能跑。
`schemastery` 是真实的 devDependency。

目录：

```
lib/index.js       Host 适配器
lib/protocol.js    纯翻译层
lib/catalog.js     纯解析层
lib/schema.js      Config schema
lib/client.js      Web 客户端模块
test/              node:test 测试 + DSH 桩
.github/workflows  Node 22/24 CI
```

新增配置字段：在 `profileSchema` 里加字段并标 `.volatile()`，在 `PROFILE_DEFAULTS` 里加默认值，扩展
`test/protocol.test.mjs` 的 volatile 守门测试，并同步两份 README。设置写入必须能作用到运行中的适配器；不要在
`apply` 里提前拆开配置对象。

## 相关项目

- [**devin-2api-lite**](https://github.com/Green-hats/devin-2api-lite) —— 本插件对接的网关
  （[English](https://github.com/Green-hats/devin-2api-lite)）。Devin 协议、模型目录、`/v1/quota` 和
  `/__clientlog` 都在它那边。
- [**DeepSeek Harness**](https://github.com/deepseek-ai/deepseek-harness) —— 宿主应用与插件 API。
- [**leookun/devin-2api**](https://github.com/leookun/devin-2api) —— lite 所基于的原始协议逆向项目（MIT）。

## 状态

Host 路径（目录、流式、工具、图片、设置写入）有测试覆盖，并已在真实 lite 网关上跑过。Models 设置行和额度胶囊
按当前 Client API 实现且能正常注册，但尚未在每种 DSH 主题/语言下验证视觉渲染。

## License

[MIT](LICENSE) © 2026 Green-hats。
