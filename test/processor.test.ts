import assert from "node:assert/strict";
import { test } from "node:test";
import { LatestWins, SerialQueue } from "../src/coordinator.ts";
import { LanguageError, requestLanguageResult } from "../src/processor.ts";

const valid = '{"en":"Could you make this asynchronous?","analysis":"make ... asynchronous（使异步）"}';

test("returns the parsed language result", async () => {
	const result = await requestLanguageResult({
		generate: async () => valid,
		timeoutMs: 1000,
	});
	assert.deepEqual(result, {
		english: "Could you make this asynchronous?",
		analysis: "make ... asynchronous（使异步）",
	});
});

test("aborts the provider and reports a timeout", async () => {
	let providerSignal: AbortSignal | undefined;
	const started = Date.now();
	await assert.rejects(
		requestLanguageResult({
			generate: (signal) => {
				providerSignal = signal;
				return new Promise<string>(() => {
					// Never resolves; the timeout must win.
				});
			},
			timeoutMs: 30,
		}),
		(error: unknown) => error instanceof LanguageError && error.code === "timeout",
	);
	assert.ok(Date.now() - started < 1000);
	assert.equal(providerSignal?.aborted, true);
});

test("honors an external abort signal", async () => {
	const controller = new AbortController();
	const promise = requestLanguageResult({
		generate: (signal) =>
			new Promise<string>((_resolve, reject) => {
				const timer = setTimeout(() => reject(new Error("late")), 500);
				signal.addEventListener(
					"abort",
					() => {
						clearTimeout(timer);
						reject(new Error("aborted"));
					},
					{ once: true },
				);
			}),
		timeoutMs: 5000,
		signal: controller.signal,
	});
	controller.abort();
	await assert.rejects(promise, (error: unknown) => error instanceof LanguageError && error.code === "aborted");
});

test("rejects immediately when the signal is already aborted", async () => {
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(
		requestLanguageResult({
			generate: async () => valid,
			timeoutMs: 1000,
			signal: controller.signal,
		}),
		(error: unknown) => error instanceof LanguageError && error.code === "aborted",
	);
});

test("wraps provider failures and invalid model output", async () => {
	await assert.rejects(
		requestLanguageResult({
			generate: async () => {
				throw new Error("network down");
			},
			timeoutMs: 1000,
		}),
		(error: unknown) => error instanceof LanguageError && error.code === "failed",
	);

	await assert.rejects(
		requestLanguageResult({ generate: async () => "not json", timeoutMs: 1000 }),
		(error: unknown) => error instanceof LanguageError && error.code === "invalid",
	);
});

test("latest-wins sequence invalidates older tasks", () => {
	const latest = new LatestWins();
	const first = latest.next();
	assert.equal(latest.isCurrent(first), true);
	const second = latest.next();
	assert.equal(latest.isCurrent(first), false);
	assert.equal(latest.isCurrent(second), true);
	latest.invalidate();
	assert.equal(latest.isCurrent(second), false);
});

test("serial queue keeps submission order", async () => {
	const queue = new SerialQueue();
	const order: string[] = [];
	const first = queue.run(async () => {
		await new Promise((resolve) => setTimeout(resolve, 30));
		order.push("first");
		return 1;
	});
	const second = queue.run(async () => {
		order.push("second");
		return 2;
	});
	const third = queue.run(async () => {
		order.push("third");
		return 3;
	});
	assert.deepEqual(await Promise.all([first, second, third]), [1, 2, 3]);
	assert.deepEqual(order, ["first", "second", "third"]);
});

test("serial queue survives a rejected task", async () => {
	const queue = new SerialQueue();
	await assert.rejects(
		queue.run(async () => {
			throw new Error("boom");
		}),
	);
	assert.equal(await queue.run(async () => "ok"), "ok");
});
