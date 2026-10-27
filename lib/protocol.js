/**
 * 纯协议层：把 DSH 的消息/工具词汇翻译成 OpenAI Chat Completions 请求，
 * 并把上游 SSE 分片翻译回 DSH 的 StreamChunk。
 *
 * 这一层不导入任何 DSH 运行时模块，因此可以直接用 node:test 跑。
 *
 * Chunk 词汇（与 @deepseek-ai/dsh-llm 一致）：
 *   { type: 'block-start', index, blockType: 'text' | 'reasoning' | 'tool-call' }
 *   { type: 'text-delta', index, text }
 *   { type: 'reasoning-delta', index, text }
 *   { type: 'tool-call-delta', index, id, name?, argumentsDelta }
 *   { type: 'block-end', index, block: { type: 'text', text } | { type: 'reasoning', text }
 *                                        | { type: 'tool-call', id, name, arguments } }
 *   { type: 'usage', usage: { inputTokens, outputTokens, totalTokens, cacheReadTokens?, cacheWriteTokens? } }
 *   { type: 'finish', reason: { kind: 'stop' | 'max-tokens' | 'tool-calls' }
 *                              | { kind: 'error', failure: { message, code } } }
 */

/** 无法用文本表达的图片/文件占位；DSH 对纯文本路由也会做同样替换。 */
const OMITTED_IMAGE = '[image omitted: this provider is configured as text-only]';
const OMITTED_FILE = '[file reference omitted]';

/**
 * 把一条消息的内容块压平成文本。
 * @param {readonly {type: string, text?: string}[]} content
 * @returns {string}
 */
export function flattenText(content) {
	const parts = [];
	for (const block of content ?? []) {
		if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
		else if (block.type === 'image') parts.push(OMITTED_IMAGE);
		else if (block.type === 'file') parts.push(OMITTED_FILE);
	}
	return parts.join('');
}

/**
 * 把请求级 system 与历史开头的 system/developer 消息合并成一条系统提示。
 * @param {{ system?: string, messages: readonly any[] }} options
 * @returns {{ system: string, messages: readonly any[] }}
 */
export function splitSystem(options) {
	const parts = [];
	if (typeof options.system === 'string' && options.system.length > 0) parts.push(options.system);
	let index = 0;
	for (; index < options.messages.length; index++) {
		const message = options.messages[index];
		if (message.role !== 'system') break;
		const text = flattenText(message.content);
		if (text.length > 0) parts.push(text);
	}
	return { system: parts.join('\n\n'), messages: options.messages.slice(index) };
}

/**
 * 把历史消息转换成 OpenAI Chat Completions 的 messages 数组。
 * @param {{ system?: string, messages: readonly any[] }} options
 * @returns {any[]}
 */
export function toChatMessages(options) {
	const { system, messages: history } = splitSystem(options);
	const messages = [];
	if (system.length > 0) messages.push({ role: 'system', content: system });
	for (const message of history) {
		switch (message.role) {
			case 'developer': {
				// 工具增删事件没有 OpenAI 等价物；把随行的文本并入系统提示更安全。
				const text = flattenText(message.content);
				if (text.length > 0) messages.push({ role: 'system', content: text });
				break;
			}
			case 'user':
				messages.push({ role: 'user', content: toChatContent(message.content) });
				break;
			case 'assistant': {
				const text = flattenText(message.content);
				const toolCalls = [];
				for (const block of message.content ?? []) {
					if (block.type !== 'tool-call') continue;
					toolCalls.push({
						id: block.id,
						type: 'function',
						function: { name: block.name, arguments: stringifyArguments(block.arguments) },
					});
				}
				if (toolCalls.length > 0) messages.push({ role: 'assistant', content: text.length > 0 ? text : null, tool_calls: toolCalls });
				else if (text.length > 0) messages.push({ role: 'assistant', content: text });
				break;
			}
			case 'tool':
				messages.push({
					role: 'tool',
					tool_call_id: message.toolCallId,
					content: toChatContent(message.content),
				});
				break;
			default:
				break;
		}
	}
	return messages;
}

