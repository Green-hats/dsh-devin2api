/**
 * 客户端半边的冒烟测试：用假的 window / React / ctx 跑一遍模块加载与注册，
 * 确认没有在 apply 或首次渲染时抛错（真实渲染仍由 DSH 负责）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const source = fs.readFileSync(path.join(import.meta.dirname, '..', 'lib', 'client.js'), 'utf8');

/** 预置 useState 的初始值，用来把带数据的分支渲染出来。 */
const stateQueue = [];

/** 极简 React 桩：只提供本插件用到的 API。 */
class StubComponent {
	constructor(props) {
		this.props = props;
		this.state = {};
	}
}
StubComponent.getDerivedStateFromError = () => ({ error: null });

const React = {
	Component: StubComponent,
	Fragment: Symbol('Fragment'),
	createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
	useState: (initial) => {
		if (stateQueue.length > 0) return [stateQueue.shift(), () => {}];
		return [typeof initial === 'function' ? initial() : initial, () => {}];
	},
	useEffect: () => {},
	useCallback: (fn) => fn,
	useRef: (initial) => ({ current: initial }),
	useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
};

/** 加载 client.js 并返回它注册的插件模块。 */
function loadClient() {
	let registered;
	const window = {
		__ModuleLoader__: {
			load: (options) => {
				registered = options;
			},
		},
	};
	const require = (id) => {
		if (id === 'react') return React;
		throw new Error(`unexpected module ${id}`);
	};
	const factory = new Function('window', 'require', `${source}\n;return undefined;`);
	factory(window, require);
	assert.equal(registered.id, 'dsh-devin2api');
	return registered.factory(require);
}

/** 构造最小可用的 ctx / scope。 */
function fakeContext() {
	const registrations = [];
	const slots = {
		inject: (_name, register) => {
			register();
			return () => {};
		},
		register: (options, view) => {
			registrations.push({ options, view });
			return () => {};
		},
	};

	const form = {
		getSnapshot: () => ({
			status: 'ready',
			writable: true,
			revision: 3,
			value: { providers: { devin2api: { baseURL: 'http://127.0.0.1:18089/v1', modelVisibility: {} } } },
		}),
		subscribe: () => () => {},
		mutate: async () => true,
	};
	const ctx = {
		slots,
		effect: (fn) => {
			const dispose = fn();
			return typeof dispose === 'function' ? dispose : () => {};
		},
		inject: (services, callback) => {
			const child = {
				slots,
				effect: ctx.effect,
				configForms: { get: () => form },
				modelDirectories: {
					directoryFor: () => ({
						store: {
							getSnapshot: () => ({ current: { provider: 'devin2api', model: 'glm-5-2' } }),
							subscribe: () => () => {},
						},
					}),
				},
			};
			if (services.includes('configForms') || services.includes('modelDirectories')) callback(child);
			return () => {};
		},
	};
	return { ctx, registrations };
}

/** 在桩 React 的元素树里找一个满足条件的元素。 */
function findElement(node, predicate) {
	if (node === null || typeof node !== 'object') return undefined;
	if (Array.isArray(node)) {
		for (const child of node) {
			const found = findElement(child, predicate);
			if (found !== undefined) return found;
		}
		return undefined;
	}
	if (predicate(node)) return node;
	return findElement(node.children, predicate);
}

/** 只有一个 configForms 表单的上下文，用于验证面板对状态的反应。 */
function contextWithForm(form) {
	const registrations = [];
	const forms = {
		get: () => form,
		describe: () => ({ getSnapshot: () => ({ view: { namespaces: [{ ns: 'devin2api', value: { providers: { devin2api: {} } } }] } }) }),
	};
	const slots = {
		inject: (_name, register) => (register(), () => {}),
		register: (options, view) => {
			registrations.push({ options, view });
			return () => {};
		},
	};
	const ctx = {
		slots,
		get: (name) => (name === 'configForms' ? forms : undefined),
		effect: (fn) => {
			const dispose = fn();
			return typeof dispose === 'function' ? dispose : () => {};
		},
		inject: (services, callback) => {
			if (services.includes('configForms')) callback({ ...ctx, configForms: forms });
			return () => {};
		},
	};
	return { ctx, registrations };
}

