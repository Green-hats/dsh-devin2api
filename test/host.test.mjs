/**
 * 宿主侧测试：用本地 stub 的 @deepseek-ai/dsh-llm 加载适配器，
 * 验证 volatile 配置的实时读取、模型开关过滤与降级行为。
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';

// 宿主模块依赖 @deepseek-ai/dsh-llm（真实实现由 DSH 运行时提供）。
// 本地测试用 node_modules 里的 stub；没有 stub 时跳过这组用例。
let DevinAdapter;
let apply;
try {
	({ DevinAdapter, apply } = await import('../lib/index.js'));
} catch (error) {
	console.warn(`跳过宿主测试：${error.message}`);
}

/** 造一个和 schemastery 一样带 get() 的活值单元。 */
function cell(value) {
	return { get: () => value };
}

/** 起一个假网关，返回模型目录。 */
async function startCatalog(models) {
	const server = http.createServer((_request, response) => {
		response.setHeader('content-type', 'application/json');
		response.end(JSON.stringify({ object: 'list', data: models }));
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	const { port } = server.address();
	return { baseURL: `http://127.0.0.1:${port}/v1`, close: () => new Promise((resolve) => server.close(resolve)) };
}

const needsHost = { skip: DevinAdapter === undefined ? '缺少 @deepseek-ai/dsh-llm 的本地 stub' : false };

test('配置每次读取都解开 volatile 单元', needsHost, () => {
	let base = 'http://a.example/v1';
	const adapter = new DevinAdapter(
		{ baseURL: cell({ get: () => base }), modelVisibility: cell({}) },
		console,
		() => undefined,
	);
	assert.equal(adapter.config.baseURL, 'http://a.example/v1');
	base = 'http://b.example/v1';
	assert.equal(adapter.config.baseURL, 'http://b.example/v1', 'volatile 改动应立即生效');
	assert.equal(adapter.config.maxTokens, 128000, '未配置字段回落到默认值');
});

test('模型开关改动后 listModels 立即过滤', needsHost, async (t) => {
	const gateway = await startCatalog([
		{ id: 'alpha', supports_images: true },
		{ id: 'beta', supports_images: false },
	]);
	t.after(() => gateway.close());

	const visibility = {};
	const adapter = new DevinAdapter(
		{ baseURL: gateway.baseURL, modelVisibility: { get: () => visibility } },
		console,
		() => undefined,
	);
	assert.deepEqual((await adapter.listModels('devin2api')).map((m) => m.id), ['alpha', 'beta']);

	visibility.beta = false;
	assert.deepEqual((await adapter.listModels('devin2api')).map((m) => m.id), ['alpha']);

	visibility.alpha = false;
	assert.deepEqual(
		(await adapter.listModels('devin2api')).map((m) => m.id),
		['alpha', 'beta'],
		'全部关掉时退回完整目录',
	);
});

test('enabled=false 时不注册提供方', needsHost, () => {
	const registered = [];
	const ctx = {
		logger: { info() {}, warn() {} },
		llm: { registerAdapter: (...args) => registered.push(args) },
		get: () => undefined,
	};
	apply(ctx, { providers: { devin2api: { enabled: cell(false) } } });
	assert.equal(registered.length, 0);
});

test('enabled=true 时注册一个路由', needsHost, () => {
	const registered = [];
	const ctx = {
		logger: { info() {}, warn() {} },
		llm: { registerAdapter: (...args) => registered.push(args) },
		get: () => undefined,
	};
	apply(ctx, { providers: { devin2api: { enabled: cell(true), baseURL: cell('http://127.0.0.1:1/v1') } } });
	assert.equal(registered.length, 1);
	assert.deepEqual(registered[0][0], ['devin2api']);
});

test('apply 保留 volatile 引用：挂载后的设置变更仍能到达适配器', needsHost, () => {
	let base = 'http://a.example/v1';
	const visibility = {};
	const registered = [];
	const ctx = {
		logger: { info() {}, warn() {} },
		llm: {
			registerAdapter: (...args) => registered.push(args[1]),
			registerConfigurableProviders() {},
			registerModelDiscovery() {},
		},
		get: () => undefined,
	};
	apply(ctx, {
		providers: {
			devin2api: {
				enabled: { get: () => true },
				baseURL: { get: () => base },
				modelVisibility: { get: () => visibility },
			},
		},
	});
	const adapter = registered[0];
	assert.equal(adapter.config.baseURL, 'http://a.example/v1', '挂载时读到初始值');
	base = 'http://b.example/v1';
	visibility.beta = false;
	assert.equal(adapter.config.baseURL, 'http://b.example/v1', '设置变更应立即生效');
	assert.deepEqual(adapter.config.modelVisibility, { beta: false });
});

/** 假附件服务：任何引用都返回一小段 PNG 字节。 */
function fakeAttachments() {
	return {
		readImageRequest: async () => ({ data: new Uint8Array([137, 80, 78, 71]), mediaType: 'image/png' }),
	};
}

test('工具调用不打断当前轮图片上传', needsHost, async () => {
	const adapter = new DevinAdapter({ images: true }, console, () => fakeAttachments());
	const image = {
		type: 'image',
		attachment: { attachmentId: 'a1', mediaType: 'image/png', bytes: 4, width: 10, height: 10 },
	};
	const turn = [
		{ role: 'user', content: [{ type: 'text', text: 'look' }, image] },
		{ role: 'assistant', content: [{ type: 'tool-call', id: 'c1', name: 'look', arguments: '{}' }] },
		{ role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: 'done' }] },
	];
	const kept = await adapter.withImages(turn);
	assert.equal(kept[0].content[1].type, 'image-data', '同一轮的工具调用后仍应上传图片');

	const next = await adapter.withImages([
		...turn,
		{ role: 'assistant', content: [{ type: 'text', text: 'A screenshot.' }] },
		{ role: 'user', content: [{ type: 'text', text: 'and this?' }] },
	]);
	assert.ok(
		next[0].content.some((block) => block.type === 'text' && block.text.includes('Image omitted from history')),
		'新一轮开始后历史图片应替换为占位文本',
	);
});

