/**
 * dsh-devin2api：把 devin-2api 网关注册为 DSH 的一个模型提供方。
 *
 * 提供方路由固定为 `devin2api`；模型目录来自网关的 GET /v1/models，
 * 请求走 OpenAI Chat Completions（流式），响应翻译成 DSH 的 StreamChunk。
 *
 * @module dsh-devin2api
 */
import { LlmAdapter, LlmError, attributionHeaders } from '@deepseek-ai/dsh-llm';
import {
	classifyHTTPError,
	filterByVisibility,
	parseModels,
	toCatalogModel,
	toResolvedModel,
	unwrapVolatile,
} from './catalog.js';
import { readSSE, StreamTranslator, toChatRequest } from './protocol.js';
import { Config, PROFILE_DEFAULTS, PROVIDER } from './schema.js';

export { Config, PROVIDER };

/** Cordis 插件名。 */
export const name = 'devin2api';

/** 依赖 llm 服务。 */
export const inject = ['llm'];

/** 把适配器注册进 llm 服务。 */
export function apply(ctx, config) {
	// 只解引用 `enabled` 做一次挂载判断；route 配置必须保持原始引用。
	// Loader 的 volatile 更新只写入这些引用的快照，不会重新 apply 插件，
	// 提前 unwrap 整棵配置树会让适配器永远停在挂载时的值。
	const profile = profileOf(config);
	if (unwrapVolatile(profile.enabled) === false) {
		ctx.logger.info('devin2api: disabled by configuration; no provider route registered');
		return;
	}
	const adapter = new DevinAdapter(profile, ctx.logger, () =>
		typeof ctx.get === 'function' ? ctx.get('attachments') : undefined,
	);
	ctx.llm.registerAdapter([PROVIDER], adapter);
	publishDirectory(ctx, adapter);
}

/** 排障：把宿主侧结论写进网关的 /__clientlog（本地调试用，失败静默）。 */
function report(line) {
	const base = 'http://127.0.0.1:18089/__clientlog';
	try {
		void fetch(base, {
			method: 'POST',
			headers: { 'content-type': 'text/plain' },
			body: `${new Date().toISOString()} [host] ${line}\n`,
		}).catch(() => {});
	} catch {
		/* 排障本身不能影响加载 */
	}
}

/**
 * 把 provider 暴露给 Models 设置页与模型发现。
 * 旧版 DSH 没有这两个方法；失败只降级，不能影响已经注册好的 provider。
 */
function publishDirectory(ctx, adapter) {
	const settingsNs = ctx.fiber?.entry?.options?.id ?? PROVIDER;
	try {
		ctx.llm.registerConfigurableProviders?.([
			{
				provider: PROVIDER,
				displayName: adapter.config.displayName,
				settingsNs,
				settingsPath: ['providers', PROVIDER],
				defaultBaseURL: adapter.config.baseURL,
				baseURLEnv: ['DEVIN2API_BASE_URL'],
			},
		]);
		ctx.llm.registerModelDiscovery?.(settingsNs, (request, signal) => discoverModels(request, adapter.config, signal));
	} catch (error) {
		ctx.logger.warn?.(`devin2api: cannot publish the provider directory: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (typeof ctx.inject !== 'function') return;
	ctx.inject(['settings'], (child) => {
		try {
			child.effect(() => child.settings.configure({ auto: false }, ctx.fiber));
		} catch (error) {
			ctx.logger.warn?.(`devin2api: settings page registration failed: ${error instanceof Error ? error.message : String(error)}`);
		}
		// 排障：插件自己看不到设置文档，只能问宿主。
		try {
			const entryId = ctx.fiber?.entry?.options?.id;
			const descriptors = child.settings.describe?.();
			const rows = Array.isArray(descriptors) ? descriptors : [];
			report(
				`entry=${entryId} namespaces=[${rows.map((row) => row.ns).join(',')}] present=${rows.some((row) => row.ns === entryId)}`,
			);
		} catch (error) {
			report(`describe failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	});
}

/**
 * 回答 Models 页「这个端点有哪些模型」。
 * @param {{ baseURL?: string }} request
 * @param {any} config
 * @param {AbortSignal} [signal]
 */
