// Limites d'usage : le jeton et le réseau sont simulés. Aucun appel réel, aucun vrai jeton lu.
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { fetchUsageLimits, getCredentials, getUsageLimits } from "../src/lib/features/limits/index.ts";
import { dossierTemporaire, supprimer } from "./aide.ts";

const vraiFetch = globalThis.fetch;
const vraiHome = process.env.HOME;
const dossiers: string[] = [];
let appels: { url: string; init: RequestInit | undefined }[] = [];

function reponse(statut: number, corps: unknown): Response {
	return new Response(JSON.stringify(corps), { status: statut, headers: { "content-type": "application/json" } });
}

function simulerFetch(f: () => Response | Promise<Response>): void {
	globalThis.fetch = (async (url: string, init?: RequestInit) => {
		appels.push({ url: String(url), init });
		return f();
	}) as typeof fetch;
}

function home(credentials?: string): void {
	const d = dossierTemporaire();
	dossiers.push(d);
	process.env.HOME = d;
	process.env.STATUSLINE_DATA_DIR = d;
	if (credentials !== undefined) {
		mkdirSync(join(d, ".claude"));
		writeFileSync(join(d, ".claude", ".credentials.json"), credentials);
	}
}

const LIMITES = { five_hour: { utilization: 42, resets_at: "R5" }, seven_day: { utilization: 7, resets_at: "R7" } };

beforeEach(() => {
	appels = [];
	globalThis.fetch = (() => {
		throw new Error("appel réseau non simulé");
	}) as typeof fetch;
});

after(() => {
	globalThis.fetch = vraiFetch;
	process.env.HOME = vraiHome;
	for (const d of dossiers) supprimer(d);
});

describe("getCredentials (fichier ~/.claude/.credentials.json)", () => {
	it("format claudeAiOauth.accessToken", async () => {
		home(JSON.stringify({ claudeAiOauth: { accessToken: "jeton-a" } }));
		assert.equal(await getCredentials(), "jeton-a");
	});
	it("format accessToken à la racine", async () => {
		home(JSON.stringify({ accessToken: "jeton-b" }));
		assert.equal(await getCredentials(), "jeton-b");
	});
	it("texte brut commençant par sk- : accepté", async () => {
		home("sk-brut");
		assert.equal(await getCredentials(), "sk-brut");
	});
	it("texte brut quelconque, JSON sans jeton, fichier vide ou absent : null", async () => {
		home("n'importe quoi");
		assert.equal(await getCredentials(), null);
		home(JSON.stringify({ autre: 1 }));
		assert.equal(await getCredentials(), null);
		home("");
		assert.equal(await getCredentials(), null);
		home();
		assert.equal(await getCredentials(), null);
	});
	it("fichier illisible (un dossier à sa place) : null", async () => {
		home();
		mkdirSync(join(process.env.HOME as string, ".claude", ".credentials.json"), { recursive: true });
		assert.equal(await getCredentials(), null);
	});
});

describe("fetchUsageLimits", () => {
	it("appelle l'API avec le jeton en en-tête et renvoie les deux fenêtres", async () => {
		simulerFetch(() => reponse(200, LIMITES));
		assert.deepEqual(await fetchUsageLimits("jeton"), LIMITES);
		assert.equal(appels[0].url, "https://api.anthropic.com/api/oauth/usage");
		assert.equal((appels[0].init?.headers as Record<string, string>).Authorization, "Bearer jeton");
	});
	it("fenêtres absentes de la réponse : null", async () => {
		simulerFetch(() => reponse(200, {}));
		assert.deepEqual(await fetchUsageLimits("j"), { five_hour: null, seven_day: null });
	});
	it("réponse en erreur HTTP : null", async () => {
		simulerFetch(() => reponse(401, { error: "x" }));
		assert.equal(await fetchUsageLimits("j"), null);
	});
	it("erreur réseau : null", async () => {
		simulerFetch(() => Promise.reject(new Error("hors ligne")));
		assert.equal(await fetchUsageLimits("j"), null);
	});
});

