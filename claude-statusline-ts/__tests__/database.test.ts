import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import * as db from "../src/lib/features/spend/database.ts";
import type { SessionRow } from "../src/lib/features/spend/types.ts";
import { Database } from "../src/lib/sqlite.ts";
import { dossierTemporaire, supprimer } from "./aide.ts";

const dossiers: string[] = [];
const AUJOURDHUI = new Date().toISOString().split("T")[0];

function nouvelleBase(): string {
	db.closeDb();
	const d = dossierTemporaire();
	dossiers.push(d);
	process.env.STATUSLINE_DATA_DIR = d;
	return d;
}

after(() => {
	db.closeDb();
	for (const d of dossiers) supprimer(d);
});

function session(over: Partial<SessionRow> = {}): SessionRow {
	return {
		session_id: "s1",
		total_cost: 1.5,
		cwd: "/p",
		date: AUJOURDHUI,
		duration_ms: 1000,
		lines_added: 3,
		lines_removed: 1,
		last_resets_at: null,
		cumulative_counted: 1.5,
		...over,
	};
}

describe("base des dépenses", () => {
	beforeEach(() => nouvelleBase());

	it("crée le fichier et toutes les tables au premier accès", () => {
		const d = process.env.STATUSLINE_DATA_DIR as string;
		const base = db.getDb();
		assert.ok(existsSync(join(d, "statusline.db")));
		const tables = base
			.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
			.all()
			.map((t) => t.name);
		assert.deepEqual(tables, ["periods", "project_cost_tracking", "session_period_tracking", "sessions"]);
	});

	it("crée le dossier de données s'il manque", () => {
		const d = join(nouvelleBase(), "sous", "dossier");
		process.env.STATUSLINE_DATA_DIR = d;
		db.getDb();
		assert.ok(existsSync(join(d, "statusline.db")));
	});

	it("getDb renvoie la même connexion tant qu'elle n'est pas fermée", () => {
		assert.equal(db.getDb(), db.getDb());
	});

	it("session : absente → null ; insertion puis mise à jour (clé session + date)", () => {
		assert.equal(db.getSession("s1", AUJOURDHUI), null);
		db.upsertSession(session());
		assert.equal(db.getSession("s1", AUJOURDHUI)?.total_cost, 1.5);
		db.upsertSession(session({ total_cost: 2, lines_added: 9 }));
		const s = db.getSession("s1", AUJOURDHUI);
		assert.equal(s?.total_cost, 2);
		assert.equal(s?.lines_added, 9);
		db.upsertSession(session({ date: "2020-01-01", total_cost: 5 }));
		assert.equal(db.getAllSessions().length, 2, "même session, autre date : deux lignes");
	});

	it("getSessionsByDate, getTodaySessionsTotal et getAllSessions (ordre date décroissante)", () => {
		db.upsertSession(session({ session_id: "a", total_cost: 1 }));
		db.upsertSession(session({ session_id: "b", total_cost: 2.25 }));
		db.upsertSession(session({ session_id: "c", date: "2020-01-01", total_cost: 100 }));
		assert.equal(db.getSessionsByDate(AUJOURDHUI).length, 2);
		assert.equal(db.getTodaySessionsTotal(), 3.25);
		assert.equal(db.getAllSessions().at(-1)?.date, "2020-01-01");
	});

	it("getTodaySessionsTotal vaut 0 sans session", () => {
		assert.equal(db.getTodaySessionsTotal(), 0);
	});

	it("getSessionTotalCounted additionne toutes les dates d'une session", () => {
		assert.equal(db.getSessionTotalCounted("s1"), 0);
		db.upsertSession(session({ cumulative_counted: 1 }));
		db.upsertSession(session({ date: "2020-01-01", cumulative_counted: 2 }));
		assert.equal(db.getSessionTotalCounted("s1"), 3);
	});

	it("suivi par période : absent → null ; insertion puis mise à jour", () => {
		assert.equal(db.getTracking("s1", "P"), null);
		db.upsertTracking({ session_id: "s1", period_id: "P", counted_cost: 1, last_session_cost: 1 });
		db.upsertTracking({ session_id: "s1", period_id: "P", counted_cost: 4, last_session_cost: 4 });
		assert.equal(db.getTracking("s1", "P")?.counted_cost, 4);
	});

	it("getPeriodCost plafonne chaque session à son coût du jour (MIN) et vaut 0 sans données", () => {
		assert.equal(db.getPeriodCost("P"), 0);
		db.upsertSession(session({ session_id: "a", total_cost: 2 }));
		db.upsertSession(session({ session_id: "b", total_cost: 10 }));
		db.upsertTracking({ session_id: "a", period_id: "P", counted_cost: 5, last_session_cost: 5 });
		db.upsertTracking({ session_id: "b", period_id: "P", counted_cost: 3, last_session_cost: 3 });
		db.upsertTracking({ session_id: "b", period_id: "Q", counted_cost: 99, last_session_cost: 99 });
		assert.equal(db.getPeriodCost("P"), 2 + 3);
	});

	it("périodes : upsertPeriod puis addToPeriodCost cumule", () => {
		db.upsertPeriod({ period_id: "P", total_cost: 1, utilization: 10, date: AUJOURDHUI });
		db.upsertPeriod({ period_id: "P", total_cost: 2, utilization: 20, date: AUJOURDHUI });
		db.addToPeriodCost("P", 0.5);
		db.addToPeriodCost("N", 0.25);
		const lire = (id: string) =>
			db.getDb().query<{ total_cost: number; utilization: number }>("SELECT * FROM periods WHERE period_id = ?").get(id);
		assert.equal(lire("P")?.total_cost, 2.5);
		assert.equal(lire("P")?.utilization, 20);
		assert.equal(lire("N")?.total_cost, 0.25);
	});

	it("coût maximal par projet : ne descend jamais (MAX)", () => {
		assert.equal(db.getProjectMaxCost("/p", AUJOURDHUI), 0);
		db.updateProjectMaxCost("/p", AUJOURDHUI, 3);
		db.updateProjectMaxCost("/p", AUJOURDHUI, 1);
		assert.equal(db.getProjectMaxCost("/p", AUJOURDHUI), 3);
		db.updateProjectMaxCost("/p", AUJOURDHUI, 7);
		assert.equal(db.getProjectMaxCost("/p", AUJOURDHUI), 7);
	});

	it("closeDb puis getDb rouvre la même base sur disque", () => {
		db.upsertSession(session());
		db.closeDb();
		db.closeDb(); // deuxième fermeture sans effet
		assert.equal(db.getSession("s1", AUJOURDHUI)?.total_cost, 1.5);
	});
});

