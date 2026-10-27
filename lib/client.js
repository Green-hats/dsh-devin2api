/**
 * Client 半边：输入区右侧的额度胶囊 + 设置页里的用量面板。
 *
 * 浏览器直接读取网关的只读端点（网关对这些 GET 响应开放 CORS）。这里刻意不经过
 * Host remote，保持零构建、可独立排查；网关开启 api_key 后需要改为经由 Host 代理。
 */
window.__ModuleLoader__.load({
	id: 'dsh-devin2api',
	factory(require) {
		const React = require('react');
		const h = React.createElement;

		/** 默认网关地址；Models 设置页改过 baseURL 时会从这里读到最新值。 */
		const DEFAULT_BASE = 'http://127.0.0.1:18089/v1';
		const REFRESH_MS = 60_000;
		/** 本插件注册的 provider id：胶囊只在选中它的模型时出现。 */
		const PROVIDER_ID = 'devin2api';
		/** 没有会话目录时的空 store，保证 hooks 顺序稳定。 */
		const EMPTY_STORE = { getSnapshot: () => null, subscribe: () => () => {} };

		/** 客户端排障：把异常写到网关的 /__clientlog（本地调试用，失败静默）。 */
		function report(kind, detail) {
			try {
				const body = `${new Date().toISOString()} [${kind}] ${String(detail)}\n`;
				void fetch(`${gatewayRoot()}/__clientlog`, {
					method: 'POST',
					mode: 'no-cors',
					headers: { 'content-type': 'text/plain' },
					body,
				}).catch(() => {});
			} catch {
				/* 排障本身不能影响渲染 */
			}
		}

		/** 兜住渲染异常：面板崩了要看到原因，而不是一片空白。 */
		const ReactComponent = React.Component ?? class {};

		class ErrorBoundary extends ReactComponent {
			constructor(props) {
				super(props);
				this.state = { error: null };
			}

			static getDerivedStateFromError(error) {
				return { error };
			}

			componentDidCatch(error, info) {
				report('render', `${error?.stack ?? error}\n${info?.componentStack ?? ''}`);
			}

			render() {
				if (this.state.error === null) return this.props.children;
				return h(
					'pre',
					{
						style: {
							margin: 0,
							padding: 12,
							fontSize: 11.5,
							whiteSpace: 'pre-wrap',
							color: 'var(--dsw-alias-state-error-primary, #e5484d)',
						},
					},
					`Devin2API 面板渲染失败：\n${String(this.state.error?.stack ?? this.state.error)}`,
				);
			}
		}

		/** 官方控件库；拿不到时退回自带的开关实现。 */
		let primitives = null;
		try {
			primitives = require('@deepseek-ai/dsh-client-ui-primitives');
		} catch {
			primitives = null;
		}

		/** 模型开关的状态源：configForms 变化时推给面板。 */
		const visibilityStore = (() => {
			let snapshot = { value: {}, writable: false, status: 'loading' };
			const listeners = new Set();
			return {
				getSnapshot: () => snapshot,
				subscribe: (listener) => {
					listeners.add(listener);
					return () => listeners.delete(listener);
				},
				publish: (next) => {
					snapshot = next;
					for (const listener of listeners) listener();
				},
			};
		})();

		/** 当前 devin2api 条目的配置表；为空表示 configForms 那条路没通。 */
		let configForm = null;

		/** 设置文档里本插件条目的命名空间；解析过一次就记住。 */
		let resolvedNamespace = 'devin2api';

		/**
		 * 找出本插件的设置命名空间。
		 * 正常情况下就是 profile 里的 entry id；万一被打包层改过名，
		 * 就退回到「哪个命名空间的值里有 providers.devin2api」。
		 * @param {any} forms
		 * @returns {string}
		 */
		function namespaceOf(forms) {
			try {
				const view = forms.describe?.()?.getSnapshot?.()?.view;
				const namespaces = Array.isArray(view?.namespaces) ? view.namespaces : [];
				if (namespaces.length > 0) {
					const match = namespaces.find((row) => row?.value?.providers?.devin2api !== undefined);
					if (match?.ns) {
						resolvedNamespace = match.ns;
						return resolvedNamespace;
					}
					const exact = namespaces.find((row) => row?.ns === 'devin2api');
					if (exact?.ns) {
						resolvedNamespace = exact.ns;
						return resolvedNamespace;
					}
				}
			} catch {
				/* describe 拿不到就沿用上一次的结论 */
			}
			return resolvedNamespace;
		}

		/** configForms 不可用时的兜底：直接调 settings remote。 */
		let settingsRemote = null;
		/** 最近一次 describe 拿到的 revision，写回时带上。 */
		let settingsRevision = undefined;

		/** 把写入结果翻译成一句给人看的话。 */
		function failureText(result, status) {
			if (result === 'no-form') return '还没连上设置服务（configForms 未就绪），无法写入配置。';
			if (result === 'rejected') return `设置没有接受这次修改（当前状态 ${status}）。`;
			if (typeof result === 'string' && result.startsWith('error:')) return `写入失败：${result.slice(6)}`;
			return '写入失败，原因未知。';
		}

		/**
		 * 写一次 modelVisibility：整张字典一起写，`update` 收到当前字典返回新字典。
		 * 返回 `applied` / `no-form` / `rejected` / `error:...`，由调用方展示。
		 */
		async function writeVisibility(update) {
			const live = configForm?.getSnapshot?.();
			const current =
				live?.value?.providers?.devin2api?.modelVisibility ?? visibilityStore.getSnapshot().value ?? {};
			const ops = [{ op: 'set', path: ['providers', 'devin2api', 'modelVisibility'], value: update({ ...current }) }];
			if (configForm !== null) {
				const snapshot = live;
				if (typeof configForm.mutate !== 'function') return 'no-form';
				try {
					const accepted = await configForm.mutate(ops, snapshot?.revision);
					return accepted === false ? 'rejected' : 'applied';
				} catch (error) {
					return `error:${String(error?.message ?? error)}`;
				}
			}
			if (settingsRemote !== null) {
				try {
					const result = await settingsRemote.mutate(resolvedNamespace, ops, settingsRevision);
					if (result?.ok === false) return 'rejected';
					await syncFromRemote();
					return 'applied';
				} catch (error) {
					return `error:${String(error?.message ?? error)}`;
				}
			}
			return 'no-form';
		}

		/** 用 settings remote 的 describe 结果刷新开关状态与网关地址。 */
		async function syncFromRemote() {
			if (settingsRemote === null) return;
			try {
				const response = await settingsRemote.describe();
				if (response?.ok === false) return;
				const view = response?.value ?? response;
				const row = Array.isArray(view?.namespaces)
					? view.namespaces.find((candidate) => candidate?.ns === resolvedNamespace || candidate?.value?.providers?.devin2api !== undefined)
					: undefined;
				settingsRevision = row?.revision ?? settingsRevision;
				const profile = row?.value?.providers?.devin2api ?? {};
				const base = profile?.baseURL;
				if (typeof base === 'string' && base.trim().length > 0) configuredBase = base.trim();
				visibilityStore.publish({
					value: profile?.modelVisibility !== null && typeof profile?.modelVisibility === 'object' ? profile.modelVisibility : {},
					writable: view?.writable !== false,
					status: row === undefined ? 'unavailable' : 'ready',
				});
			} catch {
				/* 兜底路径失败就保持原状 */
			}
		}

		let configuredBase = DEFAULT_BASE;
		/** 网关根地址（去掉 /v1 后缀），只读端点都挂在根上。 */
		function gatewayRoot() {
			const raw = configuredBase.trim();
			const trimmed = raw.endsWith('/') ? raw.slice(0, -1) : raw;
			return trimmed.endsWith('/v1') ? trimmed.slice(0, -3) : trimmed;
		}

		/** 剩余百分比决定颜色：绿 → 黄 → 红。 */
		function toneOf(percent) {
			if (typeof percent !== 'number') return 'var(--dsw-alias-label-tertiary, #8a8a8a)';
			if (percent <= 10) return '#e5484d';
			if (percent <= 30) return '#f5a524';
			return '#30a46c';
		}

		/** 重置时间按本地时区显示为「周X HH:mm」。 */
		function resetLabel(unix) {
			if (typeof unix !== 'number' || unix <= 0) return '';
			const date = new Date(unix * 1000);
			const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
			const hh = String(date.getHours()).padStart(2, '0');
			const mm = String(date.getMinutes()).padStart(2, '0');
			return `${days[date.getDay()]} ${hh}:${mm}`;
		}

		/** 读取一个只读端点，失败时抛出可读的错误；fresh 会跳过网关缓存。 */
		async function readJSON(path, fresh = false) {
			const query = fresh ? (path.includes('?') ? '&' : '?') + 'fresh=1' : '';
			const response = await fetch(`${gatewayRoot()}${path}${query}`, { cache: 'no-store' });
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			return response.json();
		}

		/**
		 * 轮询一个只读端点，返回 [状态, 刷新]。
		 * `read(fresh)` 收到 true 时应跳过网关缓存——刷新按钮用它问一次上游。
		 */
		function usePolling(read, deps) {
			const [state, setState] = React.useState({ data: null, error: null, at: 0 });
			const alive = React.useRef(true);
			React.useEffect(() => {
				alive.current = true;
				return () => {
					alive.current = false;
				};
			}, []);
			const load = React.useCallback(
				async (fresh) => {
					try {
						const data = await read(fresh);
						if (alive.current) setState({ data, error: null, at: Date.now() });
					} catch (error) {
						if (alive.current) setState({ data: null, error, at: Date.now() });
					}
				},
				deps,
			);
			React.useEffect(() => {
				void load(false);
				const timer = setInterval(() => void load(false), REFRESH_MS);
				return () => clearInterval(timer);
			}, [load]);
			const refresh = React.useCallback(() => void load(true), [load]);
			return [state, refresh];
		}

		/** 输入区右侧的额度胶囊：只在当前会话选中 devin2api 的模型时出现。 */
		function QuotaPill({ directory }) {
			const usable =
				directory !== null &&
				directory !== undefined &&
				typeof directory.subscribe === 'function' &&
				typeof directory.getSnapshot === 'function';
			const modelState = React.useSyncExternalStore(
				usable ? directory.subscribe : EMPTY_STORE.subscribe,
				usable ? directory.getSnapshot : EMPTY_STORE.getSnapshot,
				usable ? directory.getSnapshot : EMPTY_STORE.getSnapshot,
			);
			const current = modelState?.current ?? null;
			const active = current?.provider === PROVIDER_ID;
			const [quota, setQuota] = React.useState(null);

			React.useEffect(() => {
				if (!active) {
					setQuota(null);
					return undefined;
				}
				let alive = true;
				const tick = async () => {
					try {
						const data = await readJSON('/v1/quota');
						if (alive) setQuota(data);
					} catch {
						// 网关没起或该版本没有 /v1/quota：安静地隐藏胶囊。
						if (alive) setQuota(null);
					}
				};
				void tick();
				const timer = setInterval(tick, REFRESH_MS);
				return () => {
					alive = false;
					clearInterval(timer);
				};
			}, [active]);

			// 点击胶囊：跳过网关的 5 分钟缓存，立刻问一次上游。
			const refresh = React.useCallback(() => {
				if (!active) return;
				void readJSON('/v1/quota', true)
					.then((data) => setQuota(data))
					.catch(() => setQuota(null));
			}, [active]);

			// 换成别的 provider 的模型后立刻消失，也不再轮询。
			if (!active || quota === null) return null;

			const weekly = quota.weekly_remaining_percent;
			const daily = quota.daily_remaining_percent;

			const segments = [];
			if (typeof daily === 'number') segments.push({ key: 'd', text: `日 ${daily}%`, tone: toneOf(daily) });
			if (typeof weekly === 'number') segments.push({ key: 'w', text: `周 ${weekly}%`, tone: toneOf(weekly) });
			if (segments.length === 0) segments.push({ key: 'x', text: '额度', tone: toneOf(undefined) });

			const parts = [`Devin${quota.plan ? ` ${quota.plan}` : ''}`];
			if (typeof current?.model === 'string') parts.push(current.model);
			if (typeof daily === 'number') parts.push(`今日剩余 ${daily}%`);
			if (typeof weekly === 'number') parts.push(`本周剩余 ${weekly}%`);
			const dailyReset = resetLabel(quota.daily_reset_at);
			if (dailyReset.length > 0) parts.push(`今日 ${dailyReset} 重置`);
			const weeklyReset = resetLabel(quota.weekly_reset_at);
			if (weeklyReset.length > 0) parts.push(`本周 ${weeklyReset} 重置`);
			if (quota.stale === true) parts.push('（缓存快照）');
			parts.push('点击立即刷新');
			const label = parts.join(' · ');

			return h(
				'div',
				{
					role: 'status',
					'aria-label': label,
					title: label,
					onClick: refresh,
					style: {
						display: 'inline-flex',
						alignItems: 'center',
						gap: 6,
						padding: '2px 8px',
						borderRadius: 999,
						border: '1px solid var(--dsw-alias-border, rgba(128,128,128,0.35))',
						color: 'inherit',
						fontSize: 11,
						lineHeight: '16px',
						whiteSpace: 'nowrap',
						userSelect: 'none',
						cursor: 'pointer',
					},
				},
				segments.map((segment, index) =>
					h(
						React.Fragment,
						{ key: segment.key },
						index === 0
							? null
							: h('span', {
									'aria-hidden': true,
									style: {
										width: 1,
										height: 10,
										display: 'inline-block',
										background: 'var(--dsw-alias-border, rgba(128,128,128,0.35))',
									},
								}),
						h('span', {
							'aria-hidden': true,
							style: { width: 6, height: 6, borderRadius: 999, background: segment.tone, display: 'inline-block' },
						}),
						h('span', null, segment.text),
					),
				),
			);
		}

		/** 一行标题 + 数值。 */
		function Row({ label, value, tone }) {
			return h(
				'div',
				{ style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 } },
				h('span', { style: { color: 'var(--dsw-alias-label-secondary, #8a8a8a)', fontSize: 13 } }, label),
				h('span', { style: { color: tone, fontSize: 13, fontVariantNumeric: 'tabular-nums' } }, value),
			);
		}

		/** 剩余额度进度条。 */
		function Bar({ percent }) {
			const width = typeof percent === 'number' ? Math.max(0, Math.min(100, percent)) : 0;
			return h(
				'div',
				{
					style: {
						height: 6,
						borderRadius: 999,
						background: 'var(--dsw-alias-fill-l2, rgba(128,128,128,0.2))',
						overflow: 'hidden',
					},
				},
				h('div', { style: { width: `${width}%`, height: '100%', borderRadius: 999, background: toneOf(percent) } }),
			);
		}

		/** 小号文字按钮的样式。 */
		function linkButtonStyle(enabled) {
			return {
				flex: 'none',
				padding: '4px 10px',
				borderRadius: 8,
				border: '1px solid var(--dsw-alias-border, rgba(128,128,128,0.35))',
				background: 'transparent',
				color: 'inherit',
				fontSize: 12,
				cursor: enabled ? 'pointer' : 'default',
				opacity: enabled ? 1 : 0.55,
			};
		}

		/** 一个开关：优先用官方控件，缺失时用最小实现。 */
		function Toggle({ checked, disabled, label, onChange }) {
			const PrimitiveSwitch = primitives?.Switch;
			if (typeof PrimitiveSwitch === 'function') {
				return h(PrimitiveSwitch, { checked, disabled, label, onChange });
			}
			return h(
				'button',
				{
					type: 'button',
					role: 'switch',
					'aria-checked': checked,
					'aria-label': label,
					disabled,
					onClick: () => onChange(!checked),
					style: {
						position: 'relative',
						width: 30,
						height: 18,
						flex: 'none',
						padding: 0,
						border: 'none',
						borderRadius: 999,
						cursor: disabled ? 'default' : 'pointer',
						background: checked
							? 'var(--dsw-alias-state-business-primary, #4d6bfe)'
							: 'var(--dsw-alias-fill-l2, rgba(128,128,128,0.35))',
						opacity: disabled ? 0.55 : 1,
					},
				},
				h('span', {
					'aria-hidden': true,
					style: {
						position: 'absolute',
						top: 2,
						left: checked ? 14 : 2,
						width: 14,
						height: 14,
						borderRadius: 999,
						background: '#fff',
						transition: 'left .15s',
					},
				}),
			);
		}

		function Card({ title, children }) {
			return h(
				'section',
				{
					style: {
						display: 'flex',
						flexDirection: 'column',
						gap: 10,
						padding: 16,
						borderRadius: 12,
						border: '1px solid var(--dsw-alias-border, rgba(128,128,128,0.25))',
					},
				},
				h('h4', { style: { margin: 0, fontSize: 13, fontWeight: 500 } }, title),
				children,
			);
		}

		/** 设置页里的 Devin2API 面板：网关状态、额度、模型目录。 */
		function DevinPanel() {
			const [gateway, refreshGateway] = usePolling(() => readJSON('/healthz'), [configuredBase]);
			const [quota, refreshQuota] = usePolling((fresh) => readJSON('/v1/quota', fresh), [configuredBase]);
			const [models, refreshModels] = usePolling(() => readJSON('/v1/models'), [configuredBase]);

			const connected = gateway.error === null && gateway.data !== null;
			const dot = connected ? '#30a46c' : '#e5484d';
			const data = quota.data;
			const entries = Array.isArray(models.data?.data) ? models.data.data : [];
			const imageCount = entries.filter((entry) => entry?.supports_images === true).length;

			const visibility = React.useSyncExternalStore(
				visibilityStore.subscribe,
				visibilityStore.getSnapshot,
				visibilityStore.getSnapshot,
			);
			const hidden = visibility.value ?? {};
			const visibleEntries = entries.filter((entry) => hidden[entry.id] !== false);
			const [filter, setFilter] = React.useState('');
			const query = filter.trim().toLowerCase();
			const rows = query === '' ? entries : entries.filter((entry) => entry.id.toLowerCase().includes(query));
			const configConnected = configForm !== null || settingsRemote !== null;
			const [writeNote, setWriteNote] = React.useState(null);
			/** 写入后把失败原因留在卡片里，而不是静默忽略。 */
			const applyVisibility = (update) => {
				void (async () => {
					const result = await writeVisibility(update);
					setWriteNote(result === 'applied' ? null : failureText(result, visibility.status));
				})();
			};

			const refresh = () => {
				refreshGateway();
				refreshQuota();
				refreshModels();
			};

			return h(
				'div',
				{ style: { display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640, padding: '8px 0' } },
				h(
					'div',
					{ style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 } },
					h(
						'div',
						{ style: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 } },
						h('span', {
							'aria-hidden': true,
							style: { width: 8, height: 8, borderRadius: 999, background: dot, flex: 'none' },
						}),
						h(
							'span',
							{ style: { fontSize: 13, color: 'var(--dsw-alias-label-secondary, #8a8a8a)', overflowWrap: 'anywhere' } },
							connected ? `已连接 · ${gatewayRoot()}` : `未连接 · ${gatewayRoot()}`,
						),
					),
					h(
						'button',
						{
							type: 'button',
							onClick: refresh,
							style: {
								flex: 'none',
								padding: '4px 12px',
								borderRadius: 8,
								border: '1px solid var(--dsw-alias-border, rgba(128,128,128,0.35))',
								background: 'transparent',
								color: 'inherit',
								fontSize: 12,
								cursor: 'pointer',
							},
						},
						'刷新',
					),
				),

				gateway.error === null
					? null
					: h(
							'p',
							{ style: { margin: 0, fontSize: 13, color: 'var(--dsw-alias-state-error-primary, #e5484d)' } },
							`无法连接网关：${String(gateway.error.message ?? gateway.error)}。请先启动 devin-2api（见 README）。`,
						),

				h(
					Card,
					{ title: `额度${data?.plan ? ` · ${data.plan}` : ''}${data?.stale === true ? ' · 缓存快照' : ''}` },
					quota.error !== null
						? h(
								'p',
								{ style: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-tertiary, #8a8a8a)' } },
								'该网关未提供额度信息。',
							)
						: [
								h(Row, {
									key: 'daily',
									label: '今日剩余',
									value: typeof data?.daily_remaining_percent === 'number' ? `${data.daily_remaining_percent}%` : '—',
									tone: toneOf(data?.daily_remaining_percent),
								}),
								h(Bar, { key: 'daily-bar', percent: data?.daily_remaining_percent }),
								h(Row, {
									key: 'daily-reset',
									label: '今日重置',
									value: resetLabel(data?.daily_reset_at) || '—',
									tone: 'var(--dsw-alias-label-secondary, #8a8a8a)',
								}),
								h(Row, {
									key: 'weekly',
									label: '本周剩余',
									value: typeof data?.weekly_remaining_percent === 'number' ? `${data.weekly_remaining_percent}%` : '—',
									tone: toneOf(data?.weekly_remaining_percent),
								}),
								h(Bar, { key: 'weekly-bar', percent: data?.weekly_remaining_percent }),
								h(Row, {
									key: 'reset',
									label: '本周重置',
									value: resetLabel(data?.weekly_reset_at) || '—',
									tone: 'var(--dsw-alias-label-secondary, #8a8a8a)',
								}),
							],
				),

				h(
					Card,
					{ title: `模型目录${entries.length === 0 ? '' : ` · 已启用 ${visibleEntries.length}/${entries.length}`}` },
					models.error !== null
						? h(
								'p',
								{ style: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-tertiary, #8a8a8a)' } },
								'读取模型列表失败。',
							)
						: [
								h(
									'div',
									{ key: 'tools', style: { display: 'flex', alignItems: 'center', gap: 8 } },
									h('input', {
										type: 'search',
										value: filter,
										placeholder: '搜索模型…',
										'aria-label': '搜索模型',
										onChange: (event) => setFilter(event.target.value),
										style: {
											flex: 1,
											minWidth: 0,
											height: 28,
											padding: '0 10px',
											borderRadius: 8,
											border: '1px solid var(--dsw-alias-border, rgba(128,128,128,0.35))',
											background: 'transparent',
											color: 'inherit',
											fontSize: 12,
										},
									}),
									h(
										'button',
										{
											type: 'button',
											disabled: !configConnected,
											onClick: () => applyVisibility(() => ({})),
											style: linkButtonStyle(configConnected),
										},
										'全开',
									),
									h(
										'button',
										{
											type: 'button',
											disabled: !configConnected,
											onClick: () =>
												applyVisibility(() => Object.fromEntries(entries.map((entry) => [entry.id, false]))),
											style: linkButtonStyle(configConnected),
										},
										'全关',
									),
								),
								h(
									'div',
									{
										key: 'list',
										style: {
											display: 'flex',
											flexDirection: 'column',
											maxHeight: 320,
											overflowY: 'auto',
											borderTop: '1px solid var(--dsw-alias-border, rgba(128,128,128,0.25))',
										},
									},
									rows.length === 0
										? h(
												'p',
												{ style: { margin: '8px 0', fontSize: 12, color: 'var(--dsw-alias-label-tertiary, #8a8a8a)' } },
												'没有匹配的模型。',
											)
										: rows.map((entry) =>
												h(
													'label',
													{
														key: entry.id,
														style: {
															display: 'flex',
															alignItems: 'center',
															gap: 10,
															padding: '6px 2px',
															borderBottom: '1px solid var(--dsw-alias-border, rgba(128,128,128,0.15))',
															cursor: configConnected ? 'pointer' : 'default',
														},
													},
													h(
														'span',
														{ style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 } },
														h(
															'span',
															{
																style: {
																	fontSize: 12.5,
																	color: 'var(--dsw-alias-label-primary, inherit)',
																	overflow: 'hidden',
																	textOverflow: 'ellipsis',
																	whiteSpace: 'nowrap',
																},
															},
															entry.id,
														),
														entry.supports_images === true
															? h(
																	'span',
																	{ style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary, #8a8a8a)' } },
																	'支持图片',
																)
															: null,
													),
													h(Toggle, {
														checked: hidden[entry.id] !== false,
														disabled: !configConnected,
														label: `${entry.id} 是否出现在模型选择器里`,
														onChange: (next) =>
															applyVisibility((current) => {
																const merged = { ...current, [entry.id]: next };
																if (next) delete merged[entry.id];
																return merged;
															}),
													}),
												),
											),
								),
								configConnected
									? null
									: h(
											'p',
											{ key: 'nof', style: { margin: 0, fontSize: 11.5, color: 'var(--dsw-alias-state-error-primary, #e5484d)' } },
											'未连接到设置服务（configForms / remote.settings 都不可用），开关暂时无法写入。',
										),
								writeNote === null
									? null
									: h(
											'p',
											{ key: 'note', style: { margin: 0, fontSize: 11.5, color: 'var(--dsw-alias-state-error-primary, #e5484d)' } },
											writeNote,
										),
								entries.length === 0
									? null
									: h(
											'p',
											{ key: 'hint', style: { margin: 0, fontSize: 11.5, color: 'var(--dsw-alias-label-tertiary, #8a8a8a)' } },
											`其中 ${imageCount} 个支持图片输入。开关立即写入配置，模型选择器随之更新。`,
										),
							],
				),

				h(
					'p',
					{ style: { margin: 0, fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary, #8a8a8a)' } },
					'网关地址与图片输入在「模型」设置页的 Devin2API 行里修改。',
				),
			);
		}

		/** 带异常边界的胶囊。 */
		function GuardedPill(props) {
			return h(ErrorBoundary, null, h(QuotaPill, props));
		}

		/** 带异常边界的面板。 */
		function GuardedPanel(props) {
			return h(ErrorBoundary, null, h(DevinPanel, props));
		}

		return {
			inject: ['slots'],
			apply(ctx) {
				try {
					window.addEventListener?.('error', (event) => {
						report('window-error', `${event?.message ?? ''}\n${event?.error?.stack ?? ''}`);
					});
					window.addEventListener?.('unhandledrejection', (event) => {
						report('unhandled', `${event?.reason?.stack ?? event?.reason ?? ''}`);
					});
				} catch {
					/* 非浏览器环境 */
				}
				try {
					applyPlugin(ctx);
				} catch (error) {
					report('apply', `${error?.stack ?? error}`);
					throw error;
				}
			},
		};
		/** 真正的注册逻辑；异常会先写进排障日志再抛出。 */
		function applyPlugin(ctx) {
				// 读配置：baseURL 决定网关地址，modelVisibility 决定模型开关。
				// 服务名用 ctx.get 取——参考实现（dsh-opencode-go）就是这么拿的，
				// 属性访问在某些 fiber 上拿不到。
				const attachConfig = (child, quiet = false) => {
					// 只用 get() 取服务：属性访问在某些上下文中会抛，不能放在 catch 里再试一次。
					let forms = null;
					try {
						forms = typeof child.get === 'function' ? child.get('configForms') : null;
					} catch {
						forms = null;
					}
					if (forms === null || typeof forms.get !== 'function') {
						if (!quiet) console.warn('[dsh-devin2api] configForms 不可用，模型开关将保持禁用');
						return;
					}
					let form;
					const currentNamespace = namespaceOf(forms);
					try {
						form = forms.get(currentNamespace);
					} catch (error) {
						console.error('[dsh-devin2api] configForms.get 失败', error);
						return;
					}
					configForm = form;
					const sync = () => {
						const snapshot = form.getSnapshot?.();
						const profile = snapshot?.value?.providers?.devin2api;
						const base = profile?.baseURL;
						if (typeof base === 'string' && base.trim().length > 0) configuredBase = base.trim();
						const visibility =
							profile?.modelVisibility !== null && typeof profile?.modelVisibility === 'object'
								? profile.modelVisibility
								: {};
						visibilityStore.publish({
							value: visibility,
							writable: snapshot?.writable !== false,
							status: snapshot?.status ?? 'loading',
						});
					};
					let retried = false;
					sync();
					const off = form.subscribe?.(() => {
						sync();
						// 命名空间对不上（Host 没提供这一段）时，扫一遍文档再试一次。
						const status = form.getSnapshot?.()?.status;
						if (status === 'unavailable' && !retried) {
							retried = true;
							const resolved = namespaceOf(forms);
							if (resolved !== currentNamespace) {
								configForm = null;
								attachConfig(child, true);
							}
						}
					});
					if (typeof child.effect === 'function') {
						child.effect(() => () => {
							if (typeof off === 'function') off();
							if (configForm === form) configForm = null;
						}, 'dsh-devin2api: follow provider config');
					}
				};

				// 先同步试一次（设置服务可能已经就绪），再等注入。
				attachConfig(ctx, true);
				ctx.inject(['configForms'], (child) => attachConfig(child));

				// configForms 取不到时的兜底：直接读写 settings remote。
				ctx.inject(['remote.settings'], (child) => {
					try {
						settingsRemote = typeof child.get === 'function' ? child.get('remote.settings') : null;
					} catch {
						settingsRemote = null;
					}
					if (settingsRemote !== null) void syncFromRemote();
				});

				ctx.slots.inject('settings.section', () =>
					ctx.slots.register(
						{ name: 'settings.section', id: 'devin2api', order: 30, label: () => 'Devin2API' },
						GuardedPanel,
					),
				);

				// 胶囊要知道当前会话选中了哪个 provider，才会决定显不显示。
				ctx.inject(['modelDirectories'], (scope) => {
					scope.slots.inject('conversation.input.right', () =>
						scope.slots.register(
							{
								name: 'conversation.input.right',
								id: 'devin2api-quota',
								order: 1000,
								inject: (sessionId) => {
									try {
										return { directory: scope.modelDirectories.directoryFor(sessionId).store };
									} catch {
										// 会话还没绑定模型目录：胶囊先不渲染。
										return { directory: undefined };
									}
								},
							},
							GuardedPill,
						),
					);
				});
		}
	},
});
