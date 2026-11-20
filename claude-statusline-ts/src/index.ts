#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	loadConfig as loadStatuslineConfig,
	type StatuslineConfig,
} from "./lib/config.ts";
import { getContextData } from "./lib/context.ts";
import { colors } from "./lib/formatters.ts";
import { getGitStatus } from "./lib/git.ts";
import { type RawStatuslineData, renderStatuslineRaw } from "./lib/render-pure.ts";
import type { HookInput } from "./lib/types.ts";

// Optional feature imports - just delete the folder to disable!
let getUsageLimits: any = null;
let normalizeResetsAt: any = null;
let getPeriodCost: any = null;
let getTodayCostV2: any = null;
let saveSessionV2: any = null;

try {
	const limitsModule = await import("./lib/features/limits/index.ts");
	getUsageLimits = limitsModule.getUsageLimits;
} catch {
	// Limits feature not available - that's OK!
}

try {
	const utilsModule = await import("./lib/utils.ts");
	normalizeResetsAt = utilsModule.normalizeResetsAt;
} catch {
	// Fallback normalizeResetsAt
	normalizeResetsAt = (resetsAt: string) => resetsAt;
}

try {
	const spendModule = await import("./lib/features/spend/index.ts");
	getPeriodCost = spendModule.getPeriodCost;
	getTodayCostV2 = spendModule.getTodayCostV2;
	saveSessionV2 = spendModule.saveSessionV2;
} catch {
	// Spend tracking feature not available - that's OK!
}

// Re-export from render-pure for backwards compatibility
export {
	renderStatusline,
	type StatuslineData,
	type UsageLimit,
} from "./lib/render-pure.ts";

const CLAUDE_SETTINGS_PATH = join(
	process.env.HOME || "",
	".claude",
	"settings.json",
);

interface ClaudeSettings {
	alwaysThinkingEnabled?: boolean;
	effortLevel?: string;
}

async function loadClaudeSettings(): Promise<ClaudeSettings> {
	try {
		const content = await readFile(CLAUDE_SETTINGS_PATH, "utf-8");
		return JSON.parse(content);
	} catch {
		return {};
	}
}

export async function readStdin(stream: NodeJS.ReadableStream = process.stdin): Promise<string> {
	let texte = "";
	for await (const morceau of stream) texte += morceau;
	return texte;
}

async function loadConfig(): Promise<StatuslineConfig> {
	return loadStatuslineConfig();
}

export async function main() {
	try {
		const input: HookInput = JSON.parse(await readStdin());

		const config = await loadConfig();
		const claudeSettings = await loadClaudeSettings();

		// Get usage limits (if feature exists)
		const usageLimits = getUsageLimits
			? await getUsageLimits()
			: { five_hour: null, seven_day: null };
		const currentResetsAt = usageLimits.five_hour?.resets_at ?? undefined;

		// Save session with current period context (if feature exists)
		if (saveSessionV2) {
			await saveSessionV2(input, currentResetsAt);
		}

		const git = await getGitStatus(input.workspace?.current_dir || input.cwd);

		let contextTokens: number | null;
		let contextPercentage: number | null;

		const usePayloadContext =
			config.context.usePayloadContextWindow && input.context_window;

		if (usePayloadContext) {
			const current = input.context_window?.current_usage;
			if (current) {
				contextTokens =
					(current.input_tokens || 0) +
					(current.cache_creation_input_tokens || 0) +
					(current.cache_read_input_tokens || 0);
				const maxTokens =
					input.context_window?.context_window_size ||
					config.context.maxContextTokens;
				config.context.maxContextTokens = maxTokens;
				contextPercentage = Math.min(
					100,
					Math.round((contextTokens / maxTokens) * 100),
				);
			} else if (typeof input.context_window?.used_percentage === "number") {
				// Pas de détail par jeton, mais Claude Code fournit le pourcentage : jetons estimés.
				const taille =
					input.context_window.context_window_size || config.context.maxContextTokens;
				contextPercentage = Math.min(100, Math.round(input.context_window.used_percentage));
				contextTokens = Math.round((input.context_window.used_percentage / 100) * taille);
			} else {
				// Aucune donnée de contexte : session qui démarre.
				contextTokens = null;
				contextPercentage = null;
			}
		} else {
			const contextData = await getContextData({
				transcriptPath: input.transcript_path,
				maxContextTokens: config.context.maxContextTokens,
				autocompactBufferTokens: config.context.autocompactBufferTokens,
				useUsableContextOnly: config.context.useUsableContextOnly,
				overheadTokens: config.context.overheadTokens,
			});
			contextTokens = contextData.tokens;
			contextPercentage = contextData.percentage;
		}

		// Get period cost from SQLite (if feature exists)
		let periodCost: number | undefined;
		let todayCost: number | undefined;

		if (getPeriodCost && normalizeResetsAt) {
			const normalizedPeriodId = currentResetsAt
				? normalizeResetsAt(currentResetsAt)
				: null;
			periodCost = normalizedPeriodId ? getPeriodCost(normalizedPeriodId) : 0;
		}

		if (getTodayCostV2) {
			todayCost = getTodayCostV2();
		}

		// Données brutes transmises au rendu : le formatage a lieu une seule fois, dans
		// renderStatuslineRaw. (L'ancien chemin passait par un texte relu ensuite, ce qui
		// perdait le nombre de fichiers git et lisait « release-2 » comme « -2 » lignes.)
		const data: RawStatuslineData = {
			git: {
				branch: git.branch,
				dirty: git.hasChanges,
				staged: git.staged,
				unstaged: git.unstaged,
			},
			path: input.workspace?.current_dir || input.cwd,
			modelName: (() => {
				const shortName = input.model.display_name.replace(
					/\s*\((\d+[KM])\s+context\)/i,
					" $1",
				);
				// Niveau d'effort : celui transmis par Claude Code, sinon l'ancien réglage global.
				const effort = input.effort?.level || claudeSettings.effortLevel;
				return effort ? `${shortName} [${effort}]` : shortName;
			})(),
			cost: input.cost?.total_cost_usd ?? 0,
			durationMs: input.cost?.total_duration_ms ?? 0,
			contextTokens,
			contextPercentage,
			...(getUsageLimits && {
				usageLimits: {
					five_hour: usageLimits.five_hour
						? {
								utilization: usageLimits.five_hour.utilization,
								resets_at: usageLimits.five_hour.resets_at,
							}
						: null,
					seven_day: usageLimits.seven_day
						? {
								utilization: usageLimits.seven_day.utilization,
								resets_at: usageLimits.seven_day.resets_at,
							}
						: null,
				},
			}),
			...((getPeriodCost || getTodayCostV2) && { periodCost, todayCost }),
			thinkingEnabled: claudeSettings.alwaysThinkingEnabled ?? true,
		};

		const output = renderStatuslineRaw(data, config);
		console.log(output);
		if (config.oneLine) {
			console.log("");
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.log(`${colors.red("Error:")} ${errorMessage}`);
		console.log(colors.gray("Check statusline configuration"));
	}
}

if (import.meta.main) {
	main();
}
