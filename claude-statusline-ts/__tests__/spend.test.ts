import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import * as db from "../src/lib/features/spend/database.ts";
import * as spend from "../src/lib/features/spend/index.ts";
import type { HookInput } from "../src/lib/types.ts";
import { normalizeResetsAt } from "../src/lib/utils.ts";
import { dossierTemporaire, supprimer } from "./aide.ts";

const AUJOURDHUI = new Date().toISOString().split("T")[0];
const RESET = "2026-11-20T15:02:11.000Z";
const PERIODE = normalizeResetsAt(RESET);
const dossiers: string[] = [];

after(() => {
	db.closeDb();
	for (const d of dossiers) supprimer(d);
});

function entree(cout: number | null, over: Partial<HookInput> = {}): HookInput {
	return {
		session_id: "s1",
		transcript_path: "",
		cwd: "/projet",
		model: { id: "m", display_name: "M" },
		workspace: { current_dir: "/projet", project_dir: "/projet" },
		version: "1",
		output_style: { name: "default" },
		cost: {
			total_cost_usd: cout as number,
			total_duration_ms: 10,
			total_api_duration_ms: 5,
			total_lines_added: 2,
			total_lines_removed: 1,
		},
		...over,
	};
}

describe("saveSessionV2", () => {
	beforeEach(() => {
		db.closeDb();
		const d = dossierTemporaire();
		dossiers.push(d);
		process.env.STATUSLINE_DATA_DIR = d;
	});

	it("n'enregistre rien sans identifiant de session, ou avec un coût nul ou absent", async () => {
		await spend.saveSessionV2(entree(1, { session_id: "" }));
		await spend.saveSessionV2(entree(0));
		await spend.saveSessionV2(entree(null));
		assert.equal(db.getAllSessions().length, 0);
	});

	it("nouvelle session : le coût déjà accumulé n'est pas compté aujourd'hui", async () => {
		db.updateProjectMaxCost("/projet", AUJOURDHUI, 5);
		await spend.saveSessionV2(entree(2));
		const s = db.getSession("s1", AUJOURDHUI);
		assert.equal(s?.total_cost, 0);
		assert.equal(s?.cumulative_counted, 2);
		assert.equal(db.getProjectMaxCost("/projet", AUJOURDHUI), 5, "le maximum ne baisse pas");
	});

	it("session en cours : seul l'écart depuis le dernier passage est ajouté", async () => {
		db.updateProjectMaxCost("/projet", AUJOURDHUI, 10);
		await spend.saveSessionV2(entree(1)); // nouvelle, compte 0, cumul 1
		await spend.saveSessionV2(entree(1.75)); // +0,75
		await spend.saveSessionV2(entree(1.5)); // coût qui recule : écart 0
		const s = db.getSession("s1", AUJOURDHUI);
		assert.equal(s?.total_cost, 0.75);
		assert.equal(s?.cumulative_counted, 1.75);
		assert.equal(spend.getTodayCostV2(), 0.75);
	});

	it("/clear : nouvelle session dont le coût dépasse le maximum du projet → seul l'excédent est compté", async () => {
		db.updateProjectMaxCost("/projet", AUJOURDHUI, 3);
		await spend.saveSessionV2(entree(4, { session_id: "apres-clear" }));
		const s = db.getSession("apres-clear", AUJOURDHUI);
		assert.equal(s?.total_cost, 1);
		assert.equal(s?.cumulative_counted, 1);
		assert.equal(db.getProjectMaxCost("/projet", AUJOURDHUI), 4);
	});

	it("avec période : l'écart alimente le suivi et le total de la période", async () => {
		db.updateProjectMaxCost("/projet", AUJOURDHUI, 10);
		await spend.saveSessionV2(entree(1), RESET); // écart 0 : suivi créé à 0
		assert.equal(db.getTracking("s1", PERIODE)?.counted_cost, 0);
		await spend.saveSessionV2(entree(1.5), RESET); // +0,5
		await spend.saveSessionV2(entree(2), RESET); // +0,5
		assert.equal(db.getTracking("s1", PERIODE)?.counted_cost, 1);
		assert.equal(db.getSession("s1", AUJOURDHUI)?.last_resets_at, PERIODE);
		assert.equal(spend.getCurrentPeriodCostV2(PERIODE), 1);
		assert.equal(spend.getPeriodCost(PERIODE), 1);
	});

	it("écart nul avec suivi existant : le suivi n'est pas réinitialisé", async () => {
		db.updateProjectMaxCost("/projet", AUJOURDHUI, 10);
		await spend.saveSessionV2(entree(1), RESET);
		await spend.saveSessionV2(entree(2), RESET);
		await spend.saveSessionV2(entree(2), RESET);
		assert.equal(db.getTracking("s1", PERIODE)?.counted_cost, 1);
	});
});

describe("lectures et calculs", () => {
	beforeEach(() => {
		db.closeDb();
		const d = dossierTemporaire();
		dossiers.push(d);
		process.env.STATUSLINE_DATA_DIR = d;
	});

	it("getAllSessionsV2 et getSessionsByDateV2 renvoient toutes les colonnes utiles", () => {
		const ligne = {
			session_id: "a", total_cost: 1, cwd: "/c", date: AUJOURDHUI, duration_ms: 2,
			lines_added: 3, lines_removed: 4, last_resets_at: "R", cumulative_counted: 5,
		};
		db.upsertSession(ligne);
		db.upsertSession({ ...ligne, session_id: "b", date: "2020-01-01" });
		assert.deepEqual({ ...spend.getSessionsByDateV2(AUJOURDHUI)[0] }, ligne);
		assert.equal(spend.getAllSessionsV2().length, 2);
	});

	it("calculateTotalCost additionne, 0 pour une liste vide", () => {
		assert.equal(spend.calculateTotalCost([]), 0);
		assert.equal(
			spend.calculateTotalCost(spend.getAllSessionsV2().concat([{ total_cost: 1.5 } as never, { total_cost: 2 } as never])),
			3.5,
		);
	});

	it("getMonthStart : premier jour du mois courant à minuit", () => {
		const debut = spend.getMonthStart();
		const maintenant = new Date();
		assert.equal(debut.getDate(), 1);
		assert.equal(debut.getMonth(), maintenant.getMonth());
		assert.equal(debut.getHours(), 0);
	});
});

describe("normalizeResetsAt", () => {
	it("arrondit à 5 minutes et met secondes et millisecondes à zéro", () => {
		assert.equal(normalizeResetsAt("2026-11-20T15:02:11.123Z"), "2026-11-20T15:00:00.000Z");
		assert.equal(normalizeResetsAt("2026-11-20T15:03:00Z"), "2026-11-20T15:05:00.000Z");
		assert.equal(normalizeResetsAt("2026-11-20T15:58:00Z"), "2026-11-20T16:00:00.000Z");
	});

	it("date invalide : renvoyée telle quelle", () => {
		assert.equal(normalizeResetsAt("pas une date"), "pas une date");
	});
});
