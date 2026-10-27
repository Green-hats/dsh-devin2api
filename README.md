# dsh-devin2api

把 [devin-2api](https://github.com/Green-hats/devin-2api-lite) 网关接入 DeepSeek Harness 的**模型提供方插件**。

它在 DSH 里注册 `devin2api` 提供方：模型目录来自网关的 `GET /v1/models`，请求走 OpenAI
Chat Completions 流式协议，响应翻译成 DSH 的 `StreamChunk`。装好后 `/model` 里会多出
**Devin2API** 分组；Models 设置页能编辑这条路由；输入区右侧有额度胶囊。

## 能力

| 能力 | 状态 |
| --- | --- |
| 动态模型目录（5 分钟缓存、失败回退） | ✅ |
| 文本 / 思考流 / 工具调用 | ✅ |
| 推理档位（映射 `reasoning_efforts`） | ✅ |
| 模型白名单（`models`） | ✅ |
| 图片输入（当前轮，base64 data URL） | ✅ |
| Models 设置页可编辑行 + 模型发现 | ⚠️ 已实现，未在真实 DSH 实例中验证 |
| 额度胶囊（输入区右侧） | ⚠️ 已实现，同上 |
| 多账号容灾 / 用量看板 | ❌ 未做 |

## 安装

```sh
dsh plugin --profile desktop add /绝对路径/dsh-devin2api
```

重启 profile 后生效。装好后先确认网关在跑：

```sh
curl -s http://127.0.0.1:18089/healthz
```

## 配置

配置在 profile 的 `cordis.patch.yml` 里。结构是 `providers` 字典——这样 Models 页能按
`settingsPath: ["providers", "devin2api"]` 定位并编辑这一行。

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
        models: []          # 空 = 全部；非空时是白名单
```

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `displayName` | `Devin2API` | 选择器里的分组名 |
| `baseURL` | `http://127.0.0.1:18089/v1` | 网关地址，末尾斜杠可有可无 |
| `apiKey` / `apiKeyEnv` | 空 / `DEVIN2API_API_KEY` | 直写或读环境变量；网关未开鉴权可留空 |
| `enabled` | `true` | 关闭后不注册路由 |
| `models` | `[]` | `[{ id, name }]` 或字符串数组；非空即白名单 |
| `images` | `true` | 是否向模型声明图片输入 |
| `contextWindow` / `maxTokens` | `262144` / `128000` | 网关不报这两个值，由插件补 |
| `refreshMinutes` | `5` | 目录缓存时长 |
| `requestTimeoutMs` | `300000` | 单次请求总超时 |
| `imagePixelBudget` / `imageMaxBytes` | `4194304` / `1048576` | 单图缩放目标 |
| `maxRequestImageBytes` | `20971520` | 单次请求图片总预算（base64 长度） |

## 图片

- 只对**当前轮**读取附件：当前轮从最后一条 user 消息开始，从它（含其后的 tool 结果）取图；
  同一轮里的工具调用不会让图片掉线。更早的图片替换为 `[Image omitted from history]`
  ——网关本身也只接受当前轮图片，这样还能避免把整个会话的历史图重复塞进请求体。
- `supports_images=false` 的模型不声明图片能力，DSH 会在请求前把图片换成占位文本，
  不会打到网关上换一个 400。
- 单图按 `imagePixelBudget` / `imageMaxBytes` 缩放后才编码；整次请求超过
  `maxRequestImageBytes` 直接报 `IMAGE_BUDGET`，不发送截断的请求。
- 需要宿主挂载附件服务（随附组合默认有 `@deepseek-ai/dsh-attachment-local`）。

## 界面

插件在客户端有两处 UI：

| 位置 | 内容 |
| --- | --- |
| 对话输入框右侧胶囊 | `日 71% │ 周 65%`，仅当会话选中 Devin2API 模型时出现；悬停显示模型名、套餐、两个重置时间；点击立即刷新 |
| 设置 → **Devin2API** | 用量面板：网关连接状态、今日/本周进度条与各自重置时间，带「刷新」 |
| 设置 → **Devin2API** → 模型目录 | 每个模型一行开关，可搜索、可全开/全关；关掉的模型不出现在选择器里 |

设置页这类目由 `settings.section` 插槽注册（与 `dsh-opencode-go` 同一机制）。面板通过
`configForms` 读取 `providers.devin2api.baseURL`，所以在「模型」页改过地址后，面板会跟着走。

模型的可编辑行（baseURL、密钥、图片开关）由 `registerConfigurableProviders` 提供，位于
**设置 → 模型 → Devin2API**，不在插件自己的面板里重复一遍。

## 配置 schema 的硬性要求

DSH 的设置文档只收录**标了 `.volatile()` 的字段**：宿主 `dsh-settings` 的 `volatileForm()`
会丢掉所有非 volatile 字段，一条都不剩时整个 namespace 就不出现在 `settings.describe` 里，
客户端拿到的状态就是 `unavailable`——插件自己的面板和「模型」页都会变成只读。

另外 `volatileForm()` 只在 `type === "object"` 时向下递归，所以中间的包装层必须是
`z.object`，**不能是 `z.dict`**（dict 会被直接丢弃，哪怕叶子标了 volatile）。

因此本插件的 schema 是：

```js
Config = z.object({
  providers: z.object({ devin2api: profileSchema }),  // object 而不是 dict
})
// profileSchema 里每个字段都 .volatile()
```

代价是 volatile 字段在宿主侧不再是普通值，而是带 `get()` 的活值单元，
适配器统一用 `unwrapVolatile()` 现读（见 `lib/index.js` 的 `get config()`），
这样设置页改完立即生效，不需要重新挂载插件。`test/protocol.test.mjs` 里有守门测试，
字段漏标 volatile 会直接失败。

## 模型开关

面板里的模型列表来自网关的 `GET /v1/models`。每个模型一个开关，点一下**立即写入**
`providers.devin2api.modelVisibility`（`{ "模型 id": false }`），不需要点保存——与
`dsh-opencode-go` 的行为一致。宿主侧 `filterByVisibility` 把 `false` 的模型从
`listModels` 和模型发现里都去掉，所以聊天里的模型选择器会立刻少掉这些条目。

两个兜底：

- 字典里没有的 id 视为开启（默认全开），所以新模型上线不会被默认隐藏。
- 全部关掉时退回完整目录并打一条 warn——避免手滑把选择器清空。

## 额度胶囊

`conversation.input.right` 里一个只读胶囊，同时显示当日和本周剩余：`日 71% │ 周 65%`，
每段有自己的状态点（绿 → 黄 ≤30% → 红 ≤10%）。悬停显示模型名、套餐、两个重置时间。

**刷新频率**：

| 层 | 频率 | 说明 |
| --- | --- | --- |
| 胶囊轮询 | 60 秒 | 选中 devin2api 模型时才轮询，换模型即停 |
| 网关缓存 | 5 分钟 | 上游响应约 130 KiB，不每次请求都拉 |
| 点击胶囊 | 立即 | 带 `?fresh=1` 跳过网关缓存，直接问一次上游 |
| 刷新失败后重试 | 30 秒 | 网关侧失败重试间隔，期间返回上一次快照并标 stale |

所以不点的情况下，数字最多滞后约 5 分钟；点一下就是新数据。

**只在当前会话选中 `devin2api` 的模型时出现**：胶囊通过 `modelDirectories` 读当前会话的
`current.provider`，不是这个 provider 就立刻消失，同时停止轮询（换成别的模型后不再发请求）。

数据来源是网关的 `GET /v1/quota`（devin-2api-lite 已实现）。浏览器直接请求该地址，因此：

1. 网关需要是**只读端点开放 CORS** 的 lite 版本（`/healthz`、`/v1/models`、`/v1/quota`）。
2. 网关的 `auth.api_key` 必须为空——浏览器端不携带密钥。开启鉴权后胶囊会隐藏，
   后续需要改成 Host 代理读取。
3. 地址默认 `http://127.0.0.1:18089/v1`，可在「模型」设置页的 Devin2API 行里改。

## 与 dsh-opencode-go 的差异

| | dsh-opencode-go | 本插件 |
| --- | --- | --- |
| 协议 | OpenAI/Anthropic/Google SDK | 网关的 OpenAI Chat Completions |
| 多账号容灾 | 支持 | 无 |
| 用量看板（本地扫描） | 支持（读本地日志） | 无（改为读网关额度） |
| 额度胶囊 | 有（Host remote） | 有（浏览器直连 + CORS） |
| 图片 | 支持 | 支持当前轮 |
| 实现规模 | 60k 行 + 构建链 | ~1.1k 行纯 ESM，无构建 |

## 排障

客户端异常会 POST 到网关的 `POST /__clientlog`，落盘在 `$TMPDIR/dsh-devin2api-client.log`
（macOS 是 `/var/folders/.../T/`，不是 `/tmp`）。包括 `window.onerror`、
`unhandledrejection` 和面板 React 错误边界捕获到的堆栈。

## 限制

- **`enabled` 需要重载**：`enabled` 只在插件挂载时判断，运行中改成 `false` 不会注销已注册的路由；重载插件或重启 profile 后生效。其余字段（`baseURL`、`apiKey`、`images`、`maxTokens`、`modelVisibility` 等）都是 volatile，保存即生效。
- **单网关**：一个插件实例只服务一个 `baseURL`。
- **无 replay state**：思考签名不回传，多轮只回放文本与工具调用。
- **额度胶囊未鉴权**：见上节。

## 开发

```sh
node --test test/*.test.mjs     # 协议/目录层，纯 Node，不需要 DSH
node --check lib/index.js lib/client.js
```

`lib/protocol.js`、`lib/catalog.js` 不导入 DSH 模块；`lib/index.js` 需要 DSH 运行时；
`lib/client.js` 是 `window.__ModuleLoader__.load` 形式的浏览器模块，无构建步骤。

### 已验证

- 单元测试 30 项（消息/工具/图片转换、SSE 翻译、错误分片、目录、额度、错误码、
  volatile 热更新、取消语义、设置面板状态）。
- 真实网关（lite + `/v1/quota`）：122 个模型；文本流式 `pong`；`get_weather` 工具调用
  返回 `{"city":"Paris"}`；白名单生效；网关不可达时回退配置。
- 图片：用假附件服务跑通了「历史图 → 占位文本、当前轮图片 → `image_url` data URL」，
  并验证同一轮工具调用后图片仍会上传。
- 配置：用真实 schemastery + Loader 的 volatile 更新路径验证了设置改动能到达适配器。
- **未验证**：Models 页那一行、额度胶囊在真实 DSH 里的渲染——沙箱无法写入
  `~/.dsh` 安装插件。装上后如有报错，把信息发我按真实 API 修。
