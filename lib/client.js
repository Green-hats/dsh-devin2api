/**
 * Client 半边：在输入区右侧显示额度胶囊。
 *
 * 浏览器直接读取网关的 /v1/quota（网关对该响应开放 CORS）。这里刻意不经过 Host
 * remote，保持零构建、可独立排查；网关开启 api_key 后需要改为经由 Host 代理。
 */
window.__ModuleLoader__.load({
	id: 'dsh-devin2api',
	factory(require) {
		const React = require('react');
		const h = React.createElement;
		const ENDPOINT = 'http://127.0.0.1:18089/v1/quota';
		const REFRESH_MS = 60_000;

		/** 剩余百分比决定颜色：绿 → 黄 → 红。 */
		function toneOf(percent) {
			if (typeof percent !== 'number') return 'var(--dsw-alias-text-tertiary, #8a8a8a)';
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

		/** 输入区右侧的额度胶囊。 */
		function QuotaPill() {
			const [quota, setQuota] = React.useState(null);
			React.useEffect(() => {
				let alive = true;
				const tick = async () => {
					try {
						const response = await fetch(ENDPOINT, { cache: 'no-store' });
						if (!response.ok) throw new Error(`HTTP ${response.status}`);
						const data = await response.json();
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
			}, []);
			if (quota === null) return null;

			const weekly = quota.weekly_remaining_percent;
			const daily = quota.daily_remaining_percent;
			const parts = [`Devin${quota.plan ? ` ${quota.plan}` : ''}`];
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

		return {
			inject: ['slots'],
			apply(ctx) {
				ctx.slots.inject('conversation.input.right', () =>
					ctx.slots.register(
						{ name: 'conversation.input.right', id: 'devin2api-quota', order: 1000 },
						QuotaPill,
					),
				);
			},
		};
	},
});
