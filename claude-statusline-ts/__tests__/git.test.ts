import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { getGitStatus, parseStats } from "../src/lib/git.ts";
import { dossierTemporaire, git, supprimer } from "./aide.ts";

let depot: string;
let horsDepot: string;

before(() => {
	depot = dossierTemporaire("statusline-git-");
	horsDepot = dossierTemporaire("statusline-nogit-");
	git(depot, "init", "-q", "-b", "principale");
	writeFileSync(join(depot, "a.txt"), "1\n2\n3\n");
	git(depot, "add", ".");
	git(depot, "commit", "-q", "-m", "init");
});

after(() => {
	supprimer(depot);
	supprimer(horsDepot);
});

describe("parseStats", () => {
	it("additionne ajouts et suppressions, ignore les lignes vides", () => {
		assert.deepEqual(parseStats("3\t1\ta.txt\n\n2\t0\tb.txt\n"), { added: 5, deleted: 1 });
	});
	it("fichier binaire (« - ») compté 0", () => {
		assert.deepEqual(parseStats("-\t-\timage.png\n1\t2\tc.txt"), { added: 1, deleted: 2 });
	});
	it("entrée vide : 0 / 0", () => {
		assert.deepEqual(parseStats(""), { added: 0, deleted: 0 });
	});
});

describe("getGitStatus", () => {
	it("hors dépôt : « no-git », sans changement", async () => {
		const s = await getGitStatus(horsDepot);
		assert.equal(s.branch, "no-git");
		assert.equal(s.hasChanges, false);
	});

	it("dossier inexistant : « no-git », pas d'exception", async () => {
		assert.equal((await getGitStatus(join(horsDepot, "absent"))).branch, "no-git");
	});

	it("dépôt propre : nom de branche, aucun changement", async () => {
		const s = await getGitStatus(depot);
		assert.equal(s.branch, "principale");
		assert.equal(s.hasChanges, false);
		assert.deepEqual(s.staged, { added: 0, deleted: 0, files: 0 });
	});

	it("modifications indexées et non indexées comptées séparément", async () => {
		writeFileSync(join(depot, "a.txt"), "1\n2\n3\n4\n5\n"); // +2 indexé
		git(depot, "add", "a.txt");
		writeFileSync(join(depot, "a.txt"), "1\n3\n4\n5\n"); // -1 non indexé
		writeFileSync(join(depot, "b.txt"), "x\n");
		git(depot, "add", "b.txt"); // +1 indexé, 2e fichier
		const s = await getGitStatus(depot);
		assert.equal(s.hasChanges, true);
		assert.deepEqual(s.staged, { added: 3, deleted: 0, files: 2 });
		assert.deepEqual(s.unstaged, { added: 0, deleted: 1, files: 1 });
		git(depot, "reset", "-q", "--hard");
	});

	it("tête détachée : « detached »", async () => {
		const sha = git(depot, "rev-parse", "HEAD").trim();
		git(depot, "checkout", "-q", sha);
		assert.equal((await getGitStatus(depot)).branch, "detached");
		git(depot, "checkout", "-q", "principale");
	});

	it("sans argument : utilise le dossier courant du processus", async () => {
		const ici = process.cwd();
		process.chdir(depot);
		try {
			assert.equal((await getGitStatus()).branch, "principale");
		} finally {
			process.chdir(ici);
		}
	});
});
