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
const PLACEHOLDER_EN = "—";
const PLACEHOLDER_ANALYSIS = "（无解析）";

function normalizeText(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function ellipsizeToWidth(text: string, width: number): string {
	if (width <= 0) return "";
	if (visibleWidth(text) <= width) return text;
	if (width === 1) return "…";
	return `${truncateToWidth(text, width - 1, "")}…`;
}

function fitLine(text: string, width: number): string {
	return visibleWidth(text) <= width ? text : truncateToWidth(text, width, "");
}

/**
 * Lay out the learning panel within the terminal width.
 * Every wrapped line is kept, so the panel grows with its content instead of
 * truncating long English or detailed analyses.
 */
export function layoutPanel(width: number, content: PanelContent): PanelLayout {
	if (!Number.isFinite(width) || width <= 0) return { labelWidth: 0, rows: [] };

	const labelWidth = width >= MIN_LABELED_WIDTH ? LABEL_COLUMN_WIDTH : 0;
	const bodyWidth = Math.max(1, width - labelWidth);

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

	const rows: PanelRow[] = [];
	const addSection = (lines: string[], kind: PanelRowKind, label: string, placeholder: string): void => {
		const shown = lines.length > 0 ? lines : [placeholder];
		shown.forEach((line, index) => {
			rows.push({ label: index === 0 ? label : "", text: fitLine(line, bodyWidth), kind });
		});
	};
	addSection(enLines, "en", LABELS.en, PLACEHOLDER_EN);
	addSection(zhLines, "analysis", LABELS.analysis, PLACEHOLDER_ANALYSIS);

	return { labelWidth, rows };
}
