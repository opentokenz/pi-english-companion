import assert from "node:assert/strict";
import { test } from "node:test";
import { buildUserPayload, parseLanguageResult, SYSTEM_PROMPT } from "../src/prompt.ts";

test("the system prompt asks for strict JSON and preserves code placeholders", () => {
	assert.ok(SYSTEM_PROMPT.includes('{"en":"<natural English rewrite>"'));
	assert.ok(SYSTEM_PROMPT.includes("{{code:N}}"));
	assert.ok(SYSTEM_PROMPT.includes("Chinese learning note"));
});

test("builds a payload with optional context", () => {
	const withContext = buildUserPayload({
		kind: "zh",
		context: "User: 你好\nAssistant: Hi",
		text: "帮我把这个改成异步",
	});
	assert.equal(
		withContext,
		'<context>\nUser: 你好\nAssistant: Hi\n</context>\n\n<message language="Chinese">\n帮我把这个改成异步\n</message>',
	);

	const withoutContext = buildUserPayload({ kind: "en", context: "", text: "fix this" });
	assert.ok(!withoutContext.includes("<context>"));
	assert.ok(withoutContext.includes('language="English"'));
});

test("parses a clean JSON reply", () => {
	assert.deepEqual(parseLanguageResult('{"en":"Could you make this asynchronous?","analysis":"make ... asynchronous（使异步）"}'), {
		english: "Could you make this asynchronous?",
		analysis: "make ... asynchronous（使异步）",
	});
});

test("parses fenced JSON and ignores surrounding prose", () => {
	const raw = 'Here you go:\n```json\n{"en":"Can you help me fix this bug?","analysis":"helps → help（情态动词后用原形）"}\n```\nDone.';
	assert.deepEqual(parseLanguageResult(raw), {
		english: "Can you help me fix this bug?",
		analysis: "helps → help（情态动词后用原形）",
	});
});

test("tolerates JSON braces inside the English text", () => {
	const raw = '{"en":"Please keep {{code:0}} as is.","analysis":"as is（保持原样）"}';
	assert.equal(parseLanguageResult(raw)?.english, "Please keep {{code:0}} as is.");
});

test("joins analysis arrays and normalizes whitespace", () => {
	const raw = '{"en":"  Use   this  ","analysis":[" first  point ","second point"]}';
	assert.deepEqual(parseLanguageResult(raw), {
		english: "Use this",
		analysis: "first point；second point",
	});
});

test("strips wrapping quotes and role prefixes", () => {
	const raw = '{"en":"\\"Could you try again?\\"","analysis":"解析：Could you（礼貌请求）"}';
	assert.deepEqual(parseLanguageResult(raw), {
		english: "Could you try again?",
		analysis: "Could you（礼貌请求）",
	});
});

test("rejects malformed or incomplete replies", () => {
	assert.equal(parseLanguageResult("not json"), null);
	assert.equal(parseLanguageResult('{"analysis":"only analysis"}'), null);
	assert.equal(parseLanguageResult('{"en":"only english"}'), null);
	assert.equal(parseLanguageResult('{"en":"","analysis":"x"}'), null);
	assert.equal(parseLanguageResult('{"en":"x","analysis":"   "}'), null);
	assert.equal(parseLanguageResult('{"en":42,"analysis":"x"}'), null);
	assert.equal(parseLanguageResult("[]"), null);
});
