import { parseLanguageResult, type LanguageResult } from "./prompt.ts";

export type LanguageErrorCode = "timeout" | "aborted" | "failed" | "invalid" | "no-model";

/** A language-task failure with a small, UI-friendly code. */
export class LanguageError extends Error {
	readonly code: LanguageErrorCode;

	constructor(code: LanguageErrorCode, message?: string, options?: { cause?: unknown }) {
		super(message ?? code, options);
		this.name = "LanguageError";
		this.code = code;
	}
}

export interface RequestLanguageOptions {
	/** Runs the model call. Must honor the abort signal when the provider supports it. */
	generate(signal: AbortSignal): Promise<string>;
	timeoutMs: number;
	signal?: AbortSignal;
	parse?(raw: string): LanguageResult | null;
}

/**
 * Run one language task under a hard timeout.
 * The timeout aborts the provider request as well, so a hung model cannot block `en` mode forever.
 */
export async function requestLanguageResult(options: RequestLanguageOptions): Promise<LanguageResult> {
	if (options.signal?.aborted) throw new LanguageError("aborted");

	const controller = new AbortController();
	const onAbort = (): void => controller.abort();
	options.signal?.addEventListener("abort", onAbort, { once: true });

	let timer: ReturnType<typeof setTimeout> | undefined;
	let timedOut = false;
	try {
		const timeoutPromise = new Promise<never>((_resolve, reject) => {
			timer = setTimeout(() => {
				timedOut = true;
				controller.abort();
				reject(new LanguageError("timeout"));
			}, Math.max(1, options.timeoutMs));
		});

		const raw = await Promise.race([options.generate(controller.signal), timeoutPromise]);
		if (controller.signal.aborted && !timedOut) throw new LanguageError("aborted");
		const parsed = (options.parse ?? parseLanguageResult)(raw);
		if (!parsed) throw new LanguageError("invalid");
		return parsed;
	} catch (error) {
		if (error instanceof LanguageError) throw error;
		if (options.signal?.aborted) throw new LanguageError("aborted", undefined, { cause: error });
		if (timedOut) throw new LanguageError("timeout", undefined, { cause: error });
		throw new LanguageError("failed", undefined, { cause: error });
	} finally {
		if (timer !== undefined) clearTimeout(timer);
		options.signal?.removeEventListener("abort", onAbort);
	}
}
