import assert from "node:assert/strict";
import { test } from "node:test";
import { estimateTokens, extractRecentMessages, formatContext } from "../src/context.ts";

function user(text: string) {
	return { type: "message", message: { role: "user", content: [{ type: "text", text }] } };
}
function assistant(text: string) {
	return { type: "message", message: { role: "assistant", content: [{ type: "text", text }] } };
}

test("takes the most recent messages in chronological order", () => {
	const entries = [user("one"), assistant("two"), user("three"), assistant("four"), user("five")];
	const messages = extractRecentMessages(entries, 4);
	assert.deepEqual(
		messages.map((message) => message.text),
		["two", "three", "four", "five"],
	);
});

test("limit zero disables context and non-message entries are ignored", () => {
	assert.deepEqual(extractRecentMessages([user("hello")], 0), []);
	const entries = [
		{ type: "custom", data: { text: "ignored" } },
		{ type: "message", message: { role: "toolResult", content: "ignored" } },
		{ type: "message", message: { role: "user", content: [] } },
		user("kept"),
	];
	assert.deepEqual(extractRecentMessages(entries, 5), [{ role: "user", text: "kept" }]);
});

test("reads text parts from array content and ignores tool calls and images", () => {
	const entries = [
		{
			type: "message",
			message: {
				role: "assistant",
				content: [
					{ type: "text", text: "first part" },
					{ type: "toolCall", name: "read", arguments: {} },
					{ type: "text", text: "second part" },
				],
			},
		},
	];
	assert.deepEqual(extractRecentMessages(entries, 4), [
		{ role: "assistant", text: "first part\nsecond part" },
	]);
});

test("formats context with role labels", () => {
	const text = formatContext([
		{ role: "user", text: "把 foo 改成异步" },
		{ role: "assistant", text: "好的，我来修改。" },
	]);
	assert.equal(text, "User: 把 foo 改成异步\nAssistant: 好的，我来修改。");
	assert.equal(formatContext([]), "");
});

test("drops old messages to stay inside the token budget", () => {
	const messages = Array.from({ length: 20 }, (_, index) => ({
		role: "user" as const,
		text: `message ${index} ${"x".repeat(200)}`,
	}));
	const formatted = formatContext(messages, 60);
	assert.ok(estimateTokens(formatted) <= 60, `budget exceeded: ${estimateTokens(formatted)}`);
	assert.ok(formatted.includes("message 19"));
	assert.ok(!formatted.includes("message 0"));
});

test("shortens an oversized newest message instead of returning nothing", () => {
	const formatted = formatContext([{ role: "user", text: "中".repeat(500) }], 40);
	assert.ok(formatted.startsWith("User: 中"));
	assert.ok(formatted.endsWith("…"));
	assert.ok(estimateTokens(formatted) <= 40);
});

test("token estimate counts CJK characters heavier than latin text", () => {
	assert.equal(estimateTokens("abcd"), 1);
	assert.equal(estimateTokens("中文"), 2);
	assert.ok(estimateTokens("这是一个中文句子") > estimateTokens("short english words"));
});
