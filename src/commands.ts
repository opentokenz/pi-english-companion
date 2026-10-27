import type { Component } from "@earendil-works/pi-tui";
import { Container, SettingsList, Text, type SettingItem } from "@earendil-works/pi-tui";
import { getSettingsListTheme, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { COMMAND_USAGE, parseEnglishCommand } from "./command-args.ts";
import {
	MAX_CONTEXT_MESSAGES,
	type EnglishSettings,
	type SettingsStore,
	type ThinkingLevelName,
} from "./config.ts";
import { createModelPicker, type ModelChoice } from "./model-picker.ts";
import {
	clampLevel,
	modelRef,
	resolveLanguageModel,
	supportedThinkingLevels,
} from "./models.ts";
import type { LearningPanel } from "./panel.ts";

const FALLBACK_LEVELS: ThinkingLevelName[] = ["off", "minimal", "low", "medium", "high"];

function notify(ctx: ExtensionContext, message: string, type: "info" | "warning" | "error" = "info"): void {
	if (ctx.hasUI) ctx.ui.notify(message, type);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Apply a settings patch; a failed disk write keeps the in-memory value and warns. */
function applyUpdate(ctx: ExtensionContext, store: SettingsStore, patch: Partial<EnglishSettings>): void {
	try {
		store.update(patch);
	} catch (error) {
		notify(ctx, `设置已在本次运行中生效，但写入配置失败：${errorMessage(error)}`, "warning");
	}
}

export function settingsSummary(settings: EnglishSettings): string {
	const mode = settings.sendMode === "raw" ? "raw（发送原文）" : "en（发送处理后的英文）";
	return [
		`English Companion：${settings.enabled ? "已开启" : "已关闭"}`,
		`发送模式：${mode}`,
		`模型：${settings.model} · 思考强度：${settings.thinkingLevel}`,
		`上下文：最近 ${settings.contextMessages} 条消息`,
		`英文纠错：${settings.englishCorrection ? "开启" : "关闭"}`,
	].join("\n");
}

function currentModelLabel(ctx: ExtensionContext, settings: EnglishSettings): string {
	const resolved = resolveLanguageModel(ctx.modelRegistry, ctx.model, settings.model);
	if (!resolved) return "当前没有可用模型";
	const suffix = settings.model === "auto" && ctx.model ? "（跟随 Pi 当前模型）" : "";
	return `当前使用 ${modelRef(resolved.model)}${suffix}`;
}

function buildModelChoices(ctx: ExtensionContext): ModelChoice[] {
	const autoDescription = ctx.model
		? `跟随 Pi 当前模型：${modelRef(ctx.model)}`
		: "使用第一个可用模型";
	const choices: ModelChoice[] = [{ value: "auto", label: "Auto", description: autoDescription }];
	const seen = new Set<string>();
	for (const model of ctx.modelRegistry.getAvailable()) {
		const value = modelRef(model);
		if (seen.has(value)) continue;
		seen.add(value);
		choices.push({
			value,
			label: model.id,
			description: model.name && model.name !== model.id ? `${model.provider} · ${model.name}` : model.provider,
		});
	}
	return choices.sort((left, right) => {
		if (left.value === "auto") return -1;
		if (right.value === "auto") return 1;
		return left.label.localeCompare(right.label) || left.value.localeCompare(right.value);
	});
}

/** Model + thinking level screen, shared by `/english model` and the settings submenu. */
export function createModelSettingsComponent(
	ctx: ExtensionContext,
	store: SettingsStore,
	theme: Theme,
	onClose: (value?: string) => void,
): Component {
	let list: SettingsList | undefined;
	const closeWithCurrent = (): void => onClose(`${store.get().model} · ${store.get().thinkingLevel}`);

	const initial = store.get();
	const initialResolved = resolveLanguageModel(ctx.modelRegistry, ctx.model, initial.model);
	const modelItem: SettingItem = {
		id: "model",
		label: "Model",
		description: currentModelLabel(ctx, initial),
		currentValue: initial.model,
		submenu: (_currentValue, done) =>
			createModelPicker({
				choices: buildModelChoices(ctx),
				currentValue: store.get().model,
				theme,
				onDone: (value) => (value === undefined ? done() : done(value)),
			}),
	};
	const thinkingItem: SettingItem = {
		id: "thinking",
		label: "Thinking Level",
		description: "只影响本插件的语言处理，不影响主 Agent",
		currentValue: initialResolved
			? clampLevel(initialResolved.model, initial.thinkingLevel)
			: initial.thinkingLevel,
		values: initialResolved ? supportedThinkingLevels(initialResolved.model) : [...FALLBACK_LEVELS],
	};

	list = new SettingsList(
		[modelItem, thinkingItem],
		4,
		getSettingsListTheme(),
		(id, value) => {
			if (id === "model") {
				applyUpdate(ctx, store, { model: value });
				const updated = store.get();
				const resolved = resolveLanguageModel(ctx.modelRegistry, ctx.model, updated.model);
				if (resolved) {
					const clamped = clampLevel(resolved.model, updated.thinkingLevel);
					if (clamped !== updated.thinkingLevel) applyUpdate(ctx, store, { thinkingLevel: clamped });
					thinkingItem.values = supportedThinkingLevels(resolved.model);
					thinkingItem.currentValue = clamped;
					list?.updateValue("thinking", clamped);
				}
				modelItem.currentValue = updated.model;
				modelItem.description = currentModelLabel(ctx, updated);
				list?.updateValue("model", updated.model);
			} else if (id === "thinking") {
				applyUpdate(ctx, store, { thinkingLevel: value as ThinkingLevelName });
			}
		},
		closeWithCurrent,
	);

	const container = new Container();
	container.addChild(new Text(theme.fg("accent", theme.bold("English Companion · 模型")), 1, 0));
	container.addChild(new Text(theme.fg("dim", "Model 与 Thinking Level 只属于本插件"), 1, 0));
	container.addChild(list);
	container.addChild(new Text(theme.fg("dim", "↑↓ 选择 · Enter 修改 · Esc 返回"), 1, 0));

	return {
		render: (width: number) => container.render(width),
		invalidate: () => container.invalidate(),
		handleInput: (data: string) => list?.handleInput(data),
	};
}

async function openModelSettings(ctx: ExtensionContext, store: SettingsStore): Promise<void> {
	await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
		const component = createModelSettingsComponent(ctx, store, theme, () => done(undefined));
		return {
			render: (width: number) => component.render(width),
			invalidate: () => component.invalidate?.(),
			handleInput: (data: string) => {
				component.handleInput?.(data);
				tui.requestRender();
			},
		};
	});
}

