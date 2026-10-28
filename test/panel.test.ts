import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { layoutPanel } from "../src/layout.ts";
import { renderPanelLines, panelInnerWidth } from "../src/panel.ts";

function fakeTheme(colors: Array<{ color: string; text: string }> = []): Theme {
	return {
		fg(color: string, text: string) {
			colors.push({ color, text });
			return text;
		},
		bg: (_color: string, text: string) => text,
		bold: (text: string) => text,
	} as unknown as Theme;
}

function render(width: number, content: Parameters<typeof layoutPanel>[1], colors?: Array<{ color: string; text: string }>) {
	return renderPanelLines(fakeTheme(colors), width, layoutPanel(panelInnerWidth(width), content));
}

test("renders aligned EN and AN labels for a normal terminal", () => {
	const lines = render(60, {
		english: "Could you make this function asynchronous?",
		analysis: "Could you（礼貌请求）/ asynchronous（异步的）",
	});
	assert.equal(lines.length, 2);
	assert.match(lines[0] ?? "", /^ EN\s+Could you make this function asynchronous\?$/);
	assert.match(lines[1] ?? "", /^ AN\s+Could you/);
});

test("drops labels on narrow terminals so the text keeps its space", () => {
	const lines = render(12, { english: "Make it async", analysis: "使异步" });
	assert.ok(lines.length >= 2);
	for (const line of lines) {
		assert.ok(visibleWidth(line) <= 12);
		assert.ok(!line.includes("EN "), `unexpected label: ${JSON.stringify(line)}`);
		assert.ok(!/^ ?AN /.test(line), `unexpected label: ${JSON.stringify(line)}`);
	}
});

test("never exceeds the terminal width, even at extreme sizes", () => {
	const content = {
		english: "Could you check this 👋🏽 please?",
		analysis: "check（检查）/ 更自然、更礼貌 🚀",
	};
	for (let width = 1; width <= 40; width += 1) {
		for (const line of render(width, content)) {
			assert.ok(
				visibleWidth(line) <= width,
				`line ${JSON.stringify(line)} is ${visibleWidth(line)} wide at width ${width}`,
			);
		}
	}
});

test("rows that fill the terminal keep their last character", () => {
	const content = {
		english: "Could you make this function asynchronous before the next release?",
		analysis: "asynchronous（异步的）/ 中文解析也要完整显示，不能被尾部的列宽保留咬掉",
	};
	for (let width = 16; width <= 72; width += 1) {
		const layout = layoutPanel(panelInnerWidth(width), content);
		const lines = renderPanelLines(fakeTheme(), width, layout);
		lines.forEach((line, index) => {
			const row = layout.rows[index];
			assert.ok(row, `missing row ${index} at width ${width}`);
			assert.ok(
				line.includes(row.text),
				`width ${width}: ${JSON.stringify(row.text)} was clipped from ${JSON.stringify(line)}`,
			);
			assert.ok(visibleWidth(line) <= width, `width ${width}: ${JSON.stringify(line)} is too wide`);
			assert.ok(!line.includes("\u001b"), `width ${width}: truncation leaked an escape code`);
		});
	}
});

test("applies accent to the EN label, link blue to the analysis label, amber to the analysis body, and warning to notices", () => {
	const resultColors: Array<{ color: string; text: string }> = [];
	render(60, { english: "Make it async", analysis: "使异步" }, resultColors);
	assert.ok(resultColors.some((entry) => entry.color === "accent" && entry.text === "EN"));
	assert.ok(resultColors.some((entry) => entry.color === "mdLink" && entry.text === "AN"));
	assert.ok(
		resultColors.some((entry) => entry.color === "syntaxString" && entry.text === "使异步"),
		"the analysis body gets its own amber tone",
	);

	const noticeColors: Array<{ color: string; text: string }> = [];
	render(60, { notice: "翻译失败，已发送原文" }, noticeColors);
	assert.ok(noticeColors.some((entry) => entry.color === "warning"));
});

test("processing rows use the dim style on both lines", () => {
	const colors: Array<{ color: string; text: string }> = [];
	const lines = render(60, { status: "processing" }, colors);
	assert.equal(lines.length, 2);
	assert.ok(colors.every((entry) => entry.color === "dim"));
});
