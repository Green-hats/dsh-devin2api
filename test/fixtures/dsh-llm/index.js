// Test-only stand-in for the Host package DSH provides at runtime.
// test/register.mjs maps the bare specifier here so a fresh checkout can run
// the suite without the DSH installation.
export class LlmError extends Error {
	constructor(message, code) {
		super(message);
		this.code = code;
	}
}

export class LlmAdapter {}

export function attributionHeaders() {
	return { 'user-agent': 'dsh-devin2api-test' };
}
