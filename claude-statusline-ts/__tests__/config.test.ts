import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { configPath, defaultConfig, loadConfig } from "../src/lib/config.ts";
import { dossierTemporaire, supprimer } from "./aide.ts";

const d = dossierTemporaire();
after(() => {
	delete process.env.STATUSLINE_CONFIG;
	supprimer(d);
});

describe("loadConfig", () => {
	it("fichier absent : copie des valeurs par défaut, indépendante de defaultConfig", () => {
		process.env.STATUSLINE_CONFIG = join(d, "absent.json");
		const c = loadConfig();
		assert.deepEqual(c, defaultConfig);
		(c as { separator: string }).separator = "modifié";
		assert.notEqual(defaultConfig.separator, "modifié");
	});

	it("JSON invalide : valeurs par défaut", () => {
		const f = join(d, "invalide.json");
		writeFileSync(f, "{pas du json");
		process.env.STATUSLINE_CONFIG = f;
		assert.deepEqual(loadConfig(), defaultConfig);
	});

	it("fusion profonde : une clé imbriquée surchargée, ses voisines gardent leur défaut", () => {
		const f = join(d, "partiel.json");
		writeFileSync(f, JSON.stringify({ separator: "|", git: { showBranch: false } }));
		process.env.STATUSLINE_CONFIG = f;
		const c = loadConfig();
		assert.equal(c.separator, "|");
		assert.equal(c.git.showBranch, false);
		assert.equal(c.git.enabled, defaultConfig.git.enabled);
		assert.deepEqual(c.session, defaultConfig.session);
	});

	it("un tableau ou une valeur simple remplace la valeur par défaut au lieu d'être fusionné", () => {
		const f = join(d, "remplace.json");
		writeFileSync(f, JSON.stringify({ git: false }));
		process.env.STATUSLINE_CONFIG = f;
		assert.equal(loadConfig().git as unknown, false);
	});

	it("sans STATUSLINE_CONFIG : statusline.config.json à la racine du dossier", () => {
		delete process.env.STATUSLINE_CONFIG;
		assert.equal(configPath(), join(import.meta.dirname, "..", "statusline.config.json"));
	});
});
