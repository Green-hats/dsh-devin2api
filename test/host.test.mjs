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
