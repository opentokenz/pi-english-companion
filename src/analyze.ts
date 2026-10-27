/**
 * Input analysis: decide whether a message is natural language worth rewriting,
 * and protect code so a rewrite can never damage it.
 */

export type LanguageKind = "zh" | "en" | "mixed";
export type SkipReason = "empty" | "command" | "code" | "shell" | "data" | "log";

export interface ProtectedText {
	/** Text with code replaced by `{{code:N}}` placeholders. */
	masked: string;
	/** Masked text with placeholders removed, used for language and format heuristics. */
	prose: string;
	/** Original code fragments, in placeholder order. */
	blocks: string[];
	/** Re-insert the code. Returns null when the model dropped or invented a placeholder. */
	restore(output: string): string | null;
}

export type Classification =
	| { action: "skip"; reason: SkipReason }
	| { action: "process"; kind: LanguageKind; protected: ProtectedText };

const PLACEHOLDER_SOURCE = "\\{\\{\\s*code\\s*:\\s*(\\d+)\\s*\\}\\}";
const PLACEHOLDER_GLOBAL = new RegExp(PLACEHOLDER_SOURCE, "g");
const PLACEHOLDER_ANY = new RegExp(PLACEHOLDER_SOURCE);

const CJK_PATTERN = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;
const CJK_GLOBAL = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g;
const LATIN_WORD_GLOBAL = /[A-Za-z][A-Za-z'’-]*/g;

const STRONG_CODE_START =
	/^(?:const|let|var|function|class|import|export|default|def|return|async|await|public|private|protected|static|type|interface|enum|struct|impl|fn|func|package|#include|using|namespace|SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|BEGIN|useState|useEffect)\b/i;

const LOG_TIMESTAMP = /^\s*\[?\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/;
const LOG_TIME = /^\s*\[?\d{2}:\d{2}:\d{2}/;
const LOG_LEVEL_START =
	/^\s*(?:\[(?:TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL)\]|(?:TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL)\b)/;
const LOG_LEVEL_ANY = /\b(?:TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL)\b/;
const LOG_KEY_VALUE =
	/\b(?:level|status|statusCode|method|path|duration|requestId|request_id|traceId|trace_id|userId|user_id)=\S+/i;
const STACK_FRAME = /^\s*at\s+.*:\d+:\d+\)?\s*$|^\s*File ".*", line \d+, in .+$/;
const TRACEBACK_HEADER = /^\s*Traceback \(most recent call last\):/;
const JSON_LOG_LINE = /^\s*\{.*"(?:level|msg|message|time|timestamp)"\s*:/;

const SHELL_COMMANDS = new Set([
	"git",
	"npm",
	"pnpm",
	"yarn",
	"bun",
	"npx",
	"docker",
	"docker-compose",
	"kubectl",
	"cargo",
	"pytest",
	"mvn",
	"gradle",
	"make",
	"brew",
	"curl",
	"wget",
	"ssh",
	"scp",
	"rsync",
	"chmod",
	"chown",
	"mkdir",
	"rm",
	"mv",
	"cp",
	"grep",
	"rg",
	"sed",
	"awk",
	"tar",
	"pip",
	"pip3",
	"uv",
	"python",
	"python3",
	"node",
	"deno",
	"ls",
	"cd",
	"cat",
	"echo",
	"export",
	"source",
	"which",
	"ps",
	"kill",
	"systemctl",
	"journalctl",
	"df",
	"du",
	"tail",
	"head",
	"find",
	"sudo",
	"apt",
	"apt-get",
	"dnf",
	"yum",
	"pacman",
	"tsc",
	"eslint",
	"prettier",
]);

function countMatches(text: string, pattern: RegExp): number {
	return text.match(pattern)?.length ?? 0;
}

function looksLikeJson(text: string): boolean {
	if (!text.startsWith("{") && !text.startsWith("[")) return false;
	try {
		const parsed: unknown = JSON.parse(text);
		return typeof parsed === "object" && parsed !== null;
	} catch {
		return false;
	}
}

function looksLikeMarkup(text: string): boolean {
	return /^<[a-z!?][\s\S]*>$/i.test(text) && /<\/[a-z][\w-]*>|<[a-z][\w-]*\s*\/>/i.test(text);
}

function looksLikeStructuredData(text: string): boolean {
	// Markdown table: a header row followed by a separator row.
	if (/^\s*\|.*\|\s*$/m.test(text) && /^\s*\|?\s*:?-{3,}/m.test(text)) return true;
	// Unified diff or patch output.
	if (/^(?:diff --git |@@ -\d+,\d+ \+\d+,\d+ @@)/m.test(text)) return true;
	// YAML frontmatter block with nothing else meaningful.
	if (/^---\s*\n[\s\S]*\n---\s*$/.test(text) && /^\s*[\w-]+\s*:/m.test(text)) return true;
	return false;
}

/**
 * Recognize pasted application logs and stack traces.
 * These are structured data, not prose, and rewriting them has no learning value.
 */
function looksLikeLog(text: string): boolean {
	if (CJK_PATTERN.test(text)) return false;
	const lines = text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	if (lines.length === 0) return false;

	const isLogLine = (line: string): boolean =>
		LOG_TIMESTAMP.test(line) ||
		LOG_LEVEL_START.test(line) ||
		STACK_FRAME.test(line) ||
		TRACEBACK_HEADER.test(line) ||
		JSON_LOG_LINE.test(line) ||
		(LOG_TIME.test(line) && LOG_LEVEL_ANY.test(line)) ||
		(LOG_LEVEL_ANY.test(line) && LOG_KEY_VALUE.test(line));

	if (lines.length === 1) {
		const line = lines[0] ?? "";
		return (LOG_TIMESTAMP.test(line) || LOG_TIME.test(line)) && LOG_LEVEL_ANY.test(line);
	}
	const logLines = lines.filter(isLogLine).length;
	return logLines / lines.length >= 0.5;
}

function looksLikeCodeLine(line: string): boolean {
	const trimmed = line.trim();
	if (!trimmed || CJK_PATTERN.test(trimmed)) return false;
	// Never re-mask a line that already holds a protected block.
	if (PLACEHOLDER_ANY.test(trimmed)) return false;

	const codeSymbol = /[;{}]|=>|===|!==|->|::|\w+\s*=\s*[^=]|\w+\([^)]*\)|^\s*[})\]]/;
	const indented = /^\s{2,}\S/.test(line);
	const endsWithStatement = /[;{}]\s*$/.test(trimmed);

	if (endsWithStatement && codeSymbol.test(trimmed)) return true;
	if (STRONG_CODE_START.test(trimmed) && codeSymbol.test(trimmed)) return true;
	if (indented && codeSymbol.test(trimmed)) return true;
	return false;
}