async function openSettings(ctx: ExtensionContext, store: SettingsStore, panel: LearningPanel): Promise<void> {
	if (ctx.mode !== "tui") {
		notify(
			ctx,
			`${settingsSummary(store.get())}\n\n交互式设置需要 TUI。可用命令：\n${COMMAND_USAGE}`,
			"info",
		);
		return;
	}

	await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
		let list: SettingsList | undefined;
		const settings = store.get();

		const modelItem: SettingItem = {
			id: "model",
			label: "模型与思考强度",
			description: currentModelLabel(ctx, settings),
			currentValue: `${settings.model} · ${settings.thinkingLevel}`,
			submenu: (_value, submenuDone) =>
				createModelSettingsComponent(ctx, store, theme, (value) => {
					if (value === undefined) submenuDone();
					else submenuDone(value);
				}),
		};

		const items: SettingItem[] = [
			{
				id: "enabled",
				label: "启用插件",
				description: "关闭后不再处理任何消息，Widget 也会隐藏",
				currentValue: settings.enabled ? "on" : "off",
				values: ["on", "off"],
			},
			{
				id: "sendMode",
				label: "发送模式",
				description: "raw：发送原文；en：等待处理并发送英文",
				currentValue: settings.sendMode,
				values: ["raw", "en"],
			},
			modelItem,
			{
				id: "contextMessages",
				label: "上下文条数",
				description: `读取当前分支最近的消息条数（0-${MAX_CONTEXT_MESSAGES}）`,
				currentValue: String(settings.contextMessages),
				values: Array.from({ length: MAX_CONTEXT_MESSAGES + 1 }, (_, index) => String(index)),
			},
			{
				id: "englishCorrection",
				label: "英文纠错",
				description: "关闭后，纯英文消息会原样发送且不做解析",
				currentValue: settings.englishCorrection ? "on" : "off",
				values: ["on", "off"],
			},
		];

		list = new SettingsList(
			items,
			10,
			getSettingsListTheme(),
			(id, value) => {
				if (id === "enabled") {
					applyUpdate(ctx, store, { enabled: value === "on" });
					if (value === "off") panel.clear(ctx);
				} else if (id === "sendMode") {
					applyUpdate(ctx, store, { sendMode: value === "en" ? "en" : "raw" });
				} else if (id === "contextMessages") {
					applyUpdate(ctx, store, { contextMessages: Number(value) });
				} else if (id === "englishCorrection") {
					applyUpdate(ctx, store, { englishCorrection: value === "on" });
				} else if (id === "model") {
					const updated = store.get();
					modelItem.currentValue = `${updated.model} · ${updated.thinkingLevel}`;
					modelItem.description = currentModelLabel(ctx, updated);
					list?.updateValue("model", modelItem.currentValue);
				}
			},
			() => done(undefined),
		);

		const container = new Container();
		container.addChild(new Text(theme.fg("accent", theme.bold("English Companion")), 1, 0));
		container.addChild(list);
		container.addChild(new Text(theme.fg("dim", "↑↓ 选择 · Enter 修改 · Esc 完成"), 1, 0));

		return {
			render: (width: number) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => {
				list?.handleInput(data);
				tui.requestRender();
			},
		};
	});
}

