/**
 * 客户端半边的冒烟测试：用假的 window / React / ctx 跑一遍模块加载与注册，
 * 确认没有在 apply 或首次渲染时抛错（真实渲染仍由 DSH 负责）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const source = fs.readFileSync(path.join(import.meta.dirname, '..', 'lib', 'client.js'), 'utf8');

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
	useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
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

test('client 模块注册额度胶囊与设置页条目', () => {
	const module = loadClient();
	assert.deepEqual(module.inject, ['slots']);
	const { ctx, registrations } = fakeContext();
	module.apply(ctx);
	const ids = registrations.map((entry) => entry.options.id).sort();
	assert.deepEqual(ids, ['devin2api', 'devin2api-quota']);
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