/**
 * 把 DSH 的工具声明转换成 OpenAI function 工具。
 * @param {readonly any[] | undefined} tools
 * @returns {any[] | undefined}
 */
export function toChatTools(tools) {
	const converted = [];
	for (const tool of tools ?? []) {
		if (tool?.deferLoading) continue;
		converted.push({
			type: 'function',
			function: {
				name: tool.name,
				description: tool.description ?? '',
				parameters: tool.parameters ?? { type: 'object', properties: {} },
			},
		});
	}
	return converted.length > 0 ? converted : undefined;
}

/**
 * 构造 OpenAI Chat Completions 请求体。
 * @param {{ model: string, messages: readonly any[], system?: string, tools?: readonly any[], maxTokens?: number, reasoningEffort?: string }} options
 * @param {{ maxTokens: number }} limits
 * @returns {any}
 */
export function toChatRequest(options, limits) {
	const body = {
		model: options.model,
		messages: toChatMessages(options),
		stream: true,
		stream_options: { include_usage: true },
	};
	const tools = toChatTools(options.tools);
	if (tools !== undefined) body.tools = tools;
	const maxTokens = Number.isSafeInteger(options.maxTokens) && options.maxTokens > 0 ? options.maxTokens : limits.maxTokens;
	if (Number.isSafeInteger(maxTokens) && maxTokens > 0) body.max_tokens = maxTokens;
	if (typeof options.reasoningEffort === 'string' && options.reasoningEffort.length > 0) {
		body.reasoning_effort = options.reasoningEffort;
	}
	return body;
}

/**
 * 内容块转成 OpenAI 的 content：纯文本时用字符串，含图片时用分片数组。
 * `image-data` 由适配器预先解析成 data URL；未解析的 image 退化为占位文本。
 * @param {readonly any[]} content
 * @returns {string | any[]}
 */
export function toChatContent(content) {
	const parts = [];
	for (const block of content ?? []) {
		if (block.type === 'text') {
			if (block.text.length > 0) parts.push({ type: 'text', text: block.text });
		} else if (block.type === 'image-data') {
			parts.push({ type: 'image_url', image_url: { url: block.url } });
		} else if (block.type === 'image') {
			parts.push({ type: 'text', text: OMITTED_IMAGE });
		} else if (block.type === 'file') {
			parts.push({ type: 'text', text: OMITTED_FILE });
		}
	}
	if (parts.length === 0) return '';
	const texts = parts.filter((part) => part.type === 'text');
	const images = parts.filter((part) => part.type === 'image_url');
	if (images.length === 0) return texts.map((part) => part.text).join('');
	return [...texts, ...images];
}

/** 工具参数在历史里是对象；上游要求字符串。 */
function stringifyArguments(arguments_) {
	if (typeof arguments_ === 'string') return arguments_;
	try {
		return JSON.stringify(arguments_ ?? {});
	} catch {
		return '{}';
	}
}

/**
 * 逐行读取 SSE 的 `data:` 负载；`[DONE]` 结束迭代。
 * @param {ReadableStream<Uint8Array>} body
 * @returns {AsyncGenerator<string>}
 */
export async function* readSSE(body) {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			for (;;) {
				const newline = buffer.indexOf('\n');
				if (newline < 0) break;
				const line = buffer.slice(0, newline).replace(/\r$/, '');
				buffer = buffer.slice(newline + 1);
				if (!line.startsWith('data:')) continue;
				const data = line.slice(5).trim();
				if (data.length === 0) continue;
				if (data === '[DONE]') return;
				yield data;
			}
		}
	} finally {
		try {
			reader.releaseLock();
		} catch {
			// 已释放或流已被取消，忽略。
		}
	}
}

