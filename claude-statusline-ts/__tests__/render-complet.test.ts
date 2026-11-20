// Compléments à statusline.test.ts (repris de l'original) : branches de rendu non couvertes.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stripVTControlCharacters as brut } from "node:util";
import { defaultConfig, type StatuslineConfig } from "../src/lib/config.ts";
import { type RawStatuslineData, renderStatusline, renderStatuslineRaw } from "../src/lib/render-pure.ts";

const dans = (ms: number) => new Date(Date.now() + ms).toISOString();

function cfg(modif: (c: StatuslineConfig) => void = () => {}): StatuslineConfig {
	const c: StatuslineConfig = JSON.parse(JSON.stringify(defaultConfig));
	modif(c);
	return c;
}

function donnees(over: Partial<RawStatuslineData> = {}): RawStatuslineData {
	return {
		git: { branch: "main", dirty: true, staged: { files: 2, added: 4, deleted: 1 }, unstaged: { files: 1, added: 3, deleted: 2 } },
		path: "/a/b/c",
		modelName: "Opus 4.5",
		cost: 1.234,
		durationMs: 125_000,
		contextTokens: 80_000,
		contextPercentage: 40,
		usageLimits: {
			five_hour: { utilization: 50, resets_at: dans(2 * 3_600_000) },
			seven_day: { utilization: 60, resets_at: dans(48 * 3_600_000) },
		},
		periodCost: 12,
		todayCost: 3.5,
		thinkingEnabled: true,
		...over,
	};
}

const rendu = (d = donnees(), c = cfg()) => brut(renderStatuslineRaw(d, c));

describe("partie git", () => {
	it("branche masquée mais indicateur actif : « * » seul", () => {
		const r = rendu(donnees(), cfg((c) => { c.git.showBranch = false; }));
		assert.match(r, /^\*/);
	});
	it("ajouts et suppressions affichés quand showChanges est actif", () => {
		const r = rendu(donnees(), cfg((c) => { c.git.showChanges = true; }));
		assert.match(r, /\+7/);
		assert.match(r, /-3/);
	});
	it("pas de données git : aucune partie git", () => {
		assert.match(rendu(donnees({ git: null as never })), /^…\/b\/c/);
	});
});

describe("partie session", () => {
	it("pas encore de contexte : coût et durée affichés, « - » à la place du contexte", () => {
		const r = rendu(donnees({ contextTokens: null, contextPercentage: null }));
		assert.match(r, /S: \$1\.2 - \(2m\)/, r);
	});
	it("pas de contexte et tout le reste désactivé : « S: - »", () => {
		const c = cfg((x) => { x.session.cost.enabled = false; x.session.duration.enabled = false; });
		assert.match(rendu(donnees({ contextTokens: null, contextPercentage: null }), c), /S: -( |$)/);
	});
	it("jetons avec maximum (showMax)", () => {
		const r = rendu(donnees(), cfg((c) => { c.session.tokens.enabled = true; c.session.tokens.showMax = true; }));
		assert.match(r, /80k\/\d+k/);
	});
	it("séparateur d'information personnalisé", () => {
		const r = rendu(donnees(), cfg((c) => { c.session.infoSeparator = "|"; }));
		assert.match(r, /S: .*\|/);
	});
	it("tout désactivé : la partie session disparaît", () => {
		const r = rendu(donnees(), cfg((c) => {
			c.session.cost.enabled = false; c.session.tokens.enabled = false;
			c.session.percentage.enabled = false; c.session.duration.enabled = false;
		}));
		assert.doesNotMatch(r, /S:/);
	});
});

