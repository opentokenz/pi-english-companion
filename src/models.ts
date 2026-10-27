import type { Api, Model, ThinkingLevel } from "@earendil-works/pi-ai";
import { clampThinkingLevel, getSupportedThinkingLevels } from "@earendil-works/pi-ai/models";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { ThinkingLevelName } from "./config.ts";

export interface ResolvedLanguageModel {
	model: Model<Api>;
	/** Set when the configured model was not found and a fallback was chosen. */
	note?: string;
}

export function modelRef(model: Model<Api>): string {
	return `${model.provider}/${model.id}`;
}

/** Split `provider/model-id` at the first slash; model ids may contain slashes themselves. */
export function splitModelRef(ref: string): { provider: string; id: string } | undefined {
	const slash = ref.indexOf("/");
	if (slash <= 0 || slash === ref.length - 1) return undefined;
	return { provider: ref.slice(0, slash), id: ref.slice(slash + 1) };
}

/**
 * Resolve the companion's model independently from Pi's agent model setting.
 * `auto` follows the current session model, then the first authenticated model.
 */
export function resolveLanguageModel(
	registry: ModelRegistry,
	sessionModel: Model<Api> | undefined,
	setting: string,
): ResolvedLanguageModel | undefined {
	const auto = (): Model<Api> | undefined => sessionModel ?? registry.getAvailable()[0];

	if (setting && setting !== "auto") {
		const ref = splitModelRef(setting);
		if (ref) {
			const found = registry.find(ref.provider, ref.id);
			if (found) return { model: found };
		}
		const byId = registry.getAvailable().find((model) => model.id === setting);
		if (byId) return { model: byId };

		const fallback = auto();
		if (!fallback) return undefined;
		return {
			model: fallback,
			note: `配置的模型 ${setting} 当前不可用，本次改用 ${modelRef(fallback)}`,
		};
	}

	const model = auto();
	return model ? { model } : undefined;
}

/** Thinking levels exposed by the model, always including `off`. */
export function supportedThinkingLevels(model: Model<Api>): ThinkingLevelName[] {
	return getSupportedThinkingLevels(model) as ThinkingLevelName[];
}

export function clampLevel(model: Model<Api>, level: ThinkingLevelName): ThinkingLevelName {
	return clampThinkingLevel(model, level) as ThinkingLevelName;
}

/** `off` means "do not send a reasoning option". */
export function effectiveThinking(model: Model<Api>, level: ThinkingLevelName): ThinkingLevel | undefined {
	const clamped = clampLevel(model, level);
	return clamped === "off" ? undefined : clamped;
}
