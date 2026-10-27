import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const SEND_MODES = ["raw", "en"] as const;
export type SendMode = (typeof SEND_MODES)[number];

export const THINKING_LEVEL_NAMES = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const;
export type ThinkingLevelName = (typeof THINKING_LEVEL_NAMES)[number];

export interface EnglishSettings {
	/** Whether the companion processes messages at all. */
	enabled: boolean;
	/** `raw` sends the original message, `en` sends the processed English. */
	sendMode: SendMode;
	/** `auto` follows Pi's current model; otherwise `provider/model-id`. */
	model: string;
	thinkingLevel: ThinkingLevelName;
	/** Number of recent branch messages used as context, 0-10. */
	contextMessages: number;
	/** Correct English input instead of leaving it untouched. */
	englishCorrection: boolean;
	timeoutMs: number;
	/** Messages longer than this are skipped; 0 disables the limit. */
	maxInputChars: number;
	failurePolicy: "send-raw";
	/** Internal line budget. Not user configurable in the MVP. */
	maxWidgetLines: number;
}

export const DEFAULT_SETTINGS: EnglishSettings = {
	enabled: true,
	sendMode: "raw",
	model: "auto",
	thinkingLevel: "low",
	contextMessages: 4,
	englishCorrection: true,
	timeoutMs: 15000,
	maxInputChars: 4000,
	failurePolicy: "send-raw",
	maxWidgetLines: 4,
};

export const MIN_CONTEXT_MESSAGES = 0;
export const MAX_CONTEXT_MESSAGES = 10;
export const MIN_TIMEOUT_MS = 1000;
export const MAX_TIMEOUT_MS = 60000;
export const MIN_INPUT_CHARS = 0;
export const MAX_INPUT_CHARS = 100000;

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function normalizeSendMode(value: unknown): SendMode {
	// Legacy configurations used `original` / `translated`.
	if (value === "original") return "raw";
	if (value === "translated") return "en";
	return value === "en" ? "en" : "raw";
}

function normalizeThinkingLevel(value: unknown): ThinkingLevelName {
	return typeof value === "string" && (THINKING_LEVEL_NAMES as readonly string[]).includes(value)
		? (value as ThinkingLevelName)
		: DEFAULT_SETTINGS.thinkingLevel;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.min(max, Math.max(min, Math.round(value)));
}

/** Turn untrusted config data into a complete, valid settings object. */
export function normalizeSettings(raw: unknown): EnglishSettings {
	const record = asRecord(raw) ?? {};
	const model = typeof record.model === "string" && record.model.trim() ? record.model.trim() : "auto";
	return {
		enabled: typeof record.enabled === "boolean" ? record.enabled : DEFAULT_SETTINGS.enabled,
		sendMode: normalizeSendMode(record.sendMode),
		model,
		thinkingLevel: normalizeThinkingLevel(record.thinkingLevel),
		contextMessages: clampInt(
			record.contextMessages,
			MIN_CONTEXT_MESSAGES,
			MAX_CONTEXT_MESSAGES,
			DEFAULT_SETTINGS.contextMessages,
		),
		englishCorrection:
			typeof record.englishCorrection === "boolean"
				? record.englishCorrection
				: DEFAULT_SETTINGS.englishCorrection,
		timeoutMs: clampInt(record.timeoutMs, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS, DEFAULT_SETTINGS.timeoutMs),
		maxInputChars: clampInt(
			record.maxInputChars,
			MIN_INPUT_CHARS,
			MAX_INPUT_CHARS,
			DEFAULT_SETTINGS.maxInputChars,
		),
		// Only one supported policy today, so malformed input cannot weaken it.
		failurePolicy: "send-raw",
		maxWidgetLines: clampInt(record.maxWidgetLines, 2, 4, DEFAULT_SETTINGS.maxWidgetLines),
	};
}

/** Settings are shared by every project and session, stored in Pi's agent directory. */
export class SettingsStore {
	private readonly filePath: string;
	private settings: EnglishSettings;
	private loaded = false;

	constructor(filePath: string) {
		this.filePath = filePath;
		this.settings = { ...DEFAULT_SETTINGS };
	}

	get(): EnglishSettings {
		if (!this.loaded) this.reload();
		return this.settings;
	}

	reload(): EnglishSettings {
		this.loaded = true;
		try {
			const parsed: unknown = JSON.parse(readFileSync(this.filePath, "utf8"));
			this.settings = normalizeSettings(parsed);
		} catch {
			// Missing or corrupt files fall back to defaults instead of breaking Pi.
			this.settings = { ...DEFAULT_SETTINGS };
		}
		return this.settings;
	}

	/**
	 * Apply a patch in memory, then persist.
	 * A write failure keeps the new value for this process and is rethrown so callers can notify.
	 */
	update(patch: Partial<EnglishSettings>): EnglishSettings {
		this.settings = normalizeSettings({ ...this.get(), ...patch });
		this.loaded = true;
		this.save();
		return this.settings;
	}

	private save(): void {
		mkdirSync(dirname(this.filePath), { recursive: true });
		const tempPath = `${this.filePath}.${process.pid}.tmp`;
		try {
			writeFileSync(tempPath, `${JSON.stringify(this.settings, null, 2)}\n`, "utf8");
			renameSync(tempPath, this.filePath);
		} catch (error) {
			try {
				unlinkSync(tempPath);
			} catch {
				// Temp file may not exist.
			}
			throw error;
		}
	}
}
