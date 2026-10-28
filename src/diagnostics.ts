import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname } from "node:path";
import type { LanguageErrorCode } from "./processor.ts";

export const LOG_FILE_NAME = "english-companion.log";
/** Rotate once the log passes this size, keeping the previous file as `.1`. */
export const LOG_MAX_BYTES = 256 * 1024;
export const LOG_ERROR_MAX_CHARS = 300;
/** Successful tasks slower than this are logged too, so timeouts can be predicted. */
export const SLOW_TASK_MS = 5000;

/**
 * One diagnostic record. Input text is never logged: only its length,
 * so the log can be shared when reporting a problem.
 */
export interface LanguageLogEntry {
	/** `failure` is always written; `slow` records a success close to the timeout. */
	event: "failure" | "slow";
	code: LanguageErrorCode | "ok";
	model?: string;
	kind?: string;
	elapsedMs: number;
	timeoutMs: number;
	chars: number;
	error?: string;
}

function singleLine(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

/** Flatten an error and its causes into one bounded line. */
export function errorDetail(error: unknown): string {
	const parts: string[] = [];
	const seen = new Set<unknown>();
	let current: unknown = error;
	for (let depth = 0; current !== undefined && current !== null && depth < 4; depth += 1) {
		if (seen.has(current)) break;
		seen.add(current);
		const message = current instanceof Error ? current.message : String(current);
		if (message.trim()) parts.push(singleLine(message));
		current = current instanceof Error ? current.cause : undefined;
	}
	const detail = parts.join(" | ");
	if (detail.length <= LOG_ERROR_MAX_CHARS) return detail;
	return `${detail.slice(0, LOG_ERROR_MAX_CHARS - 1)}…`;
}

export function formatLogLine(entry: LanguageLogEntry, now: Date = new Date()): string {
	const record: Record<string, unknown> = {
		time: now.toISOString(),
		event: entry.event,
		code: entry.code,
		model: entry.model ?? null,
		kind: entry.kind ?? null,
		elapsedMs: entry.elapsedMs,
		timeoutMs: entry.timeoutMs,
		chars: entry.chars,
	};
	if (entry.error) record.error = entry.error;
	return singleLine(JSON.stringify(record));
}

function rotateIfNeeded(filePath: string, maxBytes: number): void {
	let size: number;
	try {
		size = statSync(filePath).size;
	} catch {
		return;
	}
	if (size >= maxBytes) renameSync(filePath, `${filePath}.1`);
}

/** Best-effort append: diagnostics must never break message processing. */
export function appendLanguageLog(
	filePath: string,
	entry: LanguageLogEntry,
	options: { now?: Date; maxBytes?: number } = {},
): void {
	try {
		mkdirSync(dirname(filePath), { recursive: true });
		rotateIfNeeded(filePath, options.maxBytes ?? LOG_MAX_BYTES);
		appendFileSync(filePath, `${formatLogLine(entry, options.now)}\n`, "utf8");
	} catch {
		// A full disk or read-only agent directory is not worth a user-visible failure.
	}
}
