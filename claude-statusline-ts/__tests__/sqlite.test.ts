import assert from "node:assert/strict";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { Database } from "../src/lib/sqlite.ts";
import { dossierTemporaire, supprimer } from "./aide.ts";

const dossier = dossierTemporaire();
after(() => supprimer(dossier));

describe("adaptateur sqlite (API bun:sqlite sur node:sqlite)", () => {
	it("run sans paramètre accepte plusieurs instructions", () => {
		const db = new Database(":memory:");
		db.run("CREATE TABLE t (a INTEGER, b TEXT); CREATE TABLE u (x INTEGER);");
		db.run("INSERT INTO u VALUES (1)", []);
		assert.equal(db.query<{ n: number }>("SELECT COUNT(*) AS n FROM u").get()?.n, 1);
		db.close();
	});

	it("run avec paramètres lie les valeurs", () => {
		const db = new Database(":memory:");
		db.run("CREATE TABLE t (a INTEGER, b TEXT)");
		db.run("INSERT INTO t VALUES (?, ?)", [1, "un"]);
		db.run("INSERT INTO t VALUES (?, ?)", [2, "deux"]);
		const lignes = db.query<{ a: number; b: string }>("SELECT * FROM t ORDER BY a").all();
		assert.deepEqual(lignes.map((l) => [l.a, l.b]), [[1, "un"], [2, "deux"]]);
		db.close();
	});

	it("get renvoie null (et non undefined) quand aucune ligne", () => {
		const db = new Database(":memory:");
		db.run("CREATE TABLE t (a INTEGER)");
		assert.equal(db.query("SELECT * FROM t WHERE a = ?").get(42), null);
		db.close();
	});

	it("all renvoie un tableau vide quand aucune ligne", () => {
		const db = new Database(":memory:");
		db.run("CREATE TABLE t (a INTEGER)");
		assert.deepEqual(db.query("SELECT * FROM t").all(), []);
		db.close();
	});

	it("persiste sur disque entre deux ouvertures", () => {
		const chemin = join(dossier, "p.db");
		const a = new Database(chemin);
		a.run("CREATE TABLE t (a INTEGER)");
		a.run("INSERT INTO t VALUES (?)", [7]);
		a.close();
		const b = new Database(chemin);
		assert.equal(b.query<{ a: number }>("SELECT a FROM t").get()?.a, 7);
		b.close();
	});

	it("une erreur SQL est levée, pas avalée", () => {
		const db = new Database(":memory:");
		assert.throws(() => db.run("SELECT * FROM table_absente"));
		assert.throws(() => db.query("SELECT * FROM table_absente").all());
		db.close();
	});

	it("utilisation après close : erreur", () => {
		const db = new Database(":memory:");
		db.close();
		assert.throws(() => db.run("SELECT 1"));
	});
});