describe("migrations d'anciens schémas", () => {
	it("migration en échec : retour arrière, erreur remontée, anciennes données intactes", () => {
		const d = nouvelleBase();
		const chemin = join(d, "statusline.db");
		const ancienne = new Database(chemin);
		// Clé simple ET colonne cumulative_counted absente : la copie vers la nouvelle table échoue.
		ancienne.run(`CREATE TABLE sessions (session_id TEXT PRIMARY KEY, date TEXT NOT NULL, total_cost REAL NOT NULL DEFAULT 0,
			cwd TEXT NOT NULL, duration_ms INTEGER NOT NULL DEFAULT 0, lines_added INTEGER NOT NULL DEFAULT 0,
			lines_removed INTEGER NOT NULL DEFAULT 0, last_resets_at TEXT, created_at INTEGER NOT NULL DEFAULT 0,
			updated_at INTEGER NOT NULL DEFAULT 0)`);
		ancienne.run("INSERT INTO sessions (session_id, date, total_cost, cwd) VALUES (?, ?, ?, ?)", ["garde", "2020-01-01", 8, "/x"]);
		ancienne.close();

		assert.throws(() => db.getDb(), /cumulative_counted/);
		db.closeDb();
		const verif = new Database(chemin);
		const tables = verif.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'").all().map((x) => x.name);
		assert.ok(!tables.includes("sessions_new"), "table intermédiaire annulée");
		assert.equal(verif.query<{ total_cost: number }>("SELECT total_cost FROM sessions WHERE session_id = 'garde'").get()?.total_cost, 8);
		verif.close();
	});

	it("clé primaire simple → clé composite, données conservées, sauvegarde créée une fois", () => {
		const d = nouvelleBase();
		const chemin = join(d, "statusline.db");
		const ancienne = new Database(chemin);
		ancienne.run(`CREATE TABLE sessions (
			session_id TEXT PRIMARY KEY, date TEXT NOT NULL, total_cost REAL NOT NULL DEFAULT 0,
			cwd TEXT NOT NULL, duration_ms INTEGER NOT NULL DEFAULT 0, lines_added INTEGER NOT NULL DEFAULT 0,
			lines_removed INTEGER NOT NULL DEFAULT 0, last_resets_at TEXT, cumulative_counted REAL NOT NULL DEFAULT 0,
			created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0)`);
		ancienne.run("INSERT INTO sessions (session_id, date, total_cost, cwd) VALUES (?, ?, ?, ?)", ["old", "2020-01-01", 4, "/x"]);
		ancienne.close();

		const base = db.getDb();
		const pk = base.query<{ pk: number }>("PRAGMA table_info(sessions)").all().filter((c) => c.pk > 0);
		assert.equal(pk.length, 2);
		assert.equal(db.getSession("old", "2020-01-01")?.total_cost, 4);
		assert.ok(existsSync(`${chemin}.backup-before-composite-key`));
	});

	it("colonne cumulative_counted absente → ajoutée et recalculée depuis le suivi par période", () => {
		const d = nouvelleBase();
		const ancienne = new Database(join(d, "statusline.db"));
		ancienne.run(`CREATE TABLE sessions (
			session_id TEXT NOT NULL, date TEXT NOT NULL, total_cost REAL NOT NULL DEFAULT 0, cwd TEXT NOT NULL,
			duration_ms INTEGER NOT NULL DEFAULT 0, lines_added INTEGER NOT NULL DEFAULT 0,
			lines_removed INTEGER NOT NULL DEFAULT 0, last_resets_at TEXT,
			created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0,
			PRIMARY KEY (session_id, date));
			CREATE TABLE session_period_tracking (session_id TEXT NOT NULL, period_id TEXT NOT NULL,
			counted_cost REAL NOT NULL DEFAULT 0, last_session_cost REAL NOT NULL DEFAULT 0,
			updated_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (session_id, period_id));`);
		ancienne.run("INSERT INTO sessions (session_id, date, total_cost, cwd) VALUES (?, ?, ?, ?)", ["s", "2020-01-01", 9, "/x"]);
		ancienne.run("INSERT INTO session_period_tracking (session_id, period_id, counted_cost) VALUES (?, ?, ?)", ["s", "P1", 1.25]);
		ancienne.run("INSERT INTO session_period_tracking (session_id, period_id, counted_cost) VALUES (?, ?, ?)", ["s", "P2", 2]);
		ancienne.close();

		assert.equal(db.getSession("s", "2020-01-01")?.cumulative_counted, 3.25);
	});
});
