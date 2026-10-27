/**
 * 网关目录与额度的纯解析层；不依赖 DSH 运行时。
 */

/**
 * 解析 GET /v1/models。
 * @param {any} payload
 * @returns {{ id: string, name: string, supportsImages: boolean, reasoningEfforts: string[], requiresReasoningEffort: boolean }[]}
 */
export function parseModels(payload) {
	const data = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
	const models = [];
	const seen = new Set();
	for (const entry of data) {
		if (typeof entry?.id !== 'string' || entry.id.length === 0 || seen.has(entry.id)) continue;
		seen.add(entry.id);
		models.push({
			id: entry.id,
			name: typeof entry.name === 'string' && entry.name.length > 0 ? entry.name : entry.id,
			supportsImages: entry.supports_images === true,
			reasoningEfforts: Array.isArray(entry.reasoning_efforts)
				? entry.reasoning_efforts.filter((effort) => typeof effort === 'string' && effort.length > 0)
				: [],
			requiresReasoningEffort: entry.requires_reasoning_effort === true,
		});
	}
	return models;
}

/**
 * 按设置页的开关过滤目录：`false` 表示该模型不出现。
 * 全部关掉时返回原目录——选择器不该因为一次误操作变空。
 * @template T
 * @param {T[]} models
 * @param {Record<string, boolean> | undefined} visibility
 * @returns {T[]}
 */
export function filterByVisibility(models, visibility) {
	if (visibility === undefined || visibility === null || typeof visibility !== 'object') return models;
	const visible = models.filter((entry) => visibility[entry.id] !== false);
	return visible.length === 0 ? models : visible;
}

/**
 * 目录条目转换为 listModels 需要的形状。
 * @param {string} provider
 * @param {ReturnType<typeof parseModels>[number]} entry
 */
export function toCatalogModel(provider, entry) {
	return { provider, id: entry.id, name: entry.name };
}

/**
 * 目录条目转换为 resolveModel 需要的完整能力。
 * @param {string} provider
 * @param {ReturnType<typeof parseModels>[number]} entry
 * @param {{ contextWindow: number, maxTokens: number, images?: boolean }} defaults
 */
export function toResolvedModel(provider, entry, defaults) {
	const info = {
		provider,
		id: entry.id,
		name: entry.name,
		context: { contextWindow: defaults.contextWindow },
		defaultMaxTokens: defaults.maxTokens,
	};
	if (defaults.images !== false && entry.supportsImages) info.inputModalities = ['text', 'image'];
	if (entry.reasoningEfforts.length > 0) {
		const efforts = entry.reasoningEfforts.map((effort) => ({ id: effort, name: effort }));
		info.reasoning = { efforts, defaultEffort: pickDefaultEffort(entry.reasoningEfforts) };
	}
	return info;
}

/**
 * 网关要求带档位时不能省略；优先 high，其次第一个。
 * @param {string[]} efforts
 */
function pickDefaultEffort(efforts) {
	if (efforts.includes('high')) return 'high';
	return efforts[0];
}

/**
 * 解析 GET /v1/quota（供后续客户端用量展示使用）。
 * @param {any} payload
 */
export function parseQuota(payload) {
	const percent = (value) => (Number.isFinite(value) ? value : undefined);
	return {
		plan: typeof payload?.plan === 'string' ? payload.plan : undefined,
		dailyRemainingPercent: percent(payload?.daily_remaining_percent),
		weeklyRemainingPercent: percent(payload?.weekly_remaining_percent),
		dailyResetAt: Number.isFinite(payload?.daily_reset_at) ? payload.daily_reset_at : undefined,
		weeklyResetAt: Number.isFinite(payload?.weekly_reset_at) ? payload.weekly_reset_at : undefined,
		sampledAt: Number.isFinite(payload?.sampled_at) ? payload.sampled_at : undefined,
		stale: payload?.stale === true,
	};
}

/**
 * 把 HTTP 状态与响应体映射为稳定的错误码。
 * @param {number} status
 * @param {string} body
 */
export function classifyHTTPError(status, body) {
	const text = body.length > 0 ? body : `HTTP ${status}`;
	if (status === 401 || status === 403) return { message: text, code: 'AUTH' };
	if (status === 429) return { message: text, code: 'QUOTA' };
	if (status === 400 || status === 413 || status === 422) return { message: text, code: 'INVALID_REQUEST' };
	if (status === 504) return { message: text, code: 'TIMEOUT' };
	return { message: text, code: 'SERVER' };
}

/**
 * 解开 schemastery 的 volatile 单元：设置文档里它是活值，宿主侧是带 get() 的 cell。
 * 非 cell 的值原样返回，所以普通配置也能走这条路径。
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function unwrapVolatile(value) {
	if (value === null || typeof value !== 'object') return value;
	if (typeof value.get === 'function') {
		try {
			return unwrapVolatile(value.get());
		} catch {
			return value;
		}
	}
	if (Array.isArray(value)) return value.map(unwrapVolatile);
	return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, unwrapVolatile(child)]));
}