async function discoverModels(request, config, signal) {
	const baseURL = (typeof request?.baseURL === 'string' && request.baseURL.length > 0 ? request.baseURL : config.baseURL).replace(/\/+$/, '');
	const headers = { ...attributionHeaders() };
	// 发现是一次性探测：Models 页刚输入、还没保存的 key 优先于已保存的配置。
	const requestedKey = typeof request?.apiKey === 'string' ? request.apiKey.trim() : '';
	const key = requestedKey.length > 0 ? requestedKey : resolveKey(config);
	if (key.length > 0) headers.authorization = `Bearer ${key}`;
	let response;
	try {
		response = await fetch(`${baseURL}/models`, { headers, signal });
	} catch (error) {
		throw gatewayUnreachable(baseURL, error);
	}
	if (!response.ok) {
		const body = await response.text().catch(() => '');
		const mapped = classifyHTTPError(response.status, body);
		throw new LlmError(`devin2api: ${mapped.message}`, mapped.code);
	}
	return filterByVisibility(parseModels(await response.json()), config.modelVisibility)
		.map((entry) => ({
			id: entry.id,
			name: entry.name,
			contextWindow: config.contextWindow,
			maxTokens: config.maxTokens,
			...(config.images !== false && entry.supportsImages ? { inputModalities: ['text', 'image'] } : {}),
		}));
}

/** devin-2api 的 LlmAdapter 实现。 */
export class DevinAdapter extends LlmAdapter {
	/**
	 * @param {z.infer<typeof Config>} config
	 * @param {{ warn: Function, info: Function, error: Function }} logger
	 */
	constructor(config, logger, resolveAttachments) {
		super();
		/** 原始配置节点：volatile 字段是没有 remount 也能改的活值，必须每次现读。 */
		this.rawConfig = config ?? {};
		this.logger = logger ?? console;
		this.resolveAttachments = resolveAttachments;
		/** @type {{ at: number, models: ReturnType<typeof parseModels> } | undefined} */
		this.catalogCache = undefined;
		/** @type {Promise<ReturnType<typeof parseModels>> | undefined} */
		this.catalogInflight = undefined;
	}

	/**
	 * 当前生效的配置：每次读取都解开 volatile 单元，所以设置页改动立刻可见。
	 * @returns {typeof PROFILE_DEFAULTS}
	 */
	get config() {
		const profile = unwrapVolatile(this.rawConfig) ?? {};
		return {
			...PROFILE_DEFAULTS,
			...Object.fromEntries(Object.entries(profile).filter(([, value]) => value !== undefined)),
		};
	}

	/** 提供方展示信息。 */
	providerInfo(provider) {
		return { id: provider, name: 'Devin2API' };
	}

	/**
	 * 列出网关当前可用的模型。
	 * @param {string} provider
	 */
	async listModels(provider) {
		const models = await this.loadCatalog();
		const allowed = (Array.isArray(this.config.models) ? this.config.models : [])
			.map((item) => (typeof item === 'string' ? item : item?.id))
			.filter((id) => typeof id === 'string' && id.length > 0);
		const advertised = this.applyVisibility(
			allowed.length === 0 ? models : this.allowlisted(models, allowed),
		);
		return advertised.map((entry) => toCatalogModel(provider, entry));
	}

	/** 按 `models` 白名单过滤；白名单全部失效时退回整个目录。 */
	allowlisted(models, allowed) {
		const selected = models.filter((entry) => allowed.includes(entry.id));
		if (selected.length === 0) {
			this.logger.warn?.(`devin2api: configured models [${allowed.join(', ')}] are absent from the gateway catalog; advertising all ${models.length} models instead`);
			return models;
		}
		return selected;
	}

	/** 去掉在设置页被关掉的模型；全部关掉时同样退回整个目录，避免选择器空掉。 */
	applyVisibility(models) {
		const visible = filterByVisibility(models, this.config.modelVisibility);
		if (visible.length === models.length && models.length > 0) {
			const allOff = models.every((entry) => this.config.modelVisibility?.[entry.id] === false);
			if (allOff) this.logger.warn?.(`devin2api: every model is switched off; advertising all ${models.length} models instead`);
		}
		return visible;
	}

