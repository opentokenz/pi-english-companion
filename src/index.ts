import { join } from "node:path";
import type { UserMessage } from "@earendil-works/pi-ai";
import { getAgentDir, type ExtensionAPI, type ExtensionContext, type InputEvent, type InputEventResult } from "@earendil-works/pi-coding-agent";
import { classifyInput, type Classification } from "./analyze.ts";
import { runEnglishCommand } from "./commands.ts";
import { SettingsStore, MAX_CONTEXT_MESSAGES } from "./config.ts";
import { extractRecentMessages, formatContext } from "./context.ts";
import { LatestWins, SerialQueue } from "./coordinator.ts";
import { LearningPanel } from "./panel.ts";
import { effectiveThinking, resolveLanguageModel } from "./models.ts";
import { buildUserPayload, SYSTEM_PROMPT, type LanguageResult } from "./prompt.ts";
import { LanguageError, requestLanguageResult } from "./processor.ts";

type ProcessableInput = Extract<Classification, { action: "process" }>;

const WIDGET_NOTICE_MS = 4000;

function failureText(error: unknown): string {
	if (error instanceof LanguageError) {
		switch (error.code) {
			case "timeout":
				return "处理超时，已发送原文";
			case "aborted":
				return "处理已取消，已发送原文";
			case "invalid":
				return "模型返回了无效结果，已发送原文";
			case "no-model":
				return "没有可用的模型，已发送原文";
			case "failed":
				return "处理失败，已发送原文";
		}
	}
	return "处理失败，已发送原文";
}

