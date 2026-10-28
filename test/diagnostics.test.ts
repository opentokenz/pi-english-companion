import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import {
	appendLanguageLog,
	errorDetail,
	formatLogLine,
	LOG_ERROR_MAX_CHARS,
	type LanguageLogEntry,
} from "../src/diagnostics.ts";
import { LanguageError } from "../src/processor.ts";

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-english-log-"));
	tempDirs.push(dir);
	return dir;
}

const failure: LanguageLogEntry = {
	event: "failure",
	code: "timeout",
	model: "test/test-model",
	kind: "zh",
	elapsedMs: 15002,
	timeoutMs: 15000,
	chars: 12,
	error: "LanguageError: timeout",
};

test("formatLogLine writes one single-line JSON record with a timestamp", () => {
	const now = new Date("2026-10-28T01:02:03.004Z");
	const line = formatLogLine(failure, now);
	assert.ok(!line.includes("\n"), "a log record must never span lines");
	const parsed = JSON.parse(line) as Record<string, unknown>;
	assert.equal(parsed.time, "2026-10-28T01:02:03.004Z");
	assert.equal(parsed.event, "failure");
	assert.equal(parsed.code, "timeout");
	assert.equal(parsed.model, "test/test-model");
	assert.equal(parsed.kind, "zh");
	assert.equal(parsed.elapsedMs, 15002);
	assert.equal(parsed.timeoutMs, 15000);
	assert.equal(parsed.chars, 12);
	assert.equal(parsed.error, "LanguageError: timeout");
});

test("errorDetail keeps the cause chain on one line and truncates it", () => {
	const error = new LanguageError("failed", "outer", { cause: new Error("inner\n  detail") });
	assert.equal(errorDetail(error), "outer | inner detail");

	const long = errorDetail(new Error("x".repeat(LOG_ERROR_MAX_CHARS + 50)));
	assert.equal(long.length, LOG_ERROR_MAX_CHARS);
	assert.ok(long.endsWith("…"));
});

test("appendLanguageLog creates the directory and appends JSONL records", () => {
	const filePath = join(tempDir(), "nested", "english-companion.log");
	appendLanguageLog(filePath, failure);
	appendLanguageLog(filePath, { ...failure, code: "invalid", event: "slow" });
	const lines = readFileSync(filePath, "utf8").trimEnd().split("\n");
	assert.equal(lines.length, 2);
	assert.equal((JSON.parse(lines[0] ?? "{}") as Record<string, unknown>).code, "timeout");
	assert.equal((JSON.parse(lines[1] ?? "{}") as Record<string, unknown>).event, "slow");
});

test("appendLanguageLog rotates the file instead of growing without bound", () => {
	const filePath = join(tempDir(), "english-companion.log");
	writeFileSync(filePath, "old-content\n".repeat(20));
	const before = statSync(filePath).size;
	appendLanguageLog(filePath, failure, { maxBytes: 64 });
	assert.equal(readFileSync(`${filePath}.1`, "utf8"), "old-content\n".repeat(20));
	const lines = readFileSync(filePath, "utf8").trimEnd().split("\n");
	assert.equal(lines.length, 1);
	assert.ok(statSync(filePath).size < before);
});

test("appendLanguageLog never throws when the log cannot be written", () => {
	const dirPath = tempDir();
	assert.doesNotThrow(() => appendLanguageLog(dirPath, failure));
});
