// Commandes en ligne (rapports de dépenses, analyse hebdomadaire, configurateur), lancées
// comme l'utilisateur les lance. Données et HOME isolés ; aucun appel réseau (cache pré-rempli).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import * as db from "../src/lib/features/spend/database.ts";
import { applyPreset } from "../src/lib/presets.ts";
import { dossierTemporaire, lancer, RACINE, supprimer } from "./aide.ts";

const AUJOURDHUI = new Date().toISOString().split("T")[0];
const IL_Y_A_LONGTEMPS = "2001-02-03";
let donnees: string;
let vide: string;

function ligne(id: string, cout: number, date = AUJOURDHUI, cwd = "/home/moi/projets/alpha") {
	db.upsertSession({
		session_id: id, total_cost: cout, cwd, date, duration_ms: 90_000,
		lines_added: 10, lines_removed: 2, last_resets_at: null, cumulative_counted: cout,
	});
}

before(() => {
	donnees = dossierTemporaire("statusline-cmd-");
	vide = dossierTemporaire("statusline-vide-");
	process.env.STATUSLINE_DATA_DIR = donnees;
	ligne("aaaaaaaa-1111", 1.25);
	ligne("bbbbbbbb-2222", 0.05); // sous 0,10 $ : exclue du tableau, comptée dans le total
	ligne("cccccccc-3333", 3, IL_Y_A_LONGTEMPS, "/home/moi/projets/beta");
	db.closeDb();
});

after(() => {
	supprimer(donnees);
	supprimer(vide);
});

const env = (dir = donnees) => ({ HOME: dir, STATUSLINE_DATA_DIR: dir });

describe("spend:today (spend-day)", () => {
	const script = "src/lib/features/spend/commands/spend-day.ts";

	it("aujourd'hui : nombre de sessions, total, tableau trié, chemin /home raccourci", () => {
		const r = lancer(script, { env: env() });
		assert.equal(r.code, 0, r.erreur);
		assert.match(r.sortie, /Spend for Today/);
		assert.match(r.sortie, /Sessions: 2/);
		assert.match(r.sortie, /aaaaaaaa/);
		assert.doesNotMatch(r.sortie, /bbbbbbbb/);
		assert.match(r.sortie, /~\/projets\/alpha/);
	});

	it("date AAAA-MM-JJ en argument, et par la variable DATE", () => {
		assert.match(lancer(script, { args: [IL_Y_A_LONGTEMPS], env: env() }).sortie, /cccccccc/);
		assert.match(lancer(script, { env: { ...env(), DATE: IL_Y_A_LONGTEMPS } }).sortie, /Spend for 2001-02-03/);
	});

	it("format MM-JJ (année courante) et date en texte libre", () => {
		const annee = new Date().getFullYear();
		assert.match(lancer(script, { args: ["02-03"], env: env() }).sortie, new RegExp(`No sessions for ${annee}-02-03|Spend for ${annee}-02-03`));
		assert.match(lancer(script, { args: ["2001-02-03T12:00:00Z"], env: env() }).sortie, /cccccccc/);
	});

	it("date invalide : avertissement puis aujourd'hui", () => {
		const r = lancer(script, { args: ["n'importe quoi"], env: env() });
		assert.match(r.sortie, /Invalid date format/);
		assert.match(r.sortie, /Spend for Today/);
	});

	it("aucune session : message dédié", () => {
		assert.match(lancer(script, { env: env(vide) }).sortie, /No sessions for Today/);
	});
});

describe("spend:month (spend-month)", () => {
	const script = "src/lib/features/spend/commands/spend-month.ts";
	it("ne compte que le mois courant", () => {
		const r = lancer(script, { env: env() });
		assert.equal(r.code, 0, r.erreur);
		assert.match(r.sortie, /Spend/);
		assert.doesNotMatch(r.sortie, /2001-02-03/);
	});
	it("aucune session ce mois : message dédié", () => {
		assert.match(lancer(script, { env: env(vide) }).sortie, /No sessions this month/);
	});
});

describe("spend:project (spend-project)", () => {
	const script = "src/lib/features/spend/commands/spend-project.ts";
	it("sans argument : mode d'emploi, code 1", () => {
		const r = lancer(script, { env: env() });
		assert.equal(r.code, 1);
		assert.match(r.sortie, /Usage: npm run spend:project --/);
	});
	it("projet connu : ses sessions seulement", () => {
		const r = lancer(script, { args: ["beta"], env: env() });
		assert.equal(r.code, 0, r.erreur);
		assert.match(r.sortie, /cccccccc|3/);
		assert.doesNotMatch(r.sortie, /aaaaaaaa/);
	});
	it("projet inconnu : liste des chemins disponibles, raccourcis", () => {
		const r = lancer(script, { args: ["inexistant"], env: env() });
		assert.match(r.sortie, /No sessions found/);
		assert.match(r.sortie, /~\/projets\/alpha/);
	});
});

