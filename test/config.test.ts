import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import {
	DEFAULT_SETTINGS,
	MAX_CONTEXT_MESSAGES,
	MAX_INPUT_CHARS,
	SettingsStore,
	normalizeSettings,
} from "../src/config.ts";

const tempDirs: string[] = [];

function tempFile(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-english-config-"));
	tempDirs.push(dir);
	return join(dir, "nested", "settings.json");
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("normalizeSettings returns defaults for missing or invalid data", () => {
	assert.deepEqual(normalizeSettings(undefined), DEFAULT_SETTINGS);
	assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
	assert.deepEqual(normalizeSettings([]), DEFAULT_SETTINGS);
	assert.deepEqual(normalizeSettings({ enabled: "yes", sendMode: "nope" }), DEFAULT_SETTINGS);
});

test("normalizeSettings migrates legacy send mode values", () => {
	assert.equal(normalizeSettings({ sendMode: "original" }).sendMode, "raw");
	assert.equal(normalizeSettings({ sendMode: "translated" }).sendMode, "en");
	assert.equal(normalizeSettings({ sendMode: "raw" }).sendMode, "raw");
	assert.equal(normalizeSettings({ sendMode: "en" }).sendMode, "en");
});

test("normalizeSettings clamps context count and timeout into supported ranges", () => {
	assert.equal(normalizeSettings({ contextMessages: 99 }).contextMessages, MAX_CONTEXT_MESSAGES);
	assert.equal(normalizeSettings({ contextMessages: -3 }).contextMessages, 0);
	assert.equal(normalizeSettings({ contextMessages: 4.6 }).contextMessages, 5);
	assert.equal(normalizeSettings({ timeoutMs: 10 }).timeoutMs, 1000);
	assert.equal(normalizeSettings({ timeoutMs: 10_000_000 }).timeoutMs, 60000);
	assert.equal(normalizeSettings({ timeoutMs: Number.NaN }).timeoutMs, DEFAULT_SETTINGS.timeoutMs);
});

test("normalizeSettings keeps only supported thinking levels and the send-raw policy", () => {
	assert.equal(normalizeSettings({ thinkingLevel: "high" }).thinkingLevel, "high");
	assert.equal(normalizeSettings({ thinkingLevel: "turbo" }).thinkingLevel, "low");
	assert.equal(normalizeSettings({ failurePolicy: "drop" }).failurePolicy, "send-raw");
	assert.equal(normalizeSettings({ model: "   " }).model, "auto");
});

test("normalizeSettings clamps the input length and treats zero as unlimited", () => {
	assert.equal(normalizeSettings({}).maxInputChars, 4000);
	assert.equal(normalizeSettings({ maxInputChars: 0 }).maxInputChars, 0);
	assert.equal(normalizeSettings({ maxInputChars: -100 }).maxInputChars, 0);
	assert.equal(normalizeSettings({ maxInputChars: 900_000 }).maxInputChars, MAX_INPUT_CHARS);
	assert.equal(normalizeSettings({ maxInputChars: 3999.6 }).maxInputChars, 4000);
	assert.equal(normalizeSettings({ maxInputChars: "4000" }).maxInputChars, 4000);
	assert.equal(normalizeSettings({}).timeoutMs, 15000);
});

test("SettingsStore starts from defaults when the file does not exist", () => {
	const store = new SettingsStore(tempFile());
	assert.deepEqual(store.get(), DEFAULT_SETTINGS);
});

test("SettingsStore persists updates and reloads them", () => {
	const path = tempFile();
	const store = new SettingsStore(path);
	store.update({ sendMode: "en", model: "openai/gpt-5", contextMessages: 7, thinkingLevel: "medium" });

	const reloaded = new SettingsStore(path);
	assert.equal(reloaded.get().sendMode, "en");
	assert.equal(reloaded.get().model, "openai/gpt-5");
	assert.equal(reloaded.get().contextMessages, 7);
	assert.equal(reloaded.get().thinkingLevel, "medium");
});

test("SettingsStore writes normalized JSON and drops unknown keys", () => {
	const path = tempFile();
	const store = new SettingsStore(path);
	store.update({ contextMessages: 42 });
	const written: unknown = JSON.parse(readFileSync(path, "utf8"));
	assert.deepEqual(written, { ...DEFAULT_SETTINGS, contextMessages: MAX_CONTEXT_MESSAGES });
});

test("SettingsStore falls back to defaults for corrupt files and migrates legacy files", () => {
	const path = tempFile();
	// Creating the file once also creates the nested directory.
	new SettingsStore(path).update({});

	writeFileSync(path, "{not json", "utf8");
	assert.deepEqual(new SettingsStore(path).get(), DEFAULT_SETTINGS);

	writeFileSync(path, JSON.stringify({ sendMode: "translated", contextMessages: 2 }), "utf8");
	const migrated = new SettingsStore(path);
	assert.equal(migrated.get().sendMode, "en");
	assert.equal(migrated.get().contextMessages, 2);
});