describe("getUsageLimits (cache d'une minute)", () => {
	it("sans jeton : aucune requête, limites vides", async () => {
		home();
		assert.deepEqual(await getUsageLimits(), { five_hour: null, seven_day: null });
		assert.equal(appels.length, 0);
	});

	it("avec jeton : interroge l'API, met en cache, puis sert le cache sans nouvel appel", async () => {
		home(JSON.stringify({ accessToken: "j" }));
		simulerFetch(() => reponse(200, LIMITES));
		assert.deepEqual(await getUsageLimits(), LIMITES);
		const cache = join(process.env.STATUSLINE_DATA_DIR as string, "usage-limits-cache.json");
		assert.ok(existsSync(cache));
		assert.ok(!readFileSync(cache, "utf-8").includes('"j"'), "le jeton n'est jamais écrit dans le cache");
		assert.deepEqual(await getUsageLimits(), LIMITES);
		assert.equal(appels.length, 1);
	});

	it("cache périmé (plus d'une minute) : nouvel appel", async () => {
		home(JSON.stringify({ accessToken: "j" }));
		const cache = join(process.env.STATUSLINE_DATA_DIR as string, "usage-limits-cache.json");
		writeFileSync(cache, JSON.stringify({ data: { five_hour: null, seven_day: null }, timestamp: Date.now() - 61_000 }));
		simulerFetch(() => reponse(200, LIMITES));
		assert.deepEqual(await getUsageLimits(), LIMITES);
		assert.equal(appels.length, 1);
	});

	it("cache illisible : ignoré, nouvel appel", async () => {
		home(JSON.stringify({ accessToken: "j" }));
		writeFileSync(join(process.env.STATUSLINE_DATA_DIR as string, "usage-limits-cache.json"), "{pas du json");
		simulerFetch(() => reponse(200, LIMITES));
		assert.deepEqual(await getUsageLimits(), LIMITES);
	});

	it("API en échec : limites vides, rien en cache", async () => {
		home(JSON.stringify({ accessToken: "j" }));
		simulerFetch(() => reponse(500, {}));
		assert.deepEqual(await getUsageLimits(), { five_hour: null, seven_day: null });
		assert.ok(!existsSync(join(process.env.STATUSLINE_DATA_DIR as string, "usage-limits-cache.json")));
	});

	it("dossier de cache non inscriptible : les limites sont quand même renvoyées", async () => {
		home(JSON.stringify({ accessToken: "j" }));
		process.env.STATUSLINE_DATA_DIR = join(process.env.HOME as string, "absent", "encore");
		simulerFetch(() => reponse(200, LIMITES));
		assert.deepEqual(await getUsageLimits(), LIMITES);
	});
});

describe("trousseau macOS (plateforme et commande `security` simulées)", () => {
	const vraiePlateforme = Object.getOwnPropertyDescriptor(process, "platform");
	const vraiPath = process.env.PATH;

	function trousseau(sortie: string | null): void {
		const bin = dossierTemporaire();
		dossiers.push(bin);
		const corps = sortie === null ? "exit 44" : `printf '%s' '${sortie}'`;
		writeFileSync(join(bin, "security"), `#!/bin/sh\n${corps}\n`);
		chmodSync(join(bin, "security"), 0o755);
		process.env.PATH = `${bin}:${vraiPath}`;
		Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
	}

	after(() => {
		if (vraiePlateforme) Object.defineProperty(process, "platform", vraiePlateforme);
		process.env.PATH = vraiPath;
	});

	it("jeton lu dans le trousseau, prioritaire sur le fichier", async () => {
		home(JSON.stringify({ accessToken: "du-fichier" }));
		trousseau(JSON.stringify({ claudeAiOauth: { accessToken: "du-trousseau" } }));
		assert.equal(await getCredentials(), "du-trousseau");
	});

	it("trousseau en échec : repli sur le fichier", async () => {
		home(JSON.stringify({ accessToken: "du-fichier" }));
		trousseau(null);
		assert.equal(await getCredentials(), "du-fichier");
	});

	it("trousseau vide : repli sur le fichier", async () => {
		home(JSON.stringify({ accessToken: "du-fichier" }));
		trousseau("");
		assert.equal(await getCredentials(), "du-fichier");
	});
});
