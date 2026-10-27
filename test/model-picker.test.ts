import assert from "node:assert/strict";
import { test } from "node:test";
import { filterModelChoices, type ModelChoice } from "../src/model-picker.ts";

const choices: ModelChoice[] = [
	{ value: "auto", label: "Auto", description: "跟随 Pi 当前模型" },
	{ value: "anthropic/claude-sonnet", label: "claude-sonnet", description: "anthropic" },
	{ value: "openai/gpt-5", label: "gpt-5", description: "openai · GPT-5" },
	{ value: "openrouter/google/gemini-2.5-flash", label: "google/gemini-2.5-flash", description: "openrouter" },
];

test("an empty query keeps every choice in order", () => {
	assert.deepEqual(filterModelChoices(choices, "").map((choice) => choice.value), choices.map((choice) => choice.value));
	assert.deepEqual(filterModelChoices(choices, "   ").length, choices.length);
});

test("filters by model id, provider and description, case-insensitively", () => {
	assert.deepEqual(filterModelChoices(choices, "GPT").map((choice) => choice.value), ["openai/gpt-5"]);
	assert.deepEqual(filterModelChoices(choices, "anthropic").map((choice) => choice.value), ["anthropic/claude-sonnet"]);
	assert.deepEqual(filterModelChoices(choices, "gemini").map((choice) => choice.value), [
		"openrouter/google/gemini-2.5-flash",
	]);
});

test("supports multiple terms across fields", () => {
	assert.deepEqual(filterModelChoices(choices, "openrouter gemini").map((choice) => choice.value), [
		"openrouter/google/gemini-2.5-flash",
	]);
	assert.deepEqual(filterModelChoices(choices, "跟随 pi").map((choice) => choice.value), ["auto"]);
});

test("returns no matches instead of throwing", () => {
	assert.deepEqual(filterModelChoices(choices, "does-not-exist"), []);
});
