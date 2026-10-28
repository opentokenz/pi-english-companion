import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { layoutPanel, type PanelContent, type PanelLayout, type PanelRow } from "./layout.ts";

const WIDGET_KEY = "pi-english-companion";

export type PanelState =
	| { kind: "hidden" }
	| { kind: "content"; content: PanelContent };

function styleLabel(theme: Theme, row: PanelRow): string {
	if (!row.label) return "";
	switch (row.kind) {
		case "en":
			return theme.fg("accent", theme.bold(row.label));
		case "analysis":
			return theme.fg("mdLink", theme.bold(row.label));
		case "notice":
			return theme.fg("warning", row.label);
		case "status":
			return theme.fg("dim", row.label);
	}
}

function styleBody(theme: Theme, row: PanelRow): string {
	switch (row.kind) {
		case "en":
			return theme.fg("text", theme.bold(row.text));
		case "analysis":
			return theme.fg("syntaxString", row.text);
		case "notice":
			return theme.fg("warning", row.text);
		case "status":
			return theme.fg("dim", row.text);
	}
}

function renderRow(theme: Theme, row: PanelRow, labelWidth: number): string {
	const label = styleLabel(theme, row);
	const padding = " ".repeat(Math.max(0, labelWidth - visibleWidth(row.label)));
	return `${label}${padding}${styleBody(theme, row)}`;
}

/** Width the rows may occupy: the widget reserves one column of trailing space. */
export function panelInnerWidth(width: number): number {
	return Math.max(1, width - 1);
}

/** Pure render step, exported for layout checks. */
export function renderPanelLines(theme: Theme, width: number, layout: PanelLayout): string[] {
	const padding = width > 1 ? " " : "";
	const innerWidth = panelInnerWidth(width);
	return layout.rows.map((row) => {
		const line = layout.labelWidth > 0 ? renderRow(theme, row, layout.labelWidth) : styleBody(theme, row);
		// Trailing guard for terminals narrower than the label column.
		return `${padding}${truncateToWidth(line, innerWidth, "")}`;
	});
}

function createPanelComponent(theme: Theme, content: PanelContent): Component {
	return {
		render(width: number): string[] {
			// Lay out against the same width renderPanelLines can actually write.
			return renderPanelLines(theme, width, layoutPanel(panelInnerWidth(width), content));
		},
		invalidate(): void {
			// Stateless: everything is recomputed from the live theme on each render.
		},
	};
}

/**
 * Owns the widget above the editor. Every state change replaces the widget component,
 * so a stale async task can never paint over a newer one.
 */
export class LearningPanel {
	private visible = false;

	apply(ctx: ExtensionContext, state: PanelState): void {
		if (ctx.mode !== "tui") return;
		if (state.kind === "hidden") {
			this.clear(ctx);
			return;
		}
		const content = state.content;
		ctx.ui.setWidget(WIDGET_KEY, (_tui, theme) => createPanelComponent(theme, content), {
			placement: "aboveEditor",
		});
		this.visible = true;
	}

	clear(ctx: ExtensionContext): void {
		if (ctx.mode !== "tui") {
			this.visible = false;
			return;
		}
		if (!this.visible) return;
		ctx.ui.setWidget(WIDGET_KEY, undefined);
		this.visible = false;
	}

	get isVisible(): boolean {
		return this.visible;
	}
}