/** 用给定状态渲染一次设置面板。 */
function renderPanel(panel, models) {
	stateQueue.push(
		{ data: { status: 'ok' }, error: null, at: 0 },
		{ data: null, error: null, at: 0 },
		{ data: { data: models }, error: null, at: 0 },
		'',
		null,
	);
	try {
		return panel({});
	} finally {
		stateQueue.length = 0;
	}
}

test('client 模块注册额度胶囊与设置页条目', () => {
	const module = loadClient();
	assert.deepEqual(module.inject, ['slots']);
	const { ctx, registrations } = fakeContext();
	module.apply(ctx);
	const ids = registrations.map((entry) => entry.options.id).sort();
	assert.deepEqual(ids, ['devin2api', 'devin2api-quota']);
});

test('配置表单只保留一条活跃订阅', () => {
	const module = loadClient();
	const listeners = new Set();
	const form = {
		getSnapshot: () => ({
			status: 'ready',
			writable: true,
			revision: 1,
			value: { providers: { devin2api: { baseURL: 'http://127.0.0.1:18089/v1', modelVisibility: {} } } },
		}),
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		mutate: async () => true,
	};
	const forms = {
		get: () => form,
		describe: () => ({ getSnapshot: () => ({ view: { namespaces: [{ ns: 'devin2api', value: { providers: { devin2api: {} } } }] } }) }),
	};
	const slots = { inject: (_name, register) => (register(), () => {}), register: () => () => {} };
	const ctx = {
		slots,
		get: (name) => (name === 'configForms' ? forms : undefined),
		effect: (fn) => {
			const dispose = fn();
			return typeof dispose === 'function' ? dispose : () => {};
		},
		inject: (services, callback) => {
			if (services.includes('configForms')) callback({ ...ctx, configForms: forms });
			return () => {};
		},
	};
	module.apply(ctx);
	assert.equal(listeners.size, 1, '同步 attach 与注入 attach 之后只应保留一条订阅');
});

test('设置未加载完时模型开关不写入', () => {
	const module = loadClient();
	const mutateCalls = [];
	const form = {
		getSnapshot: () => ({ status: 'loading', writable: true, revision: undefined, value: undefined }),
		subscribe: () => () => {},
		mutate: async (...args) => {
			mutateCalls.push(args);
			return true;
		},
	};
	const forms = {
		get: () => form,
		describe: () => ({ getSnapshot: () => ({ view: { namespaces: [{ ns: 'devin2api', value: { providers: { devin2api: {} } } }] } }) }),
	};
	const registrations = [];
	const slots = {
		inject: (_name, register) => (register(), () => {}),
		register: (options, view) => {
			registrations.push({ options, view });
			return () => {};
		},
	};
	const ctx = {
		slots,
		get: (name) => (name === 'configForms' ? forms : undefined),
		effect: (fn) => {
			const dispose = fn();
			return typeof dispose === 'function' ? dispose : () => {};
		},
		inject: (services, callback) => {
			if (services.includes('configForms')) callback({ ...ctx, configForms: forms });
			return () => {};
		},
	};
	module.apply(ctx);
	const guarded = registrations.find((entry) => entry.options.id === 'devin2api').view;
	const panel = guarded({}).children[0].type;
	stateQueue.push(
		{ data: { status: 'ok' }, error: null, at: 0 },
		{ data: null, error: null, at: 0 },
		{ data: { data: [{ id: 'glm-5-2' }] }, error: null, at: 0 },
		'',
		null,
	);
	let tree;
	try {
		tree = panel({});
	} finally {
		stateQueue.length = 0;
	}
	const toggle = findElement(
		tree,
		(node) => typeof node?.props?.onChange === 'function' && String(node.props.label).includes('glm-5-2'),
	);
	assert.ok(toggle, '模型行应渲染出开关');
	toggle.props.onChange(false);
	return new Promise((resolve) => setTimeout(resolve, 10)).then(() => {
		assert.equal(mutateCalls.length, 0, '未 ready 时不应写回整张字典');
	});
});