/**
 * 把一次流式响应翻译成有序 chunk。
 *
 * 上游先发 reasoning、再发正文、最后发工具调用；这里按相反顺序关闭已打开的块，
 * 并在 finish 之前补 usage，保证 DSH 的 BlockAssembler 能完整装配。
 */
export class StreamTranslator {
	constructor() {
		/** @type {Map<number, any>} */
		this.blocks = new Map();
		/** 已分配的块序号。 */
		this.nextIndex = 0;
		/** 当前打开的正文或推理块；工具块各自独立，不占用它。 */
		this.current = undefined;
		/** OpenAI tool_calls 下标到块的映射。 */
		this.tools = new Map();
		/** 上游在 finish_reason 之后才发 usage，这里先记下来。 */
		this.usage = undefined;
		/** @type {string | undefined} */
		this.finishReason = undefined;
		this.finished = false;
		this.produced = false;
	}

	/**
	 * 消费一条 SSE JSON 负载。
	 * @param {any} payload
	 * @returns {any[]}
	 */
	consume(payload) {
		if (this.finished) return [];
		if (payload?.error !== undefined && payload.error !== null) {
			return this.fail(typeof payload.error.message === 'string' ? payload.error.message : 'upstream returned an error chunk', 'UPSTREAM_ERROR');
		}
		const chunks = [];
		if (payload?.usage !== undefined && payload.usage !== null) this.usage = payload.usage;
		const choice = payload?.choices?.[0];
		const delta = choice?.delta ?? {};
		if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
			chunks.push(...this.reasoning(delta.reasoning_content));
		}
		if (typeof delta.content === 'string' && delta.content.length > 0) {
			chunks.push(...this.text(delta.content));
		}
		if (Array.isArray(delta.tool_calls)) {
			for (const call of delta.tool_calls) chunks.push(...this.toolCall(call));
		}
		if (typeof choice?.finish_reason === 'string' && choice.finish_reason.length > 0) {
			this.finishReason = choice.finish_reason;
			chunks.push(...this.closeCurrent());
		}
		return chunks;
	}

	/**
	 * 流结束后收尾：关闭剩余块，按 usage → finish 的顺序补齐终止 chunk。
	 * @returns {any[]}
	 */
	end() {
		if (this.finished) return [];
		this.finished = true;
		const chunks = this.closeAll();
		if (this.usage !== undefined) chunks.push({ type: 'usage', usage: mapUsage(this.usage) });
		if (this.finishReason !== undefined) {
			chunks.push({ type: 'finish', reason: mapFinishReason(this.finishReason) });
		} else if (this.produced) {
			// 少数网关不发 finish_reason 就直接结束；有内容时按正常停止处理。
			chunks.push({ type: 'finish', reason: { kind: 'stop' } });
		} else {
			chunks.push({ type: 'finish', reason: { kind: 'error', failure: { message: 'upstream stream ended without any content', code: 'EMPTY_RESPONSE' } } });
		}
		return chunks;
	}

	/**
	 * 立即以错误终止（例如上游中途返回 error 分片）。
	 * @param {string} message
	 * @param {string} code
	 * @returns {any[]}
	 */
	fail(message, code = 'STREAM_CLOSED') {
		if (this.finished) return [];
		this.finished = true;
		const chunks = this.closeAll();
		if (this.usage !== undefined) chunks.push({ type: 'usage', usage: mapUsage(this.usage) });
		chunks.push({ type: 'finish', reason: { kind: 'error', failure: { message, code } } });
		return chunks;
	}

	/** 打开一个新块并返回 block-start。 */
	openBlock(type) {
		const block = { index: this.nextIndex++, type, text: '', arguments: '', id: '', name: '', closed: false };
		this.blocks.set(block.index, block);
		this.produced = true;
		return { block, chunks: [{ type: 'block-start', index: block.index, blockType: type }] };
	}

	/** 关闭当前正文/推理块。 */
	closeCurrent() {
		const block = this.current;
		if (block === undefined) return [];
		this.current = undefined;
		block.closed = true;
		return [{ type: 'block-end', index: block.index, block: closedBlock(block) }];
	}

	/** 按序号关闭所有未关闭的块。 */
	closeAll() {
		const chunks = this.closeCurrent();
		for (const block of this.blocks.values()) {
			if (block.closed) continue;
			block.closed = true;
			chunks.push({ type: 'block-end', index: block.index, block: closedBlock(block) });
		}
		return chunks;
	}

	/** 让 current 变成指定类型；必要时先关闭旧块。 */
	ensure(type) {
		if (this.current?.type === type) return { block: this.current, chunks: [] };
		const chunks = this.closeCurrent();
		const opened = this.openBlock(type);
		this.current = opened.block;
		return { block: opened.block, chunks: [...chunks, ...opened.chunks] };
	}

	/** @param {string} text */
	reasoning(text) {
		const state = this.ensure('reasoning');
		state.block.text += text;
		state.chunks.push({ type: 'reasoning-delta', index: state.block.index, text });
		return state.chunks;
	}

	/** @param {string} text */
	text(text) {
		const state = this.ensure('text');
		state.block.text += text;
		state.chunks.push({ type: 'text-delta', index: state.block.index, text });
		return state.chunks;
	}

	/** @param {any} call */
	toolCall(call) {
		const key = Number.isInteger(call.index) ? call.index : this.tools.size;
		let block = this.tools.get(key);
		const chunks = [];
		if (block === undefined) {
			chunks.push(...this.closeCurrent());
			const opened = this.openBlock('tool-call');
			block = opened.block;
			chunks.push(...opened.chunks);
			this.tools.set(key, block);
		}
		if (typeof call.id === 'string' && call.id.length > 0) block.id = call.id;
		if (typeof call.function?.name === 'string' && call.function.name.length > 0) block.name = call.function.name;
		const fragment = typeof call.function?.arguments === 'string' ? call.function.arguments : '';
		if (fragment.length > 0) {
			block.arguments += fragment;
			chunks.push({
				type: 'tool-call-delta',
				index: block.index,
				id: block.id,
				...(block.name.length > 0 ? { name: block.name } : {}),
				argumentsDelta: fragment,
			});
		}
		return chunks;
	}
}