function notify(ctx: ExtensionContext, message: string, type: "info" | "warning" | "error"): void {
	if (ctx.hasUI) ctx.ui.notify(message, type);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export default function englishCompanion(pi: ExtensionAPI): void {
	const store = new SettingsStore(join(getAgentDir(), "english-companion.json"));
	const latest = new LatestWins();
	const enQueue = new SerialQueue();
	const panel = new LearningPanel(() => store.get().maxWidgetLines);

	let lastResult: LanguageResult | undefined;
	let abortCurrent: AbortController | undefined;
	let noticeTimer: ReturnType<typeof setTimeout> | undefined;
	let announcedModelNote: string | undefined;

	const clearNoticeTimer = (): void => {
		if (noticeTimer !== undefined) clearTimeout(noticeTimer);
		noticeTimer = undefined;
	};

	const resetDisplay = (ctx: ExtensionContext): void => {
		clearNoticeTimer();
		lastResult = undefined;
		panel.clear(ctx);
	};

	const resetSession = (ctx: ExtensionContext): void => {
		abortCurrent?.abort();
		abortCurrent = undefined;
		latest.invalidate();
		resetDisplay(ctx);
	};

	const showResult = (ctx: ExtensionContext, result: LanguageResult): void => {
		clearNoticeTimer();
		lastResult = result;
		panel.apply(ctx, {
			kind: "content",
			content: { english: result.english, analysis: result.analysis },
		});
	};

	const showWorking = (ctx: ExtensionContext): void => {
		clearNoticeTimer();
		panel.apply(ctx, { kind: "content", content: { status: "processing" } });
	};

	const showNotice = (ctx: ExtensionContext, text: string): void => {
		clearNoticeTimer();
		panel.apply(ctx, { kind: "content", content: { notice: text } });
		const timer = setTimeout(() => {
			noticeTimer = undefined;
			if (!store.get().enabled) {
				panel.clear(ctx);
				return;
			}
			if (lastResult) {
				panel.apply(ctx, {
					kind: "content",
					content: { english: lastResult.english, analysis: lastResult.analysis },
				});
			} else {
				panel.clear(ctx);
			}
		}, WIDGET_NOTICE_MS);
		// Do not keep the process alive just for this cosmetic timer.
		if (typeof timer === "object" && timer !== null && "unref" in timer) timer.unref();
		noticeTimer = timer;
	};

	const runLanguageTask = async (
		classification: ProcessableInput,
		ctx: ExtensionContext,
		signal: AbortSignal,
	): Promise<LanguageResult> => {
		const settings = store.get();
		const resolved = resolveLanguageModel(ctx.modelRegistry, ctx.model, settings.model);
		if (!resolved) throw new LanguageError("no-model");
		if (resolved.note && resolved.note !== announcedModelNote) {
			announcedModelNote = resolved.note;
			notify(ctx, resolved.note, "warning");
		}

		const context = formatContext(
			extractRecentMessages(ctx.sessionManager.getBranch(), settings.contextMessages),
		);
		const payload = buildUserPayload({
			kind: classification.kind,
			context,
			text: classification.protected.masked,
		});
		const model = resolved.model;
		const reasoning = effectiveThinking(model, settings.thinkingLevel);
		const userMessage: UserMessage = {
			role: "user",
			content: payload,
			timestamp: Date.now(),
		};

		const parsed = await requestLanguageResult({
			timeoutMs: settings.timeoutMs,
			signal,
			generate: async (taskSignal) => {
				const stream = ctx.modelRegistry.streamSimple(
					model,
					{ systemPrompt: SYSTEM_PROMPT, messages: [userMessage] },
					{
						signal: taskSignal,
						maxTokens: 2048,
						...(reasoning ? { reasoning } : {}),
					},
				);
				const message = await stream.result();
				if (message.stopReason === "aborted") throw new Error("aborted");
				if (message.stopReason === "error") throw new Error(message.errorMessage ?? "model error");
				return message.content
					.filter((block): block is { type: "text"; text: string } => block.type === "text")
					.map((block) => block.text)
					.join("\n");
			},
		});

		// Put protected code back exactly as the user wrote it, or fail closed.
		const restored = classification.protected.restore(parsed.english);
		if (restored === null) throw new LanguageError("invalid");
		return { english: restored, analysis: parsed.analysis };
	};

	pi.on("session_start", (_event, ctx) => {
		resetSession(ctx);
	});

	pi.on("session_before_switch", (_event, ctx) => {
		resetSession(ctx);
	});

	pi.on("session_before_fork", (_event, ctx) => {
		resetSession(ctx);
	});

	pi.on("session_tree", (_event, ctx) => {
		// Branch navigation changes the context and invalidates the old panel.
		resetSession(ctx);
	});

	pi.on("session_shutdown", () => {
		abortCurrent?.abort();
		abortCurrent = undefined;
		clearNoticeTimer();
	});

	const handleInput = async (event: InputEvent, ctx: ExtensionContext): Promise<InputEventResult> => {
		// Another extension already produced this message; never rewrite it again.
		if (event.source === "extension") return { action: "continue" };

		const settings = store.get();
		if (!settings.enabled) return { action: "continue" };
		if (settings.maxInputChars > 0 && event.text.length > settings.maxInputChars) {
			// Long pastes are not worth rewriting; send them unchanged.
			return { action: "continue" };
		}

		const classification = classifyInput(event.text);
		if (classification.action === "skip") return { action: "continue" };
		if (classification.kind === "en" && !settings.englishCorrection) return { action: "continue" };

		const sessionId = ctx.sessionManager.getSessionId();
		const sequence = latest.next();
		const sameSession = (): boolean => ctx.sessionManager.getSessionId() === sessionId;
		const mayPaint = (): boolean => sameSession() && latest.isCurrent(sequence) && store.get().enabled;

		if (settings.sendMode === "raw") {
			// Raw mode never delays the agent: the message continues immediately.
			abortCurrent?.abort();
			const controller = new AbortController();
			abortCurrent = controller;
			showWorking(ctx);
			void runLanguageTask(classification, ctx, controller.signal)
				.then(
					(result) => {
						if (mayPaint()) showResult(ctx, result);
					},
					(error: unknown) => {
						if (mayPaint()) showNotice(ctx, failureText(error));
					},
				)
				.finally(() => {
					if (abortCurrent === controller) abortCurrent = undefined;
				});
			return { action: "continue" };
		}

		// En mode: process behind a serial queue so messages arrive in submission order,
		// then hand exactly one transformed message to the agent.
		return enQueue.run(async () => {
			if (!sameSession()) return { action: "continue" };

			abortCurrent?.abort();
			const controller = new AbortController();
			abortCurrent = controller;
			showWorking(ctx);

			try {
				const result = await runLanguageTask(classification, ctx, controller.signal);
				if (mayPaint()) showResult(ctx, result);
				return {
					action: "transform",
					text: result.english,
					...(event.images && event.images.length > 0 ? { images: event.images } : {}),
				};
			} catch (error) {
				const text = failureText(error);
				if (mayPaint()) showNotice(ctx, text);
				notify(ctx, `${text}；本次已改发原文。`, "warning");
				return { action: "continue" };
			} finally {
				if (abortCurrent === controller) abortCurrent = undefined;
			}
		});
	};

	pi.on("input", async (event, ctx) => {
		try {
			return await handleInput(event, ctx);
		} catch (error) {
			// A companion bug must never swallow the user's message.
			notify(ctx, `English Companion 处理异常，已发送原文：${errorMessage(error)}`, "warning");
			return { action: "continue" };
		}
	});

	pi.registerCommand("english", {
		description: "English companion: /english on|off, send raw|en, model, context N",
		getArgumentCompletions: (argumentPrefix) => {
			const prefix = argumentPrefix.trimStart();
			if (prefix.startsWith("context")) {
				const rest = prefix.slice("context".length).trimStart();
				const items = Array.from({ length: MAX_CONTEXT_MESSAGES + 1 }, (_, index) => String(index))
					.filter((value) => value.startsWith(rest))
					.map((value) => ({
						value: `context ${value}`,
						label: `context ${value}`,
						description: "读取最近多少条消息作为上下文",
					}));
				return items.length > 0 ? items : null;
			}
			if (prefix.startsWith("send")) {
				const rest = prefix.slice("send".length).trimStart();
				const items = ["raw", "en"]
					.filter((mode) => mode.startsWith(rest))
					.map((mode) => ({
						value: `send ${mode}`,
						label: `send ${mode}`,
						description: mode === "raw" ? "发送原始消息" : "发送处理后的英文",
					}));
				return items.length > 0 ? items : null;
			}
			const subcommands = [
				{ value: "on", label: "on", description: "开启插件" },
				{ value: "off", label: "off", description: "关闭插件" },
				{ value: "send raw", label: "send raw", description: "发送原始消息" },
				{ value: "send en", label: "send en", description: "发送处理后的英文" },
				{ value: "model", label: "model", description: "选择模型与思考强度" },
				{ value: "context 4", label: "context N", description: "设置上下文条数（0-10）" },
			];
			const matches = subcommands.filter((item) => item.value.startsWith(prefix));
			return matches.length > 0 ? matches : null;
		},
		handler: async (args, ctx) => {
			await runEnglishCommand(args, ctx, store, panel);
		},
	});
}
