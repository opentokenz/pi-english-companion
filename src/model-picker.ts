import type { Component } from "@earendil-works/pi-tui";
import { getKeybindings, matchesKey, SelectList, truncateToWidth } from "@earendil-works/pi-tui";
import { getSelectListTheme, type Theme } from "@earendil-works/pi-coding-agent";

export interface ModelChoice {
	/** Stored value: `auto` or `provider/model-id`. */
	value: string;
	label: string;
	description?: string;
}

/** Case-insensitive substring filter over value, label and description. */
export function filterModelChoices(choices: readonly ModelChoice[], query: string): ModelChoice[] {
	const normalized = query.trim().toLowerCase();
	if (!normalized) return [...choices];
	const terms = normalized.split(/\s+/);
	return choices.filter((choice) => {
		const haystack = `${choice.value} ${choice.label} ${choice.description ?? ""}`.toLowerCase();
		return terms.every((term) => haystack.includes(term));
	});
}

export interface ModelPickerOptions {
	choices: readonly ModelChoice[];
	currentValue: string;
	theme: Theme;
	title?: string;
	onDone: (value?: string) => void;
}

/**
 * Compact, searchable model list. Typing filters; arrows navigate; Enter selects; Esc returns.
 * Built on SelectList so scrolling and width handling match Pi's other pickers.
 */
export function createModelPicker(options: ModelPickerOptions): Component {
	const { theme, onDone } = options;
	const title = options.title ?? "选择模型";
	const keybindings = getKeybindings();
	let query = "";
	let filtered = filterModelChoices(options.choices, query);
	let list = buildList();

	function buildList(): SelectList {
		const items = filtered.map((choice, index) => ({
			value: String(index),
			label: choice.label,
			...(choice.description ? { description: choice.description } : {}),
		}));
		const next = new SelectList(items, 10, getSelectListTheme(), {
			minPrimaryColumnWidth: 28,
			maxPrimaryColumnWidth: 52,
		});
		next.onSelect = (item) => {
			const choice = filtered[Number(item.value)];
			if (choice) onDone(choice.value);
		};
		next.onCancel = () => onDone(undefined);
		return next;
	}

	function refresh(): void {
		filtered = filterModelChoices(options.choices, query);
		list = buildList();
		const currentIndex = filtered.findIndex((choice) => choice.value === options.currentValue);
		if (query === "" && currentIndex >= 0) list.setSelectedIndex(currentIndex);
	}

	refresh();

	return {
		render(width: number): string[] {
			const queryLine = query
				? theme.fg("accent", `筛选：${query}`)
				: theme.fg("dim", "直接输入可筛选模型");
			const rows = filtered.length > 0 ? list.render(width) : [theme.fg("dim", "没有匹配的模型")];
			return [
				truncateToWidth(theme.fg("accent", theme.bold(title)), width),
				truncateToWidth(queryLine, width),
				...rows,
				truncateToWidth(theme.fg("dim", "↑↓ 选择 · Enter 确认 · Esc 返回"), width),
			];
		},
		invalidate(): void {
			list.invalidate();
		},
		handleInput(data: string): void {
			if (
				keybindings.matches(data, "tui.select.up") ||
				keybindings.matches(data, "tui.select.down") ||
				keybindings.matches(data, "tui.select.confirm") ||
				keybindings.matches(data, "tui.select.cancel")
			) {
				list.handleInput(data);
				return;
			}
			if (matchesKey(data, "backspace")) {
				query = query.slice(0, -1);
				refresh();
				return;
			}
			// Ignore other escape sequences (modified arrows, function keys, ...).
			if (data.startsWith("\u001b")) return;
			// Printable input, including pasted text and CJK.
			const printable = data.replace(/[\u0000-\u001f\u007f]/g, "");
			if (printable) {
				query += printable;
				refresh();
			}
		},
	};
}
