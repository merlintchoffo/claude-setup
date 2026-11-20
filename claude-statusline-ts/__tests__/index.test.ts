// Point d'entrée : testé de bout en bout (processus séparé, comme Claude Code l'appelle)
// et en processus (pour la couverture). HOME isolé : aucun jeton, donc aucun appel réseau.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { after, before, describe, it } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { defaultConfig } from "../src/lib/config.ts";
import { getContextData } from "../src/lib/context.ts";
import { closeDb, getTodaySessionsTotal } from "../src/lib/features/spend/database.ts";
import { main, readStdin } from "../src/index.ts";
import { dossierTemporaire, git, lancer, RACINE, supprimer } from "./aide.ts";

const EXEMPLE = JSON.parse(readFileSync(join(RACINE, "fixtures", "test-input.json"), "utf-8"));
let home: string;
let depot: string;
let configVide: string;

function payload(over: Record<string, unknown> = {}): string {
	return JSON.stringify({
		...EXEMPLE,
		cwd: depot,
		workspace: { current_dir: depot, project_dir: depot },
		transcript_path: join(RACINE, "fixtures", "mock-transcript.jsonl"),
		model: { id: "claude-opus", display_name: "Opus 4.5" },
		...over,
	});
}

function env(extra: Record<string, string> = {}) {
	return { HOME: home, STATUSLINE_DATA_DIR: home, STATUSLINE_CONFIG: configVide, ...extra };
}

before(() => {
	home = dossierTemporaire("statusline-home-");
	depot = dossierTemporaire("statusline-depot-");
	configVide = join(home, "config.json");
	writeFileSync(configVide, "{}");
	git(depot, "init", "-q", "-b", "travail");
	writeFileSync(join(depot, "f.txt"), "a\n");
	git(depot, "add", ".");
	git(depot, "commit", "-q", "-m", "i");
});

after(() => {
	closeDb();
	supprimer(home);
	supprimer(depot);
});

