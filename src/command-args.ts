import { MAX_CONTEXT_MESSAGES } from "./config.ts";
import type { SendMode } from "./config.ts";

export type EnglishCommand =
	| { type: "settings" }
	| { type: "enabled"; value: boolean }
	| { type: "send"; value: SendMode }
	| { type: "model" }
	| { type: "context"; value: number }
	| { type: "thinking-not-supported" }
	| {
			type: "error";
			reason:
				| "unknown"
				| "missing-send-mode"
				| "invalid-send-mode"
				| "missing-context"
				| "invalid-context";
	  };

/** Parse the text after `/english` (Pi passes the remainder as one string). */
export function parseEnglishCommand(args: string): EnglishCommand {
	const trimmed = args.trim();
	if (!trimmed) return { type: "settings" };

	const [rawHead = "", ...rest] = trimmed.split(/\s+/);
	const head = rawHead.toLowerCase();
	const tail = rest.join(" ").trim();

	switch (head) {
		case "on":
			return tail ? { type: "error", reason: "unknown" } : { type: "enabled", value: true };
		case "off":
			return tail ? { type: "error", reason: "unknown" } : { type: "enabled", value: false };
		case "send": {
			if (!tail) return { type: "error", reason: "missing-send-mode" };
			const mode = tail.toLowerCase();
			if (mode === "raw" || mode === "en") return { type: "send", value: mode };
			return { type: "error", reason: "invalid-send-mode" };
		}
		case "model":
			return tail ? { type: "error", reason: "unknown" } : { type: "model" };
		case "context": {
			if (!tail) return { type: "error", reason: "missing-context" };
			if (!/^\d+$/.test(tail)) return { type: "error", reason: "invalid-context" };
			const value = Number(tail);
			if (!Number.isInteger(value) || value < 0 || value > MAX_CONTEXT_MESSAGES) {
				return { type: "error", reason: "invalid-context" };
			}
			return { type: "context", value };
		}
		case "thinking":
			return { type: "thinking-not-supported" };
		default:
			return { type: "error", reason: "unknown" };
	}
}

export const COMMAND_USAGE = [
	"用法：",
	"/english            打开全局设置",
	"/english on|off     开启或关闭插件",
	"/english send raw   发送原始消息",
	"/english send en    发送处理后的英文",
	`/english model      选择模型与思考强度`,
	`/english context N  设置上下文条数（0-${MAX_CONTEXT_MESSAGES}）`,
].join("\n");