/** 把内部块状态转成 block-end 的 block 值。 */
function closedBlock(block) {
	if (block.type === 'tool-call') {
		return { type: 'tool-call', id: block.id, name: block.name, arguments: validArguments(block.arguments) };
	}
	return { type: block.type, text: block.text };
}

/** 上游可能给出非 JSON 参数；DSH 期望对象字符串。 */
function validArguments(raw) {
	if (typeof raw !== 'string' || raw.length === 0) return '{}';
	try {
		const parsed = JSON.parse(raw);
		if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) return raw;
	} catch {
		// fallthrough
	}
	return '{}';
}

/** @param {any} usage */
export function mapUsage(usage) {
	const inputTokens = numberOrZero(usage.prompt_tokens);
	const outputTokens = numberOrZero(usage.completion_tokens);
	const cacheRead = numberOrZero(usage.prompt_tokens_details?.cached_tokens);
	return {
		inputTokens,
		outputTokens,
		totalTokens: numberOrZero(usage.total_tokens) || inputTokens + outputTokens,
		...(cacheRead > 0 ? { cacheReadTokens: cacheRead } : {}),
	};
}

/** @param {string} reason */
export function mapFinishReason(reason) {
	switch (reason) {
		case 'length':
			return { kind: 'max-tokens' };
		case 'tool_calls':
		case 'function_call':
			return { kind: 'tool-calls' };
		default:
			return { kind: 'stop' };
	}
}

function numberOrZero(value) {
	return Number.isSafeInteger(value) && value > 0 ? value : 0;
}