	/**
	 * 解析单个模型的能力；目录里没有时回退到配置默认值，保证核心路由仍可用。
	 * @param {string} provider
	 * @param {string} model
	 * @param {AbortSignal} [signal]
	 */
	async resolveModel(provider, model, signal) {
		let entries = this.catalogCache?.models;
		try {
			entries = await this.loadCatalog(signal);
		} catch (error) {
			if (entries === undefined) {
				this.logger.warn?.(`devin2api: catalog unavailable while resolving "${model}": ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		const entry = entries?.find((candidate) => candidate.id === model) ?? {
			id: model,
			name: model,
			supportsImages: false,
			reasoningEfforts: [],
			requiresReasoningEffort: false,
		};
		return toResolvedModel(provider, entry, {
			contextWindow: this.config.contextWindow,
			maxTokens: this.config.maxTokens,
			images: this.config.images,
		});
	}

	/**
	 * 发起一次流式调用。
	 * @param {any} options
	 * @returns {AsyncGenerator<any>}
	 */
	async *stream(options) {
		const translator = new StreamTranslator();
		let response;
		try {
			const messages = await this.withImages(options.messages, options.signal);
			response = await this.openStream({ ...options, messages });
		} catch (error) {
			throw normaliseError(error);
		}
		if (response.body === null) {
			throw new LlmError('devin2api: gateway returned an empty response body', 'TRANSPORT');
		}
		try {
			for await (const data of readSSE(response.body)) {
				let payload;
				try {
					payload = JSON.parse(data);
				} catch {
					continue;
				}
				for (const chunk of translator.consume(payload)) yield chunk;
				if (translator.finished) return;
			}
			for (const chunk of translator.end()) yield chunk;
		} catch (error) {
			// 用户取消要抛给宿主：它按 signal.aborted 转成 aborted 终止；
			// 在生成器里吞掉异常并产出 error 分片会被界面当成传输失败。
			if (options.signal?.aborted === true) throw new LlmError('devin2api: request aborted', 'ABORTED');
			for (const chunk of translator.fail(error instanceof Error ? error.message : String(error), 'TRANSPORT')) yield chunk;
		}
	}

	/** 建立流式请求；HTTP 错误在这里抛出。 */
	async openStream(options) {
		const url = `${trimBaseURL(this.config.baseURL)}/chat/completions`;
		const signal = combineSignals(options.signal, AbortSignal.timeout(this.config.requestTimeoutMs));
		let response;
		try {
			response = await fetch(url, {
				method: 'POST',
				headers: this.headers(),
				body: JSON.stringify(toChatRequest(options, { maxTokens: this.config.maxTokens })),
				signal,
			});
		} catch (error) {
			throw gatewayUnreachable(this.config.baseURL, error);
		}
		if (!response.ok) {
			const body = await response.text().catch(() => '');
			const mapped = classifyHTTPError(response.status, body);
			throw new LlmError(`devin2api: ${mapped.message}`, mapped.code);
		}
		return response;
	}

	/**
	 * 把当前轮图片解析成 data URL；历史图片替换为占位文本，
	 * 避免把整个会话的历史图重复上传（网关本身也只接受当前轮图片）。
	 *
	 * 当前轮从**最后一条 user 消息**开始：工具调用产生的 assistant/tool 消息
	 * 仍属于同一轮，图片要继续上传，否则模型第二次思考就看不到图。
	 * @param {readonly any[]} messages
	 * @param {AbortSignal} [signal]
	 */
	async withImages(messages, signal) {
		if (this.config.images === false) return messages;
		const attachments = this.resolveAttachments?.();
		if (attachments === undefined || attachments === null) return messages;
		let lastUser = -1;
		for (let index = 0; index < messages.length; index++) {
			if (messages[index]?.role === 'user') lastUser = index;
		}
		const resolved = new Map();
		let budget = this.config.maxRequestImageBytes;
		const output = [];
		for (let index = 0; index < messages.length; index++) {
			const message = messages[index];
			if (!Array.isArray(message?.content)) {
				output.push(message);
				continue;
			}
			let touched = false;
			const content = [];
			for (const block of message.content) {
				if (block?.type !== 'image') {
					content.push(block);
					continue;
				}
				touched = true;
				if (block.offloaded === true || index < lastUser) {
					content.push({ type: 'text', text: '[Image omitted from history]' });
					continue;
				}
				const key = String(block.attachment?.attachmentId ?? index);
				let url = resolved.get(key);
				if (url === undefined) {
					url = await this.readImageURL(block.attachment, attachments, signal);
					resolved.set(key, url);
					budget -= url.length;
					if (budget < 0) throw new LlmError('devin2api: request images exceed maxRequestImageBytes', 'IMAGE_BUDGET');
				}
				content.push({ type: 'image-data', url });
			}
			output.push(touched ? { ...message, content } : message);
		}
		return output;
	}

	/** 读取一张请求图片并编码为 data URL。 */
	async readImageURL(attachment, attachments, signal) {
		if (attachment === undefined || attachment === null) {
			throw new LlmError('devin2api: image block carries no attachment reference', 'IMAGE_UNAVAILABLE');
		}
		const target = this.imageTarget(attachment);
		let version;
		try {
			version = await attachments.readImageRequest(attachment, target, signal);
		} catch (error) {
			throw new LlmError(`devin2api: cannot read image attachment: ${error instanceof Error ? error.message : String(error)}`, 'IMAGE_UNAVAILABLE');
		}
		const mediaType = version?.mediaType ?? attachment.mediaType ?? 'image/png';
		return `data:${mediaType};base64,${Buffer.from(version.data).toString('base64')}`;
	}

	
/** 该路由选定的图片请求尺寸；与 readImageURL 使用的目标保持一致。 */
	imageRequestTarget(_provider, _model, image) {
		return this.imageTarget(image);
	}

	/** 按像素预算缩放图片，并限制编码后的字节数。 */
	imageTarget(image) {
		const width = Number.isFinite(image?.width) && image.width > 0 ? image.width : 1;
		const height = Number.isFinite(image?.height) && image.height > 0 ? image.height : 1;
		return {
			...requestImageDimensions(width, height, this.config.imagePixelBudget),
			maxBytes: this.config.imageMaxBytes,
		};
	}

	/** 请求头：归属标识 + 可选的 bearer 密钥。 */
	headers() {
		const headers = { 'content-type': 'application/json', ...attributionHeaders() };
		const key = resolveKey(this.config);
		if (key.length > 0) headers.authorization = `Bearer ${key}`;
		return headers;
	}

	/**
	 * 读取目录，带 TTL 缓存、单飞与失败回退。
	 * @param {AbortSignal} [signal]
	 */
	async loadCatalog(signal) {
		const ttl = Math.max(1, this.config.refreshMinutes) * 60_000;
		if (this.catalogCache !== undefined && Date.now() - this.catalogCache.at < ttl) {
			return this.catalogCache.models;
		}
		if (this.catalogInflight !== undefined) return this.catalogInflight;
		this.catalogInflight = this.fetchCatalog(signal)
			.then((models) => {
				this.catalogCache = { at: Date.now(), models };
				return models;
			})
			.catch((error) => {
				if (this.catalogCache !== undefined) {
					this.logger.warn?.(`devin2api: catalog refresh failed, serving cached models: ${error instanceof Error ? error.message : String(error)}`);
					return this.catalogCache.models;
				}
				const configured = (Array.isArray(this.config.models) ? this.config.models : [])
					.map((item) => (typeof item === 'string' ? item : item?.id))
					.filter((id) => typeof id === 'string' && id.length > 0);
				if (configured.length > 0) {
					return configured.map((id) => ({
						id,
						name: id,
						supportsImages: false,
						reasoningEfforts: [],
						requiresReasoningEffort: false,
					}));
				}
				throw error;
			})
			.finally(() => {
				this.catalogInflight = undefined;
			});
		return this.catalogInflight;
	}

	/** 实际拉取 GET /v1/models。 */
	async fetchCatalog(signal) {
		let response;
		try {
			response = await fetch(`${trimBaseURL(this.config.baseURL)}/models`, {
				method: 'GET',
				headers: this.headers(),
				signal: combineSignals(signal, AbortSignal.timeout(this.config.requestTimeoutMs)),
			});
		} catch (error) {
			throw gatewayUnreachable(this.config.baseURL, error);
		}
		if (!response.ok) {
			const body = await response.text().catch(() => '');
			const mapped = classifyHTTPError(response.status, body);
			throw new LlmError(`devin2api: ${mapped.message}`, mapped.code);
		}
		const models = parseModels(await response.json());
		if (models.length === 0) throw new LlmError('devin2api: gateway advertised no models', 'EMPTY_CATALOG');
		return models;
	}
}

/**
 * 按总像素预算做等比缩放（与 DSH 附件包的 requestImageDimensions 同算法），
 * 内联在这里以避免多一个运行时 peer 依赖。
 * @param {number} width
 * @param {number} height
 * @param {number} maxPixels
 */
function requestImageDimensions(width, height, maxPixels) {
	const scale = Math.min(1, Math.sqrt(maxPixels / (width * height)));
	if (scale === 1) return { width, height };
	if (width >= height) {
		let projectedWidth = Math.max(1, Math.floor(width * scale));
		let projectedHeight = Math.max(1, Math.round((projectedWidth * height) / width));
		while (projectedWidth * projectedHeight > maxPixels && projectedWidth > 1) {
			projectedWidth -= 1;
			projectedHeight = Math.max(1, Math.round((projectedWidth * height) / width));
		}
		return { width: projectedWidth, height: projectedHeight };
	}
	let projectedHeight = Math.max(1, Math.floor(height * scale));
	let projectedWidth = Math.max(1, Math.round((projectedHeight * width) / height));
	while (projectedWidth * projectedHeight > maxPixels && projectedHeight > 1) {
		projectedHeight -= 1;
		projectedWidth = Math.max(1, Math.round((projectedHeight * width) / height));
	}
	return { width: projectedWidth, height: projectedHeight };
}

/**
 * 取出 `providers.devin2api` 的原始配置对象。
 *
 * 正常情况下它直接挂在 `config.providers` 下，内部每个字段都是带 `get()` 的
 * volatile 单元；这里不能展开它们，否则设置页的改动再也到不了适配器。
 * 只有 `providers` 自己被标成 volatile 时才退化为一次快照。
 * @param {any} config
 * @returns {Record<string, any>}
 */
function profileOf(config) {
	const providers = config?.providers;
	if (providers === null || typeof providers !== 'object') return {};
	if (typeof providers.get === 'function') return unwrapVolatile(providers)?.[PROVIDER] ?? {};
	return providers[PROVIDER] ?? {};
}

/** 优先直接配置的密钥，其次环境变量。 */
function resolveKey(config) {
	if (typeof config.apiKey === 'string' && config.apiKey.trim().length > 0) return config.apiKey.trim();
	const name = typeof config.apiKeyEnv === 'string' ? config.apiKeyEnv.trim() : '';
	const value = name.length > 0 ? process.env[name] : undefined;
	return typeof value === 'string' ? value.trim() : '';
}

/** 去掉末尾斜杠。 */
function trimBaseURL(baseURL) {
	return String(baseURL ?? '').replace(/\/+$/, '');
}

/** 组合调用方 signal 与超时 signal。 */
function combineSignals(a, b) {
	if (a === undefined || a === null) return b;
	if (typeof AbortSignal.any === 'function') return AbortSignal.any([a, b]);
	return a;
}

/**
 * 网关不可达时说清楚是哪个地址、下一步该做什么，而不是只留一个 "fetch failed"。
 * @param {string} baseURL
 * @param {unknown} error
 */
function gatewayUnreachable(baseURL, error) {
	const target = trimBaseURL(baseURL);
	if (error instanceof Error && error.name === 'AbortError') {
		return new LlmError(`devin2api: request to ${target} was aborted`, 'ABORTED');
	}
	if (error instanceof Error && error.name === 'TimeoutError') {
		return new LlmError(`devin2api: request to ${target} timed out`, 'TIMEOUT');
	}
	const cause = error instanceof Error ? error.message : String(error);
	return new LlmError(`devin2api: cannot reach the gateway at ${target} (${cause}); start devin-2api or fix baseURL`, 'TRANSPORT');
}

/** 把任意异常规整成 LlmError。 */
function normaliseError(error) {
	if (error instanceof LlmError) return error;
	if (error instanceof Error) {
		if (error.name === 'AbortError') return new LlmError('devin2api: request aborted', 'ABORTED');
		if (error.name === 'TimeoutError') return new LlmError('devin2api: request timed out', 'TIMEOUT');
		return new LlmError(`devin2api: ${error.message}`, 'TRANSPORT');
	}
	return new LlmError(`devin2api: ${String(error)}`, 'TRANSPORT');
}
