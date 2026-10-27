export interface RecentContextMessage {
	role: "user" | "assistant";
	text: string;
}

/** Minimal structural view of a session branch entry, so this module stays testable. */
interface BranchEntryLike {
	type: string;
	message?: {
		role?: unknown;
		content?: unknown;
	};
}

export const DEFAULT_CONTEXT_TOKEN_BUDGET = 1200;

export function estimateTokens(text: string): number {
	const cjk = text.match(/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g)?.length ?? 0;
	return Math.ceil(cjk + (text.length - cjk) / 4);
}

function messageText(message: { content?: unknown }): string {
	const { content } = message;
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const part of content) {
		if (
			typeof part === "object" &&
			part !== null &&
			(part as { type?: unknown }).type === "text" &&
			typeof (part as { text?: unknown }).text === "string"
		) {
			parts.push((part as { text: string }).text);
		}
	}
	return parts.join("\n").trim();
}

/** Take the last `limit` user/assistant text messages from the active branch. */
export function extractRecentMessages(
	entries: readonly BranchEntryLike[],
	limit: number,
): RecentContextMessage[] {
	if (!Number.isFinite(limit) || limit <= 0) return [];
	const messages: RecentContextMessage[] = [];
	for (let index = entries.length - 1; index >= 0 && messages.length < limit; index -= 1) {
		const entry = entries[index];
		if (!entry || entry.type !== "message" || !entry.message) continue;
		const role = entry.message.role;
		if (role !== "user" && role !== "assistant") continue;
		const text = messageText(entry.message);
		if (!text) continue;
		messages.push({ role, text });
	}
	return messages.reverse();
}

function shrinkToTokenBudget(text: string, budget: number): string {
	if (budget <= 0) return "";
	if (estimateTokens(text) <= budget) return text;
	let used = 0;
	let end = 0;
	for (const char of text) {
		const cost = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/.test(char) ? 1 : 0.25;
		if (used + cost > budget) break;
		used += cost;
		end += char.length;
	}
	return `${text.slice(0, end).trimEnd()}…`;
}

/**
 * Format context oldest-to-newest under a token budget.
 * The newest messages survive; an oversized newest message is shortened.
 */
export function formatContext(
	messages: readonly RecentContextMessage[],
	tokenBudget: number = DEFAULT_CONTEXT_TOKEN_BUDGET,
): string {
	if (messages.length === 0 || tokenBudget <= 0) return "";
	const accepted: string[] = [];
	let remaining = tokenBudget;
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (!message) continue;
		const prefix = message.role === "user" ? "User: " : "Assistant: ";
		const full = `${prefix}${message.text}`;
		const cost = estimateTokens(full);
		if (cost <= remaining) {
			accepted.push(full);
			remaining -= cost;
			continue;
		}
		// Keep the newest oversized message, shortened, and stop there.
		if (accepted.length === 0 && remaining > prefix.length) {
			const shortened = shrinkToTokenBudget(message.text, remaining - estimateTokens(prefix));
			if (shortened) accepted.push(`${prefix}${shortened}`);
		}
		break;
	}
	return accepted.reverse().join("\n");
}
