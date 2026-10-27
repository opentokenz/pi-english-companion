import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyInput, protectCode } from "../src/analyze.ts";

function process(text: string) {
	const result = classifyInput(text);
	assert.equal(result.action, "process", `expected processable input: ${JSON.stringify(text)}`);
	return result as Extract<typeof result, { action: "process" }>;
}

function skip(text: string) {
	const result = classifyInput(text);
	assert.equal(result.action, "skip", `expected skipped input: ${JSON.stringify(text)}`);
	return result as Extract<typeof result, { action: "skip" }>;
}

test("classifies plain Chinese as zh", () => {
	const result = process("帮我把这个函数改成异步的。");
	assert.equal(result.kind, "zh");
	assert.equal(result.protected.blocks.length, 0);
});

test("classifies plain English as en", () => {
	assert.equal(process("Can you helps me to fix this bug?").kind, "en");
	assert.equal(process("Could you make this function asynchronous?").kind, "en");
});

test("classifies mixed input as mixed", () => {
	assert.equal(process("把这个 function 改成 async 的").kind, "mixed");
	assert.equal(process("这个 API 返回 404，为什么？").kind, "mixed");
});

test("skips empty, slash commands, bash prefixes and structured data", () => {
	assert.equal(skip("   ").reason, "empty");
	assert.equal(skip("/english send en").reason, "command");
	assert.equal(skip("!git status").reason, "shell");
	assert.equal(skip('{"name":"pi","version":1}').reason, "data");
	assert.equal(skip("[1, 2, 3]").reason, "data");
	assert.equal(skip("<config><item>1</item></config>").reason, "data");
	assert.equal(skip("| name | value |\n| --- | --- |\n| a | 1 |").reason, "data");
	assert.equal(skip("diff --git a/a.ts b/a.ts\n@@ -1,2 +1,2 @@").reason, "data");
});

test("skips pure code and shell commands", () => {
	assert.equal(skip("const answer = items.map((item) => item.id);").reason, "code");
	assert.equal(skip("function foo(a, b) {\n  return a + b;\n}").reason, "code");
	assert.equal(skip("fix(a)").reason, "code");
	assert.equal(skip("SELECT * FROM users WHERE id = 1").reason, "code");
	assert.equal(skip("npm install --save-dev typescript").reason, "shell");
	assert.equal(skip("git rebase --continue").reason, "shell");
	assert.equal(skip("ls -la").reason, "shell");
	assert.equal(skip("pytest -q tests/").reason, "shell");
});

test("does not mistake ordinary English for shell commands", () => {
	assert.equal(process("go ahead and fix it").kind, "en");
	assert.equal(process("find the bug in this file").kind, "en");
	assert.equal(process("make a plan for the migration").kind, "en");
	assert.equal(process("Can you help me fix this bug?").kind, "en");
});

test("processes natural language that contains code", () => {
	const inline = process("为什么 `foo()` 返回 undefined？");
	assert.equal(inline.kind, "mixed");
	assert.equal(inline.protected.blocks.length, 1);

	const fenced = process("帮我改成这样：\n```js\nconst x = 1;\n```");
	assert.equal(fenced.kind, "zh");
	assert.equal(fenced.protected.blocks.length, 1);

	const english = process("Why does `items.map` return undefined?");
	assert.equal(english.kind, "en");
	assert.equal(english.protected.blocks.length, 1);
});

test("protects fenced blocks, inline code and obvious code lines", () => {
	const input = "请把这里：\n```ts\nconst a = 1;\n```\n还有 `b()` 一起改了";
	const protectedText = protectCode(input);
	assert.equal(protectedText.blocks.length, 2);
	assert.equal(protectedText.blocks[0], "```ts\nconst a = 1;\n```");
	assert.equal(protectedText.blocks[1], "`b()`");
	assert.ok(protectedText.masked.includes("{{code:0}}"));
	assert.ok(protectedText.masked.includes("{{code:1}}"));
});

test("masks a code line containing inline code as one block without nesting", () => {
	const protectedText = protectCode("Change `foo()` to `bar()`;");
	assert.deepEqual(protectedText.blocks, ["Change `foo()` to `bar()`;"]);
	assert.equal(protectedText.masked, "{{code:0}}");
	assert.equal(protectedText.restore("Please {{code:0}}"), "Please Change `foo()` to `bar()`;");
});

test("masks un-fenced code lines without swallowing prose", () => {
	const protectedText = protectCode("帮我看看这行\nconst token = getToken();\n是不是有问题？");
	assert.equal(protectedText.blocks.length, 1);
	assert.equal(protectedText.blocks[0], "const token = getToken();");
	assert.ok(protectedText.masked.includes("是不是有问题？"));
});

test("restore puts protected code back verbatim", () => {
	const protectedText = protectCode("use `a()` and:\n```\nlet b = 2\n```");
	assert.deepEqual(protectedText.blocks, ["```\nlet b = 2\n```", "`a()`"]);
	const restored = protectedText.restore("Could you use {{code:1}} and {{ code:0 }}?");
	assert.equal(restored, "Could you use `a()` and ```\nlet b = 2\n```?");
});

test("restore rejects output that loses a protected block", () => {
	const protectedText = protectCode("use `a()` here");
	assert.equal(protectedText.restore("Could you use it here?"), null);
	assert.equal(protectedText.restore("Could you use {{code:9}} here?"), null);
});

test("restore accepts the same placeholder more than once", () => {
	const protectedText = protectCode("看看 `x` 和 `x`");
	assert.equal(protectedText.restore("Check {{code:0}} and {{code:0}} and {{code:1}}"), "Check `x` and `x` and `x`");
});
