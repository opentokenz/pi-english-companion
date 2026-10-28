import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import type { AssistantMessage, AssistantMessageEventStream, Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import englishCompanion from "../src/index.ts";

const WIDGET_KEY = "pi-english-companion";
const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const fakeModel = {
	id: "test-model",
	name: "Test Model",
	provider: "test",
	api: "openai-completions",
	reasoning: false,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 100000,
} as unknown as Model<"openai-completions">;

const theme = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
} as unknown as Theme;

interface Harness {
	handlers: Map<string, Array<(event: unknown, ctx: unknown) => unknown>>;
	commands: Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>;
	widgets: Map<string, unknown>;
	notifications: Array<{ message: string; type: string }>;
	payloads: string[];
	setReply(reply: string | (() => string)): void;
	emit(name: string, event: unknown): Promise<unknown[]>;
	runCommand(args: string): Promise<void>;
	renderWidget(width?: number): string[];
	ctx: Record<string, unknown>;
}

function createHarness(options: { mode?: "tui" | "print"; hang?: boolean } = {}): Harness {
	const agentDir = mkdtempSync(join(tmpdir(), "pi-english-e2e-"));
	tempDirs.push(agentDir);
	process.env.PI_CODING_AGENT_DIR = agentDir;

	let reply: string | (() => string) = '{"en":"Could you make this function asynchronous?","analysis":"Could you（礼貌请求）"}';
	const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => unknown>>();
	const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
	const widgets = new Map<string, unknown>();
	const notifications: Array<{ message: string; type: string }> = [];
	const payloads: string[] = [];

	const fakePi = {
		on(name: string, handler: (event: unknown, ctx: unknown) => unknown) {
			const list = handlers.get(name) ?? [];
			list.push(handler);
			handlers.set(name, list);
			return () => {};
		},
		registerCommand(name: string, definition: { handler: (args: string, ctx: unknown) => Promise<void> }) {
			commands.set(name, definition);
		},
	} as unknown as ExtensionAPI;

	englishCompanion(fakePi);

	const ctx: Record<string, unknown> = {
		mode: options.mode ?? "tui",
		hasUI: true,
		cwd: agentDir,
		model: fakeModel,
		thinkingLevel: "off",
		sessionManager: {
			getSessionId: () => "session-1",
			getBranch: () => [
				{ type: "message", message: { role: "user", content: [{ type: "text", text: "我在改一个上传组件。" }] } },
				{ type: "message", message: { role: "assistant", content: [{ type: "text", text: "好的。" }] } },
			],
		},
		modelRegistry: {
			find: () => undefined,
			getAvailable: () => [fakeModel],
			streamSimple: (_model: unknown, context: { messages: Array<{ content: string }> }) => {
				payloads.push(context.messages[0]?.content ?? "");
				if (options.hang) {
					return {
						result: () => new Promise<AssistantMessage>(() => {}),
					} as unknown as AssistantMessageEventStream;
				}
				const text = typeof reply === "function" ? reply() : reply;
				const message = {
					role: "assistant",
					content: [{ type: "text", text }],
					api: "openai-completions",
					provider: "test",
					model: "test-model",
					usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {} },
					stopReason: "stop",
					timestamp: Date.now(),
				} as unknown as AssistantMessage;
				return {
					result: async () => message,
				} as unknown as AssistantMessageEventStream;
			},
		},
		ui: {
			notify: (message: string, type: string) => notifications.push({ message, type }),
			setWidget: (key: string, content: unknown) => widgets.set(key, content),
		},
	};

	const harness: Harness = {
		handlers,
		commands,
		widgets,
		notifications,
		payloads,
		ctx,
		setReply(value) {
			reply = value;
		},
		async emit(name, event) {
			const list = handlers.get(name) ?? [];
			return Promise.all(list.map((handler) => handler(event, ctx)));
		},
		async runCommand(args) {
			const command = commands.get("english");
			assert.ok(command, "/english command must be registered");
			await command.handler(args, ctx);
		},
		renderWidget(width = 80) {
			const content = widgets.get(WIDGET_KEY);
			if (typeof content !== "function") return [];
			const component = (content as (tui: TUI, theme: Theme) => Component)(
				{ requestRender: () => {} } as unknown as TUI,
				theme,
			);
			return component.render(width);
		},
	};
	return harness;
}

