import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { layoutPanel, type PanelLayout } from "../src/layout.ts";

function assertFits(layout: PanelLayout, width: number): void {
	for (const row of layout.rows) {
		const total = (row.label ? layout.labelWidth : 0) + visibleWidth(row.text);
		assert.ok(total <= width, `row overflows: ${JSON.stringify(row)} (${total} > ${width})`);
	}
}

test("short content uses exactly two lines, one for English and one for analysis", () => {
	const layout = layoutPanel(80, {
		english: "Could you make this function asynchronous?",
		analysis: "Could you（礼貌请求）/ asynchronous（异步的）",
	});
	assert.equal(layout.rows.length, 2);
	assert.deepEqual(
		layout.rows.map((row) => row.label),
		["EN", "AN"],
	);
	assertFits(layout, 80);
});

test("long English wraps across as many lines as it needs", () => {
	const layout = layoutPanel(40, {
		english:
			"Could you please refactor this helper so that it returns a promise and update every caller in the module accordingly?",
		analysis: "refactor（重构）",
	});
	assert.ok(layout.rows.length >= 3);
	const enRows = layout.rows.filter((row) => row.kind === "en");
	const zhRows = layout.rows.filter((row) => row.kind === "analysis");
	assert.ok(enRows.length >= 2, "long English should use multiple lines");
	assert.equal(zhRows.length, 1, "analysis keeps one line");
	assertFits(layout, 40);
});

test("long content is no longer capped at four lines", () => {
	const english =
		"Could you refactor this helper so that it returns a promise, then update every caller in the module and its tests accordingly?";
	const analysis = "refactor（重构）/ promise（承诺、异步结果）/ caller（调用方）/ accordingly（相应地）";
	const layout = layoutPanel(24, { english, analysis });
	const bodyWidth = 24 - layout.labelWidth;
	const expected =
		wrapTextWithAnsi(english, bodyWidth).length + wrapTextWithAnsi(analysis, bodyWidth).length;

	assert.equal(layout.rows.length, expected);
	assert.ok(layout.rows.length > 4, `expected more than four lines, got ${layout.rows.length}`);
	const labels = layout.rows.map((row) => row.label);
	assert.equal(labels[0], "EN");
	assert.equal(layout.rows.find((row) => row.kind === "analysis")?.label, "AN");
	for (const row of layout.rows) {
		assert.ok(!row.text.endsWith("…"), `line was truncated: ${JSON.stringify(row.text)}`);
	}
	assertFits(layout, 24);
});

test("both sections keep every wrapped line when they overflow together", () => {
	const english =
		"Could you please refactor this helper so that it returns a promise and update every caller in the module?";
	const analysis = "refactor（重构）/ promise（异步）/ caller（调用方）/ 更直接的语气";
	const layout = layoutPanel(30, { english, analysis });
	const bodyWidth = 30 - layout.labelWidth;
	const enRows = layout.rows.filter((row) => row.kind === "en");
	const zhRows = layout.rows.filter((row) => row.kind === "analysis");

	assert.equal(enRows.length, wrapTextWithAnsi(english, bodyWidth).length);
	assert.equal(zhRows.length, wrapTextWithAnsi(analysis, bodyWidth).length);
	assert.ok(enRows.length >= 2 && zhRows.length >= 2);
});

test("a short English line keeps the whole wrapped analysis", () => {
	const analysis = "Could you（礼貌请求）/ make ... async（使异步）/ 省略主语更自然";
	const layout = layoutPanel(26, { english: "Make it async?", analysis });
	const bodyWidth = 26 - layout.labelWidth;
	const analysisLines = wrapTextWithAnsi(analysis, bodyWidth).length;

	assert.equal(layout.rows.map((row) => row.kind).join(","), ["en", ...Array(analysisLines).fill("analysis")].join(","));
	assert.ok(analysisLines >= 2);
	assertFits(layout, 26);
});

test("width changes keep wide characters and emoji inside the terminal width", () => {
	const content = {
		english: "Could you check this 👋🏽 please?",
		analysis: "check（检查）/ 这里的语气更自然，也更礼貌 🚀",
	};
	for (const width of [12, 16, 20, 33, 48, 80]) {
		const layout = layoutPanel(width, content);
		assertFits(layout, width);
		assert.ok(layout.rows.length >= 2);
	}
});

test("narrow terminals drop labels instead of squeezing the text", () => {
	const layout = layoutPanel(10, {
		english: "Make it async",
		analysis: "使异步",
	});
	assert.equal(layout.labelWidth, 0);
	assert.ok(layout.rows.length >= 2);
	assertFits(layout, 10);
});

test("processing state uses two lightweight lines", () => {
	const layout = layoutPanel(60, { status: "processing" });
	assert.equal(layout.rows.length, 2);
	assert.ok(!layout.rows[0]?.text.includes("\n"));
	assert.equal(layout.rows[0]?.kind, "status");
	assert.equal(layout.rows[1]?.kind, "status");
});

test("notice state is a single line", () => {
	const layout = layoutPanel(60, { notice: "翻译失败，已发送原文" });
	assert.equal(layout.rows.length, 1);
	assert.equal(layout.rows[0]?.kind, "notice");
});

test("missing analysis falls back to a placeholder line instead of a blank row", () => {
	const layout = layoutPanel(40, { english: "Make it async" });
	assert.equal(layout.rows.length, 2);
	assert.ok((layout.rows[1]?.text.length ?? 0) > 0);
});