/** Entry point for the registered `/english` command. */
export async function runEnglishCommand(
	args: string,
	ctx: ExtensionContext,
	store: SettingsStore,
	panel: LearningPanel,
): Promise<void> {
	const command = parseEnglishCommand(args);
	switch (command.type) {
		case "settings":
			await openSettings(ctx, store, panel);
			return;
		case "enabled": {
			applyUpdate(ctx, store, { enabled: command.value });
			notify(ctx, command.value ? "English Companion 已开启" : "English Companion 已关闭");
			if (!command.value) panel.clear(ctx);
			return;
		}
		case "send": {
			applyUpdate(ctx, store, { sendMode: command.value });
			notify(
				ctx,
				command.value === "raw"
					? "发送模式：raw（原文发给 Agent，英文在旁路生成）"
					: "发送模式：en（等待处理完成，发送英文给 Agent）",
			);
			return;
		}
		case "model": {
			if (ctx.mode !== "tui") {
				const settings = store.get();
				notify(ctx, `${currentModelLabel(ctx, settings)}\n思考强度：${settings.thinkingLevel}\n模型选择界面需要 TUI。`, "info");
				return;
			}
			await openModelSettings(ctx, store);
			return;
		}
		case "context": {
			applyUpdate(ctx, store, { contextMessages: command.value });
			notify(ctx, `上下文条数：${command.value}`);
			return;
		}
		case "thinking-not-supported": {
			notify(ctx, "思考强度在 /english model 中与模型一起设置。", "info");
			return;
		}
		case "error": {
			notify(ctx, `${COMMAND_USAGE}\n\n${commandErrorText(command.reason)}`, "warning");
			return;
		}
	}
}

function commandErrorText(reason: Extract<ReturnType<typeof parseEnglishCommand>, { type: "error" }>["reason"]): string {
	switch (reason) {
		case "missing-send-mode":
			return "缺少发送模式，只能是 raw 或 en。";
		case "invalid-send-mode":
			return "发送模式只能是 raw 或 en。";
		case "missing-context":
			return "缺少上下文条数。";
		case "invalid-context":
			return `上下文条数必须是 0-${MAX_CONTEXT_MESSAGES} 的整数。`;
		case "unknown":
			return "未知的 /english 参数。";
	}
}