function logPath(harness: Harness): string {
	return join(String(harness.ctx.cwd), "english-companion.log");
}

function logEntries(harness: Harness): Array<Record<string, unknown>> {
	const path = logPath(harness);
	if (!existsSync(path)) return [];
	return readFileSync(path, "utf8")
		.trimEnd()
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as Record<string, unknown>);
}

function loggedCode(harness: Harness, code: string): boolean {
	return logEntries(harness).some((entry) => entry.code === code);
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error("timed out waiting for condition");
}

async function submit(harness: Harness, text: string, source = "interactive") {
	const handler = harness.handlers.get("input")?.[0];
	assert.ok(handler, "input handler must be registered");
	return handler({ type: "input", text, source }, harness.ctx) as Promise<Record<string, unknown>>;
}

test("raw mode continues immediately and paints the result asynchronously", async () => {
	const harness = createHarness();
	const result = await submit(harness, "帮我把这个函数改成异步的。");
	assert.deepEqual(result, { action: "continue" });
	assert.ok(harness.renderWidget().length > 0, "processing state should be visible");

	await waitFor(() => harness.renderWidget().join("\n").includes("Could you make this function asynchronous?"));
	const lines = harness.renderWidget();
	assert.equal(lines.length, 2);
	assert.ok(lines[0]?.includes("EN"));
	assert.ok(lines[1]?.includes("AN"));
	assert.ok(harness.payloads[0]?.includes("我在改一个上传组件。"), "recent context should be sent");
});

test("en mode sends exactly one transformed message and restores code", async () => {
	const harness = createHarness();
	harness.setReply('{"en":"Could you make {{code:0}} asynchronous?","analysis":"asynchronous（异步的）"}');
	await harness.runCommand("send en");
	const result = await submit(harness, "帮我把 `foo()` 改成异步的。");
	assert.equal(result.action, "transform");
	assert.equal(result.text, "Could you make `foo()` asynchronous?");
	assert.ok(harness.payloads[0]?.includes("{{code:0}}"), "the model should receive a placeholder");
	assert.ok(harness.payloads[0]?.includes("<message language"), "the payload should be structured");
});

test("en mode falls back to the original message when the model fails", async () => {
	const harness = createHarness();
	harness.setReply("this is not json");
	await harness.runCommand("send en");
	const result = await submit(harness, "帮我把这个函数改成异步的。");
	assert.deepEqual(result, { action: "continue" });
	assert.ok(harness.notifications.some((item) => item.message.includes("已改发原文")));
	assert.ok(harness.renderWidget().some((line) => line.includes("已发送原文")));
});

test("en mode falls back when the model drops a code placeholder", async () => {
	const harness = createHarness();
	harness.setReply('{"en":"Could you make it asynchronous?","analysis":"asynchronous（异步的）"}');
	await harness.runCommand("send en");
	const result = await submit(harness, "帮我把 `foo()` 改成异步的。");
	assert.deepEqual(result, { action: "continue" });
	assert.ok(harness.notifications.some((item) => item.message.includes("无效结果")));
});

test("en mode serializes rapid submissions and the newest result owns the widget", async () => {
	const harness = createHarness();
	await harness.runCommand("send en");
	harness.setReply(() =>
		harness.payloads.length === 1
			? '{"en":"First request.","analysis":"第一条"}'
			: '{"en":"Second request.","analysis":"第二条"}',
	);
	const first = submit(harness, "第一个问题");
	const second = submit(harness, "第二个问题");
	await waitFor(() => harness.payloads.length === 2);
	const results = await Promise.all([first, second]);
	assert.equal(results[0]?.text, "First request.");
	assert.equal(results[1]?.text, "Second request.");
	assert.equal(harness.payloads.length, 2, "each submission produces exactly one model request");
	await waitFor(() => harness.renderWidget().join("\n").includes("Second request."));
	const widget = harness.renderWidget().join("\n");
	assert.ok(!widget.includes("First request."), "the older result must not overwrite the newer one");
});

