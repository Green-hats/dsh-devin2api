/**
 * 测试专用解析钩子：把宿主提供的 @deepseek-ai/dsh-llm 指向仓库内的桩，
 * 这样不用安装 DSH 也能在干净 checkout 里跑 node:test。
 */
import { registerHooks } from 'node:module';

const fixture = new URL('./fixtures/dsh-llm/index.js', import.meta.url).href;

registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier === '@deepseek-ai/dsh-llm') return { url: fixture, shortCircuit: true };
		return nextResolve(specifier, context);
	},
});
