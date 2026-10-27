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

		/** 读取一个只读端点，失败时抛出可读的错误。 */
		async function readJSON(path) {
			const response = await fetch(`${gatewayRoot()}${path}`, { cache: 'no-store' });
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			return response.json();
		}

		/** 轮询一个端点，返回 [数据, 错误]；组件卸载后不再写状态。 */
		function usePolling(read, deps) {
			const [state, setState] = React.useState({ data: null, error: null, at: 0 });
			const [nonce, setNonce] = React.useState(0);
			React.useEffect(() => {
				let alive = true;
				const tick = async () => {
					try {
						const data = await read();
						if (alive) setState({ data, error: null, at: Date.now() });
					} catch (error) {
						if (alive) setState({ data: null, error, at: Date.now() });
					}
				};
				void tick();
				const timer = setInterval(tick, REFRESH_MS);
				return () => {
					alive = false;
					clearInterval(timer);
				};
			}, [nonce, ...deps]);
			const refresh = React.useCallback(() => setNonce((value) => value + 1), []);
			return [state, refresh];
		}

		/** 输入区右侧的额度胶囊：只在当前会话选中 devin2api 的模型时出现。 */
		function QuotaPill({ directory }) {
			const store = directory ?? EMPTY_STORE;
			const modelState = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
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

			// 换成别的 provider 的模型后立刻消失，也不再轮询。
			if (!active || quota === null) return null;

			const weekly = quota.weekly_remaining_percent;
			const daily = quota.daily_remaining_percent;
			const parts = [`Devin${quota.plan ? ` ${quota.plan}` : ''}`];
			if (typeof current?.model === 'string') parts.push(current.model);
			if (typeof daily === 'number') parts.push(`今日 ${daily}%`);
			if (typeof weekly === 'number') parts.push(`本周 ${weekly}%`);
			const reset = resetLabel(quota.weekly_reset_at);
			if (reset.length > 0) parts.push(`${reset} 重置`);
			if (quota.stale === true) parts.push('（缓存快照）');
			const label = parts.join(' · ');
			const text = typeof weekly === 'number' ? `周 ${weekly}%` : '额度';

			return h(
				'div',
				{
					role: 'status',
					'aria-label': label,
					title: label,
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
					},
				},
				h('span', {
					'aria-hidden': true,
					style: { width: 6, height: 6, borderRadius: 999, background: toneOf(weekly), display: 'inline-block' },
				}),
				text,
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
			const [quota, refreshQuota] = usePolling(() => readJSON('/v1/quota'), [configuredBase]);
			const [models, refreshModels] = usePolling(() => readJSON('/v1/models'), [configuredBase]);

			const connected = gateway.error === null && gateway.data !== null;
			const dot = connected ? '#30a46c' : '#e5484d';
			const data = quota.data;
			const entries = Array.isArray(models.data?.data) ? models.data.data : [];
			const imageCount = entries.filter((entry) => entry?.supports_images === true).length;

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
									key: 'weekly',
									label: '本周剩余',
									value: typeof data?.weekly_remaining_percent === 'number' ? `${data.weekly_remaining_percent}%` : '—',
									tone: toneOf(data?.weekly_remaining_percent),
								}),
								h(Bar, { key: 'weekly-bar', percent: data?.weekly_remaining_percent }),
								h(Row, {
									key: 'reset',
									label: '下次重置',
									value: resetLabel(data?.weekly_reset_at) || '—',
									tone: 'var(--dsw-alias-label-secondary, #8a8a8a)',
								}),
							],
				),

				h(
					Card,
					{ title: '模型目录' },
					models.error !== null
						? h(
								'p',
								{ style: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-tertiary, #8a8a8a)' } },
								'读取模型列表失败。',
							)
						: h(Row, {
								label: '可用模型',
								value: entries.length === 0 ? '—' : `${entries.length} 个（其中 ${imageCount} 个支持图片）`,
								tone: 'var(--dsw-alias-label-primary, inherit)',
							}),
				),

				h(
					'p',
					{ style: { margin: 0, fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary, #8a8a8a)' } },
					'网关地址与图片输入在「模型」设置页的 Devin2API 行里修改。',
				),
			);
		}

		return {
			inject: ['slots'],
			apply(ctx) {
				// 读一次配置里的 baseURL：Models 设置页改过地址时，面板跟着走。
				ctx.inject(['configForms'], (child) => {
					const form = child.configForms.get('devin2api');
					const sync = () => {
						const base = form.getSnapshot?.().value?.providers?.devin2api?.baseURL;
						if (typeof base === 'string' && base.trim().length > 0) configuredBase = base.trim();
					};
					sync();
					const off = form.subscribe?.(sync);
					child.effect(() => () => {
						if (typeof off === 'function') off();
					}, 'dsh-devin2api: follow baseURL');
				});

				ctx.slots.inject('settings.section', () =>
					ctx.slots.register(
						{ name: 'settings.section', id: 'devin2api', order: 30, label: () => 'Devin2API' },
						DevinPanel,
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
							QuotaPill,
						),
					);
				});
			},
		};
	},
});