test("oversized input is sent unchanged without language processing", async () => {
	const harness = createHarness();
	writeFileSync(
		join(String(harness.ctx.cwd), "english-companion.json"),
		JSON.stringify({ enabled: true, maxInputChars: 30 }),
	);
	const result = await submit(harness, "This English sentence is much longer than thirty characters.");
	assert.deepEqual(result, { action: "continue" });
	assert.equal(harness.payloads.length, 0);
	assert.equal(harness.renderWidget().length, 0);
});

test("extension-sourced and special inputs are never processed", async () => {	const harness = createHarness();
	assert.deepEqual(await submit(harness, "帮我把这个函数改成异步的。", "extension"), { action: "continue" });
	assert.deepEqual(await submit(harness, "npm install --save-dev typescript"), { action: "continue" });
	assert.deepEqual(await submit(harness, "const x = 1;"), { action: "continue" });
	assert.equal(harness.payloads.length, 0);
});

test("turning the plugin off hides the widget and stops processing", async () => {
	const harness = createHarness();
	await submit(harness, "帮我把这个函数改成异步的。");
	await waitFor(() => harness.renderWidget().length > 0);
	await harness.runCommand("off");
	assert.equal(harness.widgets.get(WIDGET_KEY), undefined);
	assert.deepEqual(await submit(harness, "再帮我改一处"), { action: "continue" });
	assert.equal(harness.payloads.length, 1);
});

test("session switch clears the previous session display", async () => {
	const harness = createHarness();
	await submit(harness, "帮我把这个函数改成异步的。");
	await waitFor(() => harness.renderWidget().length > 0);
	await harness.emit("session_start", { type: "session_start" });
	assert.equal(harness.widgets.get(WIDGET_KEY), undefined);
});

test("disabled English correction leaves English input alone but still handles Chinese", async () => {
	const harness = createHarness();
	writeFileSync(
		join(String(harness.ctx.cwd), "english-companion.json"),
		JSON.stringify({ enabled: true, englishCorrection: false }),
	);
	assert.deepEqual(await submit(harness, "Can you helps me to fix this bug?"), { action: "continue" });
	const chinese = await submit(harness, "帮我修一个 bug");
	assert.equal(chinese.action, "continue");
	await waitFor(() => harness.payloads.length === 1);
});

test("model failures are appended to the diagnostics log with the failure code", async () => {
	const harness = createHarness();
	harness.setReply("this is not json");
	await submit(harness, "帮我把这个函数改成异步的。");
	await waitFor(() => loggedCode(harness, "invalid"));
	const entry = logEntries(harness).at(-1);
	assert.equal(entry?.event, "failure");
	assert.equal(entry?.code, "invalid");
	assert.equal(entry?.model, "test/test-model");
	assert.equal(entry?.kind, "zh");
	assert.equal(entry?.timeoutMs, 15000);
	assert.equal(typeof entry?.elapsedMs, "number");
	assert.ok(!JSON.stringify(entry).includes("帮我把这个函数改成异步的"), "the log must not contain the input text");
});

test("a timeout is logged with the elapsed time and the configured limit", async () => {
	const harness = createHarness({ hang: true });
	writeFileSync(
		join(String(harness.ctx.cwd), "english-companion.json"),
		JSON.stringify({ timeoutMs: 1000 }),
	);
	await submit(harness, "帮我把这个函数改成异步的。");
	await waitFor(() => loggedCode(harness, "timeout"), 5000);
	const entry = logEntries(harness).at(-1);
	assert.equal(entry?.event, "failure");
	assert.equal(entry?.timeoutMs, 1000);
	assert.ok(Number(entry?.elapsedMs) >= 900, "elapsed time should reach the timeout");
});