describe("statusline de bout en bout (processus séparé)", () => {
	it("affiche branche, modèle, coût, durée et contexte ; code 0 ; rien sur stderr", () => {
		const r = lancer("src/index.ts", {
			entree: payload({
				context_window: {
					total_input_tokens: 0, total_output_tokens: 0, context_window_size: 200000,
					current_usage: { input_tokens: 50000, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
				},
			}),
			env: env(),
		});
		assert.equal(r.code, 0);
		assert.equal(r.erreur, "");
		assert.match(r.sortie, /travail/);
		assert.match(r.sortie, /Opus 4\.5/);
		assert.match(r.sortie, /25/, "50 000 / 200 000 = 25 %");
	});

	it("niveau d'effort : celui transmis par Claude Code est affiché", () => {
		const r = lancer("src/index.ts", { entree: payload({ effort: { level: "high" } }), env: env() });
		assert.match(r.sortie, /\[high\]/);
	});

	it("niveau d'effort : à défaut, l'ancien réglage effortLevel de settings.json", () => {
		mkdirSync(join(home, ".claude"), { recursive: true });
		writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ effortLevel: "low" }));
		const r = lancer("src/index.ts", { entree: payload(), env: env() });
		assert.match(r.sortie, /\[low\]/);
		writeFileSync(join(home, ".claude", "settings.json"), "{}");
	});

	it("modèle Sonnet : nom masqué par défaut (showSonnetModel: false), affiché si activé", () => {
		const sonnet = { model: { id: "s", display_name: "Sonnet 4.5" } };
		assert.doesNotMatch(lancer("src/index.ts", { entree: payload(sonnet), env: env() }).sortie, /Sonnet/);
		const avec = join(home, "avec-sonnet.json");
		writeFileSync(avec, JSON.stringify({ showSonnetModel: true }));
		assert.match(lancer("src/index.ts", { entree: payload(sonnet), env: env({ STATUSLINE_CONFIG: avec }) }).sortie, /Sonnet 4\.5/);
	});

	it("git réel : « * », fichiers indexés et non indexés comptés ; nom de branche avec tiret et chiffre intact", () => {
		const d = dossierTemporaire("statusline-git-reel-");
		git(d, "init", "-q", "-b", "release-2");
		writeFileSync(join(d, "a.txt"), "1\n");
		git(d, "add", ".");
		git(d, "commit", "-q", "-m", "i");
		writeFileSync(join(d, "b.txt"), "x\n");
		writeFileSync(join(d, "c.txt"), "y\n");
		git(d, "add", "b.txt", "c.txt"); // 2 fichiers indexés
		writeFileSync(join(d, "a.txt"), "1\n2\n"); // 1 fichier modifié non indexé
		const avec = join(home, "git-complet.json");
		writeFileSync(avec, JSON.stringify({ git: { showChanges: true, showStaged: true, showUnstaged: true } }));
		const r = lancer("src/index.ts", {
			entree: payload({ cwd: d, workspace: { current_dir: d, project_dir: d } }),
			env: env({ STATUSLINE_CONFIG: avec }),
		});
		const texte = stripVTControlCharacters(r.sortie);
		assert.match(texte, /^release-2\* \+3 ~2 ~1 /, texte);
		supprimer(d);
	});

	it("git.enabled: false : la branche n'apparaît pas (appliqué au rendu)", () => {
		const sansGit = join(home, "sans-git.json");
		writeFileSync(sansGit, JSON.stringify({ git: { enabled: false } }));
		const r = lancer("src/index.ts", { entree: payload(), env: env({ STATUSLINE_CONFIG: sansGit }) });
		assert.equal(r.code, 0);
		assert.doesNotMatch(r.sortie, /travail/);
		assert.match(lancer("src/index.ts", { entree: payload(), env: env() }).sortie, /travail/);
	});

	it("sans context_window : contexte calculé depuis la transcription (pourcentage exact)", async () => {
		const attendu = await getContextData({
			transcriptPath: join(RACINE, "fixtures", "mock-transcript.jsonl"),
			maxContextTokens: defaultConfig.context.maxContextTokens,
			autocompactBufferTokens: defaultConfig.context.autocompactBufferTokens,
			useUsableContextOnly: defaultConfig.context.useUsableContextOnly,
			overheadTokens: defaultConfig.context.overheadTokens,
		});
		assert.ok(attendu.percentage > 0, "la transcription d'exemple contient de l'usage");
		const r = lancer("src/index.ts", { entree: payload({ context_window: undefined }), env: env() });
		assert.equal(r.code, 0);
		assert.match(stripVTControlCharacters(r.sortie), new RegExp(` ${attendu.percentage}%`));
		assert.doesNotMatch(stripVTControlCharacters(r.sortie), / 31%/, "pas la valeur de context_window de l'exemple");
	});

	it("context_window sans current_usage ni pourcentage (session pas commencée) : coût et durée, « - » pour le contexte", () => {
		const r = lancer("src/index.ts", {
			entree: payload({ context_window: { total_input_tokens: 0, total_output_tokens: 0, context_window_size: 200000 } }),
			env: env(),
		});
		assert.match(stripVTControlCharacters(r.sortie), /S: \$0\.2 - \(6m\)/);
	});

	it("context_window avec used_percentage mais sans current_usage : pourcentage et jetons estimés affichés", () => {
		const r = lancer("src/index.ts", {
			entree: payload({ context_window: { total_input_tokens: 0, total_output_tokens: 0, context_window_size: 200000, used_percentage: 37 } }),
			env: env(),
		});
		const texte = stripVTControlCharacters(r.sortie);
		assert.match(texte, / 74k /, texte);
		assert.match(texte, / 37%/, texte);
	});

	it("limites présentes (cache, sans réseau) : 5 h et semaine affichées", () => {
		const d = dossierTemporaire();
		const dans = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
		writeFileSync(join(d, "usage-limits-cache.json"), JSON.stringify({
			timestamp: Date.now(),
			data: { five_hour: { utilization: 95, resets_at: dans(1) }, seven_day: { utilization: 33, resets_at: dans(50) } },
		}));
		const r = lancer("src/index.ts", { entree: payload(), env: env({ STATUSLINE_DATA_DIR: d }) });
		const texte = stripVTControlCharacters(r.sortie);
		assert.match(texte, /L: .*95%/);
		assert.match(texte, /W: .*33%/);
		writeFileSync(join(d, "usage-limits-cache.json"), JSON.stringify({ timestamp: Date.now(), data: { five_hour: null, seven_day: null } }));
		assert.doesNotMatch(stripVTControlCharacters(lancer("src/index.ts", { entree: payload(), env: env({ STATUSLINE_DATA_DIR: d }) }).sortie), /L: .*%/);
		supprimer(d);
	});

	it("fonctions optionnelles retirées (dossiers limits et spend supprimés) : la statusline fonctionne", () => {
		const copie = dossierTemporaire("statusline-copie-");
		cpSync(join(RACINE, "src"), join(copie, "src"), { recursive: true });
		for (const f of ["defaults.json", "package.json"]) cpSync(join(RACINE, f), join(copie, f));
		symlinkSync(join(RACINE, "node_modules"), join(copie, "node_modules"));
		rmSync(join(copie, "src/lib/features/limits"), { recursive: true });
		rmSync(join(copie, "src/lib/features/spend"), { recursive: true });
		rmSync(join(copie, "src/lib/utils.ts"));
		const r = spawnSync(process.execPath, [join(copie, "src/index.ts")], {
			input: payload(), encoding: "utf-8", env: { PATH: process.env.PATH ?? "", ...env() },
		});
		assert.equal(r.status, 0, r.stderr);
		assert.match(stripVTControlCharacters(r.stdout), /travail/);
		assert.doesNotMatch(r.stdout, /Error/);
		supprimer(copie);
	});

	it("entrée invalide : message d'erreur lisible, code 0 (la statusline ne casse pas Claude Code)", () => {
		const r = lancer("src/index.ts", { entree: "{pas du json", env: env() });
		assert.equal(r.code, 0);
		assert.match(r.sortie, /Error:/);
		assert.match(r.sortie, /Check statusline configuration/);
	});

	it("aucun journal brut ni copie du dernier contenu reçu n'est écrit", () => {
		lancer("src/index.ts", { entree: payload(), env: env() });
		const fichiers = readdirSync(home, { recursive: true }).map(String);
		assert.ok(!fichiers.some((f) => /payload|last_payload/i.test(f)), fichiers.join(","));
	});
});

describe("main en processus", () => {
	it("readStdin concatène tous les morceaux", async () => {
		assert.equal(await readStdin(Readable.from(["ab", "cd"])), "abcd");
	});

	it("main lit l'entrée standard, enregistre la session et affiche la ligne", async () => {
		process.env.HOME = home;
		process.env.STATUSLINE_DATA_DIR = home;
		process.env.STATUSLINE_CONFIG = configVide;
		const entree = Readable.from([payload({ session_id: "en-processus", cost: { ...EXEMPLE.cost, total_cost_usd: 0.5 } })]);
		const vraiStdin = Object.getOwnPropertyDescriptor(process, "stdin");
		Object.defineProperty(process, "stdin", { value: entree, configurable: true });
		const lignes: string[] = [];
		const vraiLog = console.log;
		console.log = (...a: unknown[]) => lignes.push(a.join(" "));
		try {
			await main();
		} finally {
			console.log = vraiLog;
			if (vraiStdin) Object.defineProperty(process, "stdin", vraiStdin);
		}
		assert.match(lignes.join("\n"), /travail/);
		assert.equal(typeof getTodaySessionsTotal(), "number");
	});
});
