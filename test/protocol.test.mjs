/**
 * 协议层测试：不依赖 DSH 运行时，直接用 node:test 跑。
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';

import { parseModels, classifyHTTPError, parseQuota, toResolvedModel } from '../lib/catalog.js';
import { StreamTranslator, readSSE, toChatMessages, toChatRequest } from '../lib/protocol.js';

/** 起一个只发 SSE 的假网关。 */
async function startGateway(frames) {
	const server = http.createServer((request, response) => {
		if (request.url === '/v1/models') {
			response.setHeader('content-type', 'application/json');
			response.end(JSON.stringify({ object: 'list', data: [{ id: 'glm-5-2', supports_images: false, reasoning_efforts: ['high', 'low'] }] }));
			return;
		}
		response.setHeader('content-type', 'text/event-stream');
		for (const frame of frames) response.write(`data: ${JSON.stringify(frame)}\n\n`);
		response.write('data: [DONE]\n\n');
		response.end();
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	const { port } = server.address();
	return { baseURL: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

/** 消费整个 SSE 响应并汇总翻译结果。 */
async function translate(baseURL) {
	const response = await fetch(`${baseURL}/v1/chat/completions`, { method: 'POST' });
	const translator = new StreamTranslator();
	const chunks = [];
	for await (const data of readSSE(response.body)) {
		const parsed = JSON.parse(data);
		chunks.push(...translator.consume(parsed));
		if (translator.finished) break;
	}
	chunks.push(...translator.end());
	return chunks;
}

test('消息与工具转换为 OpenAI Chat Completions', () => {
	const options = {
		system: 'base prompt',
		messages: [
			{ role: 'system', content: [{ type: 'text', text: 'leading system' }] },
			{ role: 'user', content: [{ type: 'text', text: 'hi' }] },
			{
				role: 'assistant',
				content: [
					{ type: 'reasoning', text: 'thinking is not replayed' },
					{ type: 'text', text: 'calling' },
					{ type: 'tool-call', id: 'call-1', name: 'lookup', arguments: { city: 'Paris' } },
				],
			},
			{ role: 'tool', toolCallId: 'call-1', content: [{ type: 'text', text: 'sunny' }] },
		],
		tools: [
			{ name: 'lookup', description: 'weather', parameters: { type: 'object', properties: {} } },
			{ name: 'deferred', description: 'later', deferLoading: true, parameters: { type: 'object' } },
		],
		maxTokens: 256,
		reasoningEffort: 'high',
	};
	const messages = toChatMessages(options);
	assert.deepEqual(messages[0], { role: 'system', content: 'base prompt\n\nleading system' });
	assert.deepEqual(messages[1], { role: 'user', content: 'hi' });
	assert.equal(messages[2].role, 'assistant');
	assert.equal(messages[2].content, 'calling');
	assert.deepEqual(messages[2].tool_calls, [
		{ id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{"city":"Paris"}' } },
	]);
	assert.deepEqual(messages[3], { role: 'tool', tool_call_id: 'call-1', content: 'sunny' });

	const body = toChatRequest({ ...options, model: 'glm-5-2' }, { maxTokens: 128000 });
	assert.equal(body.model, 'glm-5-2');
	assert.equal(body.stream, true);
	assert.deepEqual(body.stream_options, { include_usage: true });
	assert.equal(body.max_tokens, 256);
	assert.equal(body.reasoning_effort, 'high');
	assert.equal(body.tools.length, 1, 'tools with deferLoading must be skipped');
	assert.equal(body.tools[0].function.name, 'lookup');
});

test('图片在纯文本路由上退化为占位文本', () => {
	const messages = toChatMessages({
		messages: [{ role: 'user', content: [{ type: 'text', text: 'see ' }, { type: 'image' }, { type: 'file' }] }],
	});
	assert.equal(messages[0].content, 'see [image omitted: this provider is configured as text-only][file reference omitted]');
});

test('当前轮图片转成 image_url 分片', () => {
	const messages = toChatMessages({
		messages: [
			{
				role: 'user',
				content: [
					{ type: 'text', text: 'what is this?' },
					{ type: 'image-data', url: 'data:image/png;base64,AAAA' },
				],
			},
		],
	});
	assert.deepEqual(messages[0], {
		role: 'user',
		content: [
			{ type: 'text', text: 'what is this?' },
			{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
		],
	});
});

test('目录声明的图片能力映射到 inputModalities', () => {
	const entry = { id: 'vision', name: 'vision', supportsImages: true, reasoningEfforts: [] };
	const enabled = toResolvedModel('devin2api', entry, { contextWindow: 1000, maxTokens: 100, images: true });
	assert.deepEqual(enabled.inputModalities, ['text', 'image']);
	const disabled = toResolvedModel('devin2api', entry, { contextWindow: 1000, maxTokens: 100, images: false });
	assert.equal(disabled.inputModalities, undefined);
});

test('流式翻译按网关顺序产出块、usage 与 finish', async () => {
	const frames = [
		{ choices: [{ delta: { role: 'assistant' } }] },
		{ choices: [{ delta: { reasoning_content: 'think ' } }] },
		{ choices: [{ delta: { reasoning_content: 'more' } }] },
		{ choices: [{ delta: { content: 'hello ' } }] },
		{ choices: [{ delta: { content: 'world' } }] },
		{
			choices: [
				{
					delta: {
						tool_calls: [{ index: 0, id: 'call-1', function: { name: 'lookup', arguments: '{"city":' } }],
					},
				},
			],
		},
		{ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"Paris"}' } }] } }] },
		{ choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
		{ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, prompt_tokens_details: { cached_tokens: 4 } } },
	];
	const gateway = await startGateway(frames);
	try {
		const chunks = await translate(gateway.baseURL);
		const starts = chunks.filter((chunk) => chunk.type === 'block-start').map((chunk) => [chunk.index, chunk.blockType]);
		assert.deepEqual(starts, [
			[0, 'reasoning'],
			[1, 'text'],
			[2, 'tool-call'],
		]);
		const ends = chunks.filter((chunk) => chunk.type === 'block-end');
		assert.deepEqual(
			ends.map((chunk) => [chunk.index, chunk.block.type]),
			[
				[0, 'reasoning'],
				[1, 'text'],
				[2, 'tool-call'],
			],
		);
		assert.equal(ends[0].block.text, 'think more');
		assert.equal(ends[1].block.text, 'hello world');
		assert.equal(ends[2].block.id, 'call-1');
		assert.equal(ends[2].block.name, 'lookup');
		assert.equal(ends[2].block.arguments, '{"city":"Paris"}');

		const usage = chunks.find((chunk) => chunk.type === 'usage');
		assert.deepEqual(usage.usage, { inputTokens: 10, outputTokens: 5, totalTokens: 15, cacheReadTokens: 4 });

		const last = chunks.at(-1);
		assert.equal(last.type, 'finish');
		assert.deepEqual(last.reason, { kind: 'tool-calls' });
		assert.equal(
			chunks.findIndex((chunk) => chunk.type === 'usage') < chunks.findIndex((chunk) => chunk.type === 'finish'),
			true,
			'usage must precede finish',
		);
	} finally {
		await gateway.close();
	}
});

test('上游 error 分片转成终止错误', () => {
	const translator = new StreamTranslator();
	const chunks = translator.consume({ choices: [], error: { message: 'resource_exhausted: quota', type: 'rate_limit_error' } });
	const last = chunks.at(-1);
	assert.equal(last.type, 'finish');
	assert.deepEqual(last.reason.kind, 'error');
	assert.equal(last.reason.failure.code, 'UPSTREAM_ERROR');
	assert.equal(last.reason.failure.message, 'resource_exhausted: quota');
	assert.deepEqual(translator.end(), [], 'after a terminal error end() must not emit a second finish');
});

test('目录与额度解析', () => {
	const models = parseModels({
		data: [
			{ id: 'glm-5-3', supports_images: true, reasoning_efforts: ['high', 'low'], requires_reasoning_effort: true },
			{ id: 'glm-5-3' },
		],
	});
	assert.equal(models.length, 1, 'duplicate ids are dropped');
	assert.deepEqual(models[0].reasoningEfforts, ['high', 'low']);
	assert.equal(models[0].supportsImages, true);

	const resolved = toResolvedModel('devin2api', models[0], { contextWindow: 262144, maxTokens: 128000 });
	assert.equal(resolved.context.contextWindow, 262144);
	assert.equal(resolved.defaultMaxTokens, 128000);
	assert.deepEqual(resolved.reasoning.efforts.map((effort) => effort.id), ['high', 'low']);
	assert.equal(resolved.reasoning.defaultEffort, 'high');

	const quota = parseQuota({ plan: 'Pro', daily_remaining_percent: 100, weekly_remaining_percent: 98, stale: true });
	assert.equal(quota.plan, 'Pro');
	assert.equal(quota.weeklyRemainingPercent, 98);
	assert.equal(quota.stale, true);

	assert.deepEqual(classifyHTTPError(401, 'no'), { message: 'no', code: 'AUTH' });
	assert.deepEqual(classifyHTTPError(429, 'slow'), { message: 'slow', code: 'QUOTA' });
	assert.deepEqual(classifyHTTPError(502, ''), { message: 'HTTP 502', code: 'SERVER' });
});
