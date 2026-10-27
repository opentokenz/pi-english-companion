import assert from "node:assert/strict";
import { test } from "node:test";
import { parseEnglishCommand } from "../src/command-args.ts";

test("no arguments opens global settings", () => {
	assert.deepEqual(parseEnglishCommand(""), { type: "settings" });
	assert.deepEqual(parseEnglishCommand("   "), { type: "settings" });
});

test("on and off toggle the plugin", () => {
	assert.deepEqual(parseEnglishCommand("on"), { type: "enabled", value: true });
	assert.deepEqual(parseEnglishCommand("OFF"), { type: "enabled", value: false });
});

test("send accepts only raw and en", () => {
	assert.deepEqual(parseEnglishCommand("send raw"), { type: "send", value: "raw" });
	assert.deepEqual(parseEnglishCommand("send en"), { type: "send", value: "en" });
	assert.deepEqual(parseEnglishCommand("send translated"), { type: "error", reason: "invalid-send-mode" });
	assert.deepEqual(parseEnglishCommand("send"), { type: "error", reason: "missing-send-mode" });
});

test("context accepts integers from 0 to 10", () => {
	assert.deepEqual(parseEnglishCommand("context 0"), { type: "context", value: 0 });
	assert.deepEqual(parseEnglishCommand("context 10"), { type: "context", value: 10 });
	assert.deepEqual(parseEnglishCommand("context 11"), { type: "error", reason: "invalid-context" });
	assert.deepEqual(parseEnglishCommand("context -1"), { type: "error", reason: "invalid-context" });
	assert.deepEqual(parseEnglishCommand("context 2.5"), { type: "error", reason: "invalid-context" });
	assert.deepEqual(parseEnglishCommand("context"), { type: "error", reason: "missing-context" });
});

test("model opens the combined model and thinking screen", () => {
	assert.deepEqual(parseEnglishCommand("model"), { type: "model" });
});

test("thinking is explicitly not a standalone command", () => {
	assert.deepEqual(parseEnglishCommand("thinking high"), { type: "thinking-not-supported" });
});

test("unknown arguments are rejected", () => {
	assert.deepEqual(parseEnglishCommand("wat"), { type: "error", reason: "unknown" });
	assert.deepEqual(parseEnglishCommand("on extra"), { type: "error", reason: "unknown" });
});
