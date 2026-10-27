/**
 * 配置 schema。
 *
 * DSH 只把标了 `volatile` 的字段放进设置文档（`volatileForm`），没标的字段会被
 * 整条丢掉，客户端拿到的 namespace 就是 `unavailable`——所以每个可编辑字段都必须
 * `.volatile()`，这与 dsh-opencode-go 的做法一致。
 *
 * 同时：`providers` 必须是 `z.object`，不能是 `z.dict`——`volatileForm` 只在
 * `type === "object"` 时向下递归，dict 会被直接丢弃。
 *
 * @module dsh-devin2api/schema
 */
import z from '@deepseek-ai/schemastery';

/** 提供方路由名；不能与已注册的路由重复。 */
export const PROVIDER = 'devin2api';

/** 网关默认地址。 */
export const DEFAULT_BASE_URL = 'http://127.0.0.1:18089/v1';

/** Models 页可编辑的模型条目。 */
export const modelEntry = z.object({
	id: z.string(),
	name: z.string().default(''),
});

/** 单个 provider 的配置；Models 页通过 settingsPath 编辑这一层。 */
export const profileSchema = z.object({
	displayName: z.string().default('Devin2API').volatile(),
	baseURL: z.string().default(DEFAULT_BASE_URL).volatile(),
	apiKeyEnv: z.string().default('DEVIN2API_API_KEY').volatile(),
	apiKey: z.string().default('').role('secret').volatile(),
	enabled: z.boolean().default(true).volatile(),
	models: z.array(z.union([z.string(), modelEntry])).default([]).volatile(),
	/** 每个模型是否出现在选择器里；缺省视为开启（与 dsh-opencode-go 一致）。 */
	modelVisibility: z.dict(z.boolean()).default({}).volatile(),
	images: z.boolean().default(true).volatile(),
	contextWindow: z.number().default(262144).volatile(),
	maxTokens: z.number().default(128000).volatile(),
	refreshMinutes: z.number().default(5).volatile(),
	requestTimeoutMs: z.number().default(300000).volatile(),
	imagePixelBudget: z.number().default(4194304).volatile(),
	imageMaxBytes: z.number().default(1048576).volatile(),
	maxRequestImageBytes: z.number().default(20971520).volatile(),
});

/** 插件配置：只支持一个 `devin2api` 路由，字典结构是为了让 Models 页能定位它。 */
export const Config = z.object({
	providers: z.object({ devin2api: profileSchema }).default({}),
});

/** 加载器没套默认值时的兜底值。 */
export const PROFILE_DEFAULTS = Object.freeze({
	displayName: 'Devin2API',
	baseURL: DEFAULT_BASE_URL,
	apiKey: '',
	apiKeyEnv: 'DEVIN2API_API_KEY',
	enabled: true,
	contextWindow: 262144,
	maxTokens: 128000,
	refreshMinutes: 5,
	requestTimeoutMs: 300000,
	models: [],
	modelVisibility: {},
	images: true,
	imagePixelBudget: 4194304,
	imageMaxBytes: 1048576,
	maxRequestImageBytes: 20971520,
});