describe("limites 5 h et semaine", () => {
	it("coût de la période affiché si activé et non nul", () => {
		const r = rendu(donnees(), cfg((c) => { c.limits.cost.enabled = true; }));
		assert.match(r, /L: \$12/);
	});
	it("limites désactivées : pas de « L: »", () => {
		assert.doesNotMatch(rendu(donnees(), cfg((c) => { c.limits.enabled = false; })), /L:/);
	});
	it("semaine : true l'affiche, false la masque", () => {
		assert.match(rendu(donnees(), cfg((c) => { c.weeklyUsage.enabled = true; })), /W:/);
		assert.doesNotMatch(rendu(donnees(), cfg((c) => { c.weeklyUsage.enabled = false; })), /W:/);
	});
	it("semaine « 90% » : affichée seulement si la fenêtre 5 h dépasse 90 %", () => {
		const c = cfg((x) => { x.weeklyUsage.enabled = "90%"; });
		assert.doesNotMatch(rendu(donnees(), c), /W:/);
		const haut = donnees({ usageLimits: { five_hour: { utilization: 95, resets_at: dans(3_600_000) }, seven_day: { utilization: 60, resets_at: dans(3_600_000) } } });
		assert.match(rendu(haut, c), /W:/);
		assert.doesNotMatch(rendu(donnees({ usageLimits: { five_hour: null, seven_day: { utilization: 60, resets_at: null } } }), c), /W:/);
	});
	it("semaine : coût, barre, valeur, écart de rythme et temps restant, chacun selon sa couleur", () => {
		const c = cfg((x) => {
			x.weeklyUsage.enabled = true; x.weeklyUsage.cost.enabled = true;
			x.weeklyUsage.showPacingDelta = true; x.weeklyUsage.showTimeLeft = true;
			x.weeklyUsage.percentage.enabled = true; x.weeklyUsage.percentage.showValue = true;
			x.weeklyUsage.percentage.progressBar.enabled = true;
		});
		for (const utilisation of [1, 40, 75, 99]) {
			const d = donnees({ usageLimits: { five_hour: null, seven_day: { utilization: utilisation, resets_at: dans(84 * 3_600_000) } } });
			const r = rendu(d, c);
			assert.match(r, /W: \$12/);
			assert.match(r, new RegExp(`${utilisation}%`));
			assert.match(r, /\([+-]\d+\.\d%\)/);
			assert.match(r, /\(\d+h\d+m\)/);
		}
	});
	it("semaine sans date de remise à zéro : ni écart ni temps restant", () => {
		const c = cfg((x) => { x.weeklyUsage.enabled = true; x.weeklyUsage.showPacingDelta = true; x.weeklyUsage.showTimeLeft = true; });
		const r = rendu(donnees({ usageLimits: { five_hour: null, seven_day: { utilization: 10, resets_at: null } } }), c);
		assert.doesNotMatch(r, /W:[^•]*\(/);
	});
	it("5 h sans date : écart de rythme nul", () => {
		const c = cfg((x) => { x.limits.showPacingDelta = true; });
		const r = rendu(donnees({ usageLimits: { five_hour: { utilization: 30, resets_at: null }, seven_day: null } }), c);
		assert.match(r, /L:/);
	});
});

describe("avertissement de réflexion", () => {
	it("réflexion désactivée et avertissement actif : « Thinking: OFF »", () => {
		const c = cfg((x) => { x.thinking.showDisabledWarning = true; });
		assert.match(rendu(donnees({ thinkingEnabled: false }), c), /Thinking: OFF/);
		assert.doesNotMatch(rendu(donnees({ thinkingEnabled: true }), c), /Thinking/);
	});
});

describe("mode deux lignes", () => {
	it("oneLine: false : passage à la ligne après la première partie", () => {
		const r = rendu(donnees(), cfg((c) => { c.oneLine = false; }));
		assert.equal(r.split("\n").length, 2);
	});
	it("oneLine: false sans autre partie : une seule ligne", () => {
		const c = cfg((x) => {
			x.oneLine = false; x.limits.enabled = false; x.weeklyUsage.enabled = false; x.dailySpend.cost.enabled = false;
			x.session.cost.enabled = false; x.session.tokens.enabled = false; x.session.percentage.enabled = false; x.session.duration.enabled = false;
		});
		assert.equal(rendu(donnees({ todayCost: 0, periodCost: 0 }), c).split("\n").length, 1);
	});
});

describe("ancien format (renderStatusline)", () => {
	it("branche formatée relue : indicateur, compteurs ; durées en heures, minutes, secondes", () => {
		for (const duree of ["1h 5m", "12m", "45s", "inconnu"]) {
			const r = brut(renderStatusline({
				branch: "main* ~2 ~1", dirPath: "~/x", modelName: "Opus", sessionCost: "$1.5", sessionDuration: duree,
				contextTokens: 10, contextPercentage: 1,
			} as never, cfg((c) => { c.git.showStaged = true; c.git.showUnstaged = true; })));
			assert.match(r, /main\*/);
		}
	});
	it("branche vide : pas de partie git", () => {
		const r = brut(renderStatusline({
			branch: "", dirPath: "~/x", modelName: "Opus", sessionCost: "0", sessionDuration: "0m", contextTokens: null, contextPercentage: null,
		} as never, cfg()));
		assert.match(r, /^~\/x/);
	});
});