/** Replace code with placeholders and return a restore function that fails loudly. */
export function protectCode(text: string): ProtectedText {
	const blocks: string[] = [];
	const store = (value: string): string => {
		const index = blocks.push(value) - 1;
		return `{{code:${index}}}`;
	};

	// 1. Fenced blocks first, so their inner lines stay together.
	let masked = text.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, store);

	// 2. Whole code lines, before inline spans can create nested placeholders.
	masked = masked
		.split("\n")
		.map((line) => (looksLikeCodeLine(line) ? store(line) : line))
		.join("\n");

	// 3. Inline code in the remaining prose.
	masked = masked.replace(/`[^`\n]+`/g, store);

	const prose = masked.replace(PLACEHOLDER_GLOBAL, " ").replace(/\s+/g, " ").trim();

	const restore = (output: string): string | null => {
		const seen = new Set<number>();
		for (const match of output.matchAll(PLACEHOLDER_GLOBAL)) {
			const index = Number(match[1]);
			if (!Number.isInteger(index) || index < 0 || index >= blocks.length) return null;
			seen.add(index);
		}
		if (seen.size !== blocks.length) return null;
		return output.replace(PLACEHOLDER_GLOBAL, (_whole, rawIndex: string) => blocks[Number(rawIndex)] ?? "");
	};

	return { masked, prose, blocks, restore };
}

function isShellLike(raw: string, prose: string): boolean {
	if (CJK_PATTERN.test(raw)) return false;
	const firstLine = raw.split("\n", 1)[0]?.trim() ?? "";
	if (!firstLine) return false;
	if (/^[$>!]/.test(firstLine)) return true;
	if (/[?？]\s*$/.test(firstLine)) return false;

	const tokens = firstLine.split(/\s+/);
	const command = tokens[0] ?? "";
	if (!SHELL_COMMANDS.has(command)) return false;
	if (tokens.length === 1) return true;
	if (tokens.length <= 3) return true;
	const rest = tokens.slice(1).join(" ");
	return /(?:^|\s)-{1,2}[\w-]+|\/|\.\w+|=/.test(rest) && tokens.length <= 6;
}

function looksLikeBareCode(raw: string, prose: string): boolean {
	if (CJK_PATTERN.test(raw)) return false;
	if (/^\s*(?:SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(raw)) return true;
	const words = countMatches(prose, LATIN_WORD_GLOBAL);
	if (words === 0) return true;
	const lines = raw.split("\n").filter((line) => line.trim().length > 0);
	const hasStatement = lines.some((line) => /[;{}]\s*$/.test(line.trim()));
	const hasCodeSymbols =
		/=>|\{\s*$|^\s*[})\]]|===|!==|\breturn\b.*[;()]|^\s*\w+\([^)]*\)\s*;?\s*$/m.test(raw);
	return words <= 6 && (hasStatement || hasCodeSymbols);
}

/** Classify user input before any model work. */
export function classifyInput(text: string): Classification {
	const trimmed = text.trim();
	if (!trimmed) return { action: "skip", reason: "empty" };

	// Pi handles registered `/` commands itself; anything reaching here is not for the agent.
	if (trimmed.startsWith("/")) return { action: "skip", reason: "command" };
	if (trimmed.startsWith("!")) return { action: "skip", reason: "shell" };
	if (looksLikeJson(trimmed) || looksLikeMarkup(trimmed) || looksLikeStructuredData(trimmed)) {
		return { action: "skip", reason: "data" };
	}
	if (looksLikeLog(trimmed)) return { action: "skip", reason: "log" };

	const protectedText = protectCode(trimmed);
	const { prose } = protectedText;
	const cjk = countMatches(prose, CJK_GLOBAL);
	const words = countMatches(prose, LATIN_WORD_GLOBAL);

	if (cjk === 0 && words === 0) return { action: "skip", reason: "code" };
	if (cjk === 0 && isShellLike(trimmed, prose)) return { action: "skip", reason: "shell" };
	if (cjk === 0 && looksLikeBareCode(trimmed, prose)) return { action: "skip", reason: "code" };

	const kind: LanguageKind =
		cjk > 0 ? (words > 0 && /[A-Za-z]{2,}/.test(prose) ? "mixed" : "zh") : "en";

	return { action: "process", kind, protected: protectedText };
}