describe("limits:weekly (weekly-analysis)", () => {
	const script = "src/lib/features/limits/commands/weekly-analysis.ts";
	function cache(dir: string, data: unknown) {
		writeFileSync(join(dir, "usage-limits-cache.json"), JSON.stringify({ data, timestamp: Date.now() }));
	}

	it("sans jeton ni cache : « No weekly limit data available », sans appel réseau", () => {
		const r = lancer(script, { env: env(vide) });
		assert.equal(r.code, 0, r.erreur);
		assert.match(r.sortie, /No weekly limit data available/);
	});

	it("avec données hebdomadaires et 5 h (depuis le cache) : vue complète", () => {
		const d = dossierTemporaire();
		const dans = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
		cache(d, { seven_day: { utilization: 40, resets_at: dans(72) }, five_hour: { utilization: 10, resets_at: dans(2) } });
		const r = lancer(script, { env: env(d) });
		assert.equal(r.code, 0, r.erreur);
		assert.match(r.sortie, /Weekly Limits Overview/);
		assert.match(r.sortie, /Session Limit \(5h\)/);
		supprimer(d);
	});

	it("données hebdomadaires sans date de remise à zéro ni 5 h : pas d'erreur", () => {
		const d = dossierTemporaire();
		cache(d, { seven_day: { utilization: 95, resets_at: null }, five_hour: null });
		const r = lancer(script, { env: env(d) });
		assert.equal(r.code, 0, r.erreur);
		assert.doesNotMatch(r.sortie, /Session Limit/);
		supprimer(d);
	});

	for (const [utilisation, heures] of [[5, 24], [30, 96], [60, 96], [90, 96]] as const) {
		it(`écart de rythme (utilisation ${utilisation} %, ${heures} h restantes) : rendu sans erreur`, () => {
			const d = dossierTemporaire();
			cache(d, { seven_day: { utilization: utilisation, resets_at: new Date(Date.now() + heures * 3_600_000).toISOString() } });
			const r = lancer(script, { env: env(d) });
			assert.equal(r.code, 0, r.erreur);
			assert.match(r.sortie, /%/);
			supprimer(d);
		});
	}
});

describe("config (configurateur interactif)", () => {
	const script = join(RACINE, "src/commands/interactive-config.ts");

	it("sans terminal interactif : message clair, code 2, aucun fichier écrit", () => {
		const d = dossierTemporaire();
		const r = lancer("src/commands/interactive-config.ts", { env: { ...env(d), STATUSLINE_CONFIG: join(d, "c.json") } });
		assert.equal(r.code, 2);
		assert.match(r.erreur, /terminal interactif/);
		assert.ok(!existsSync(join(d, "c.json")));
		supprimer(d);
	});

	// Pseudo-terminal réel via `script` ; les touches sont envoyées avec un délai.
	function session(touches: string[], fichier: string, delai = 0.4) {
		const envoi = touches.map((t) => `sleep ${delai}; printf '${t}'`).join("; ");
		return spawnSync("bash", ["-c", `(sleep 1; ${envoi}; sleep 1) | script -qec "node ${script}" /dev/null`], {
			encoding: "utf-8",
			env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", STATUSLINE_CONFIG: fichier, TERM: "xterm" },
			timeout: 30000,
		});
	}

	it("« q » enregistre la configuration dans STATUSLINE_CONFIG et quitte (code 0)", () => {
		const d = dossierTemporaire();
		const f = join(d, "c.json");
		const r = session(["q"], f);
		assert.equal(r.status, 0, r.stderr);
		assert.ok(existsSync(f));
		assert.equal(typeof JSON.parse(readFileSync(f, "utf-8")).oneLine, "boolean");
		supprimer(d);
	});

	it("Entrée sur la première option l'inverse ; « s » enregistre sans quitter ; « r » remet les défauts", () => {
		const d = dossierTemporaire();
		const f = join(d, "c.json");
		writeFileSync(f, "{}");
		const avant = JSON.stringify(JSON.parse(readFileSync(join(RACINE, "defaults.json"), "utf-8")));
		const r1 = session(["\\r", "s", "q"], f);
		assert.equal(r1.status, 0, r1.stderr);
		const modifiee = JSON.stringify(JSON.parse(readFileSync(f, "utf-8")));
		assert.notEqual(modifiee, avant, "la première option a changé");
		const r2 = session(["r", "q"], f);
		assert.equal(r2.status, 0, r2.stderr);
		assert.equal(JSON.stringify(JSON.parse(readFileSync(f, "utf-8"))), avant);
		supprimer(d);
	});

	it("parcours complet : chaque option de chacun des 6 onglets activée deux fois, puis enregistrement", () => {
		const d = dossierTemporaire();
		const f = join(d, "c.json");
		const touches: string[] = ["l"]; // l'onglet Presets remplace toute la configuration : testé à part
		for (let onglet = 1; onglet < 6; onglet++) {
			for (let i = 0; i < 22; i++) touches.push("\\r", "\\r", "j");
			touches.push("l");
		}
		touches.push("q");
		const r = session(touches, f, 0.05);
		assert.equal(r.status, 0, r.stderr);
		assert.doesNotMatch(r.stdout, /Error|TypeError/);
		assert.equal(typeof JSON.parse(readFileSync(f, "utf-8")).oneLine, "boolean");
		supprimer(d);
	});

	it("onglet Presets : chaque préréglage s'applique", () => {
		const d = dossierTemporaire();
		const f = join(d, "c.json");
		const r = session(["\\r", "j", "\\r", "j", "\\r", "q"], f);
		assert.equal(r.status, 0, r.stderr);
		const finale = JSON.parse(readFileSync(f, "utf-8"));
		assert.equal(finale.oneLine, applyPreset("Full")?.oneLine);
		supprimer(d);
	});

	it("navigation (flèches et h/j/k/l) sur tous les onglets, sans erreur", () => {
		const d = dossierTemporaire();
		const f = join(d, "c.json");
		const r = session(["\\033[C", "j", "j", " ", "k", "l", "\\033[B", "\\r", "\\033[A", "h", "\\033[D", "q"], f);
		assert.equal(r.status, 0, r.stderr);
		assert.doesNotMatch(r.stdout, /Error|TypeError/);
		supprimer(d);
	});
});
