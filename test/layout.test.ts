import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
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
		["EN", "解析"],
	);
	assertFits(layout, 80);
});

test("long English expands before the analysis and stays within four lines", () => {
	const layout = layoutPanel(40, {
		english:
			"Could you please refactor this helper so that it returns a promise and update every caller in the module accordingly?",
		analysis: "refactor（重构）",
	});
	assert.ok(layout.rows.length >= 3 && layout.rows.length <= 4);
	const enRows = layout.rows.filter((row) => row.kind === "en");
	const zhRows = layout.rows.filter((row) => row.kind === "analysis");
	assert.ok(enRows.length >= 2, "long English should use multiple lines");
	assert.equal(zhRows.length, 1, "analysis keeps one line");
	assertFits(layout, 40);
});

test("English is capped at three lines and the analysis at two", () => {
	const layout = layoutPanel(24, {
		english:
			"Could you refactor this helper so that it returns a promise, then update every caller in the module and its tests accordingly?",
		analysis:
			"refactor（重构）/ promise（承诺、异步结果）/ caller（调用方）/ accordingly（相应地）",
	});
	assert.equal(layout.rows.length, 4);
	assert.deepEqual(
		layout.rows.map((row) => row.label),
		["EN", "", "", "解析"],
	);
	assert.equal(layout.rows.at(-1)?.text.endsWith("…"), true);
	assertFits(layout, 24);
});

test("English completeness wins over analysis detail when both overflow", () => {
	const layout = layoutPanel(30, {
		english:
			"Could you please refactor this helper so that it returns a promise and update every caller in the module?",
		analysis: "refactor（重构）/ promise（异步）/ caller（调用方）",
	});
	const enRows = layout.rows.filter((row) => row.kind === "en");
	const zhRows = layout.rows.filter((row) => row.kind === "analysis");
	assert.equal(enRows.length, 3);
	assert.equal(zhRows.length, 1);
});

test("short English leaves room for two analysis lines", () => {
	const layout = layoutPanel(26, {
		english: "Make it async?",
		analysis: "Could you（礼貌请求）/ make ... async（使异步）/ 省略主语更自然",
	});
	assert.equal(layout.rows.length, 3);
	assert.equal(layout.rows.filter((row) => row.kind === "analysis").length, 2);
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

test("respects a reduced internal line budget", () => {
	const layout = layoutPanel(20, {
		english: "Could you refactor this helper and update all of its callers?",
		analysis: "refactor（重构）/ caller（调用方）",
	}, 2);
	assert.equal(layout.rows.length, 2);
	assertFits(layout, 20);
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