test('流式中途取消抛出 ABORTED，而不是 TRANSPORT', needsHost, async () => {
	const originalFetch = globalThis.fetch;
	const controller = new AbortController();
	let streamController;
	try {
		globalThis.fetch = async () => {
			const body = new ReadableStream({
				start(target) {
					streamController = target;
					target.enqueue(
						new TextEncoder().encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'),
					);
				},
			});
			return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
		};
		const adapter = new DevinAdapter({ baseURL: 'http://x/v1' }, console, () => undefined);
		const chunks = [];
		await assert.rejects(
			(async () => {
				for await (const chunk of adapter.stream({
					provider: 'devin2api',
					model: 'm',
					signal: controller.signal,
					messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
				})) {
					chunks.push(chunk);
					if (chunk.type === 'text-delta') {
						controller.abort();
						streamController.error(new DOMException('The operation was aborted.', 'AbortError'));
					}
				}
			})(),
			(error) => error?.code === 'ABORTED',
		);
		assert.ok(chunks.some((chunk) => chunk.type === 'text-delta'), '取消前的内容仍然产出');
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test('模型发现优先使用请求里的临时密钥', needsHost, async () => {
	const originalFetch = globalThis.fetch;
	let discovery;
	const ctx = {
		logger: { info() {}, warn() {} },
		llm: {
			registerAdapter() {},
			registerConfigurableProviders() {},
			registerModelDiscovery: (_ns, callback) => {
				discovery = callback;
			},
		},
		get: () => undefined,
	};
	apply(ctx, { providers: { devin2api: { enabled: cell(true), baseURL: cell('http://saved.example/v1') } } });
	let seen;
	try {
		globalThis.fetch = async (url, init) => {
			seen = { url: String(url), authorization: init?.headers?.authorization };
			return new Response(JSON.stringify({ data: [{ id: 'm1' }] }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			});
		};
		const models = await discovery({ baseURL: 'http://draft.example/v1', apiKey: 'draft-key' });
		assert.equal(seen.url, 'http://draft.example/v1/models');
		assert.equal(seen.authorization, 'Bearer draft-key');
		assert.deepEqual(models.map((model) => model.id), ['m1']);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test('providerInfo 使用配置里的 displayName', needsHost, () => {
	const adapter = new DevinAdapter({ displayName: cell('我的 Devin') }, console, () => undefined);
	assert.deepEqual(adapter.providerInfo('devin2api'), { id: 'devin2api', name: '我的 Devin' });
	assert.equal(new DevinAdapter({}, console, () => undefined).providerInfo('devin2api').name, 'Devin2API');
});
