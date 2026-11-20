import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultConfig, type StatuslineConfig } from "../src/lib/config.ts";
import { cycle, percentageOptions, progressBarOptions, section, toggle } from "../src/lib/menu-factories.ts";
import { applyPreset, PRESETS } from "../src/lib/presets.ts";

const copie = (): StatuslineConfig => JSON.parse(JSON.stringify(defaultConfig));

describe("fonctions de menu", () => {
	it("toggle lit et inverse une valeur imbriquée", () => {
		const c = copie();
		const opt = toggle("git.showBranch", "Branche");
		assert.equal(opt.getValue?.(c), true);
		opt.toggle?.(c);
		assert.equal(c.git.showBranch, false);
		assert.equal(opt.indent, 1);
	});

	it("toggle sur un chemin absent crée la clé si le parent existe, sinon ne fait rien", () => {
		const c = copie() as unknown as Record<string, Record<string, unknown>>;
		toggle("git.nouvelle", "N").toggle?.(c as never);
		assert.equal(c.git.nouvelle, true);
		assert.doesNotThrow(() => toggle("absent.profond.cle", "X").toggle?.(c as never));
	});

	it("cycle avance, recule et boucle ; displayValue appliqué", () => {
		const c = copie();
		c.pathDisplayMode = "full";
		const opt = cycle("pathDisplayMode", "Chemin", ["truncated", "basename", "full"] as const, {
			displayValue: (v) => v.toUpperCase(),
		});
		assert.deepEqual(opt.choices, ["TRUNCATED", "BASENAME", "FULL"]);
		assert.equal(opt.getValue?.(c), "FULL");
		opt.cycle?.(c, 1);
		assert.equal(c.pathDisplayMode, "truncated");
		opt.cycle?.(c, -1);
		assert.equal(c.pathDisplayMode, "full");
		assert.equal(cycle("separator", "S", ["•", "|"] as const).getValue?.(c), String(c.separator));
	});

	it("section simple et section avec interrupteur", () => {
		assert.deepEqual(section("git", "Git"), { path: "git", label: "Git", type: "section" });
		const c = copie();
		const s = section("git", "Git", { enabledPath: "git.enabled" });
		assert.equal(s.getValue?.(c), true);
		s.toggle?.(c);
		assert.equal(c.git.enabled, false);
	});

	it("options de barre : masquées selon le parent et selon « barre activée »", () => {
		const c = copie();
		const opts = progressBarOptions("session.percentage", () => false);
		assert.equal(opts.length, 5);
		c.session.percentage.progressBar.enabled = false;
		assert.equal(opts[0].hidden?.(c), false);
		assert.ok(opts.slice(1).every((o) => o.hidden?.(c) === true));
		c.session.percentage.progressBar.enabled = true;
		assert.ok(opts.slice(1).every((o) => o.hidden?.(c) === false));
		assert.ok(progressBarOptions("session.percentage", () => true).every((o) => o.hidden?.(c) === true));
	});

	it("options de pourcentage : tout masqué si le pourcentage est désactivé, sauf l'interrupteur", () => {
		const c = copie();
		const opts = percentageOptions("session.percentage", () => false);
		c.session.percentage.enabled = false;
		assert.equal(opts[0].hidden?.(c), false);
		assert.ok(opts.slice(1).every((o) => o.hidden?.(c) === true));
	});
});

describe("préréglages", () => {
	it("trois préréglages nommés, chacun une configuration complète", () => {
		assert.deepEqual(PRESETS.map((p) => p.name), ["Minimal", "Balanced", "Full"]);
		for (const p of PRESETS) assert.equal(typeof p.config.oneLine, "boolean");
	});

	it("applyPreset ignore la casse et renvoie une copie indépendante", () => {
		const a = applyPreset("minimal");
		assert.ok(a);
		(a as { separator: string }).separator = "X";
		assert.notEqual(PRESETS[0].config.separator, "X");
		assert.equal(applyPreset("FULL")?.oneLine, PRESETS[2].config.oneLine);
	});

	it("préréglage inconnu : null", () => {
		assert.equal(applyPreset("inconnu"), null);
	});
});
