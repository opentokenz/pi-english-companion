import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

export type PanelRowKind = "en" | "analysis" | "status" | "notice";

export interface PanelRow {
	/** Label shown on the first row of a section; empty for continuation rows. */
	label: string;
	/** Text that already fits `width - labelWidth`. */
	text: string;
	kind: PanelRowKind;
}

export interface PanelLayout {
	labelWidth: number;
	rows: PanelRow[];
}

export interface PanelContent {
	english?: string;
	analysis?: string;
	/** Renders the two-line "working" state instead of a result. */
	status?: "processing";
	/** Renders a one-line transient warning instead of a result. */
	notice?: string;
}

const LABELS = { en: "EN", analysis: "AN", notice: "⚠" } as const;
const LABEL_COLUMN_WIDTH = 5;
const MIN_LABELED_WIDTH = 16;
const EN_MAX_LINES = 3;
const ANALYSIS_MAX_LINES = 2;
const DEFAULT_MAX_LINES = 4;

function normalizeText(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function ellipsizeToWidth(text: string, width: number): string {
	if (width <= 0) return "";
	if (visibleWidth(text) <= width) return text;
	if (width === 1) return "…";
	return `${truncateToWidth(text, width - 1, "")}…`;
}

/** Signal that more content exists, even when the visible line itself fits. */
function appendEllipsis(text: string, width: number): string {
	if (width <= 0) return "";
	if (width === 1) return "…";
	const body = visibleWidth(text) <= width - 1 ? text : truncateToWidth(text, width - 1, "");
	return `${body}…`;
}

function takeLines(lines: string[], count: number, width: number): string[] {
	const shown = lines.slice(0, Math.max(0, count)).map((line) =>
		visibleWidth(line) <= width ? line : ellipsizeToWidth(line, width),
	);
	if (shown.length > 0 && lines.length > count) {
		const last = shown.length - 1;
		shown[last] = appendEllipsis(shown[last] ?? "", width);
	}
	return shown;
}

/**
 * Lay out the learning panel within the terminal width.
 * English keeps at least one line and may use three; the analysis gets one or two.
 * The result never exceeds `maxLines` and never contains blank filler lines.
 */
export function layoutPanel(
	width: number,
	content: PanelContent,
	maxLines: number = DEFAULT_MAX_LINES,
): PanelLayout {
	if (!Number.isFinite(width) || width <= 0) return { labelWidth: 0, rows: [] };

	const labelWidth = width >= MIN_LABELED_WIDTH ? LABEL_COLUMN_WIDTH : 0;
	const bodyWidth = Math.max(1, width - labelWidth);
	const requestedLines = Number.isFinite(maxLines) ? Math.floor(maxLines) : DEFAULT_MAX_LINES;
	const budget = Math.min(DEFAULT_MAX_LINES, Math.max(2, requestedLines));

	if (content.notice !== undefined) {
		const text = ellipsizeToWidth(normalizeText(content.notice), bodyWidth);
		return { labelWidth, rows: [{ label: LABELS.notice, text, kind: "notice" }] };
	}

	if (content.status === "processing") {
		return {
			labelWidth,
			rows: [
				{ label: LABELS.en, text: ellipsizeToWidth("处理中…", bodyWidth), kind: "status" },
				{
					label: LABELS.analysis,
					text: ellipsizeToWidth("正在结合上下文生成英文表达与解析", bodyWidth),
					kind: "status",
				},
			],
		};
	}

	const english = normalizeText(content.english ?? "");
	const analysis = normalizeText(content.analysis ?? "");
	const enLines = english ? wrapTextWithAnsi(english, bodyWidth) : [];
	const zhLines = analysis ? wrapTextWithAnsi(analysis, bodyWidth) : [];
	if (enLines.length === 0 && zhLines.length === 0) return { labelWidth, rows: [] };

	const enCap = Math.min(EN_MAX_LINES, budget - 1);
	const enCount = Math.min(Math.max(enLines.length, 1), enCap);
	const zhCap = Math.min(ANALYSIS_MAX_LINES, budget - enCount);
	const zhCount = Math.min(Math.max(zhLines.length, 1), Math.max(1, zhCap));

	const rows: PanelRow[] = [];
	const enShown = takeLines(enLines.length > 0 ? enLines : ["—"], enCount, bodyWidth);
	enShown.forEach((text, index) => {
		rows.push({ label: index === 0 ? LABELS.en : "", text, kind: "en" });
	});
	const zhShown = takeLines(zhLines.length > 0 ? zhLines : ["（无解析）"], zhCount, bodyWidth);
	zhShown.forEach((text, index) => {
		rows.push({ label: index === 0 ? LABELS.analysis : "", text, kind: "analysis" });
	});

	return { labelWidth, rows };
}