test('只读设置下模型开关是禁用的', () => {
	const module = loadClient();
	const form = {
		getSnapshot: () => ({
			status: 'ready',
			writable: false,
			revision: 1,
			value: { providers: { devin2api: { baseURL: 'http://127.0.0.1:18089/v1', modelVisibility: {} } } },
		}),
		subscribe: () => () => {},
		mutate: async () => true,
	};
	const { ctx, registrations } = contextWithForm(form);
	module.apply(ctx);
	const guarded = registrations.find((entry) => entry.options.id === 'devin2api').view;
	const panel = guarded({}).children[0].type;
	const tree = renderPanel(panel, [{ id: 'glm-5-2' }]);
	const toggle = findElement(
		tree,
		(node) => typeof node?.props?.onChange === 'function' && String(node.props.label).includes('glm-5-2'),
	);
	assert.ok(toggle, '模型行应渲染出开关');
	assert.equal(toggle.props.disabled, true, '只读时开关应禁用');
});

test('全部关闭时面板说明宿主的回退行为', () => {
	const module = loadClient();
	const form = {
		getSnapshot: () => ({
			status: 'ready',
			writable: true,
			revision: 1,
			value: {
				providers: { devin2api: { baseURL: 'http://127.0.0.1:18089/v1', modelVisibility: { 'glm-5-2': false } } },
			},
		}),
		subscribe: () => () => {},
		mutate: async () => true,
	};
	const { ctx, registrations } = contextWithForm(form);
	module.apply(ctx);
	const guarded = registrations.find((entry) => entry.options.id === 'devin2api').view;
	const panel = guarded({}).children[0].type;
	const tree = renderPanel(panel, [{ id: 'glm-5-2' }]);
	const flat = JSON.stringify(tree, (_key, value) => (typeof value === 'symbol' ? String(value) : value));
	assert.ok(flat.includes('宿主会回退显示完整目录'), '全部关闭时应提示回退行为');
});

test('胶囊在非 devin2api 模型下隐藏', () => {
	const module = loadClient();
	const { ctx, registrations } = fakeContext();
	module.apply(ctx);
	const guarded = registrations.find((entry) => entry.options.id === 'devin2api-quota').view;
	const pill = guarded({}).children[0].type;
	assert.equal(pill({ directory: undefined }), null);
	const other = {
		getSnapshot: () => ({ current: { provider: 'opencode-go', model: 'kimi' } }),
		subscribe: () => () => {},
	};
	assert.equal(pill({ directory: other }), null);
});

test('设置页面板在空目录下也能渲染', () => {
	const module = loadClient();
	const { ctx, registrations } = fakeContext();
	module.apply(ctx);
	const guarded = registrations.find((entry) => entry.options.id === 'devin2api').view;
	const panel = guarded({}).children[0].type;
	const tree = panel({});
	assert.equal(tree.type, 'div');
	assert.ok(Array.isArray(tree.children));
});


test('模型列表带数据时能渲染出每一行', () => {
	const module = loadClient();
	const { ctx, registrations } = fakeContext();
	module.apply(ctx);
	const guarded = registrations.find((entry) => entry.options.id === 'devin2api').view;
	const panel = guarded({}).children[0].type;
	// useState 的调用顺序：gateway、quota、models、filter、writeNote。
	stateQueue.push(
		{ data: { status: 'ok' }, error: null, at: 0 },
		{ data: { daily_remaining_percent: 71, weekly_remaining_percent: 65 }, error: null, at: 0 },
		{
			data: {
				data: [
					{ id: 'glm-5-2', supports_images: true },
					{ id: 'kimi-k3', supports_images: false },
				],
			},
			error: null,
			at: 0,
		},
		'',
		null,
	);
	try {
		const tree = panel({});
		// 找到"全开"按钮，确认工具行渲染出来了。
		const flat = JSON.stringify(tree, (_key, value) => (typeof value === 'symbol' ? String(value) : value));
		assert.ok(flat.includes('全开'), '工具行应渲染');
		assert.ok(flat.includes('glm-5-2'), '模型行应渲染');
	} finally {
		stateQueue.length = 0;
	}
});
