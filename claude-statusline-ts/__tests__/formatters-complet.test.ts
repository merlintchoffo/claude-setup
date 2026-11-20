// Compléments à formatters.test.ts (repris de l'original) : branches non couvertes.
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { describe, it } from "node:test";
import { stripVTControlCharacters as brut } from "node:util";
import type { GitStatus } from "../src/lib/git.ts";
import {
	colors,
	formatBranch,
	formatPath,
	formatProgressBar,
	formatProgressBarBraille,
	formatProgressBarFilled,
	formatProgressBarRectangle,
	formatResetTime,
} from "../src/lib/formatters.ts";

const GIT_CFG = {
	enabled: true, showBranch: true, showDirtyIndicator: true,
	showChanges: true, showStaged: true, showUnstaged: true,
};

function etat(over: Partial<GitStatus> = {}): GitStatus {
	return {
		branch: "main", hasChanges: true,
		staged: { added: 4, deleted: 1, files: 2 },
		unstaged: { added: 3, deleted: 2, files: 1 },
		...over,
	};
}

describe("formatBranch", () => {
	it("tout activé : branche, *, +ajouts, -suppressions, ~indexés, ~non indexés", () => {
		assert.equal(brut(formatBranch(etat(), GIT_CFG)), "main* +7 -3 ~2 ~1");
	});
	it("sans changement : la branche seule", () => {
		assert.equal(brut(formatBranch(etat({ hasChanges: false }), GIT_CFG)), "main");
	});
	it("branche masquée, indicateur et compteurs désactivés : rien après la branche", () => {
		const cfg = { ...GIT_CFG, showBranch: false, showDirtyIndicator: false, showChanges: false, showStaged: false, showUnstaged: false };
		assert.equal(brut(formatBranch(etat(), cfg)), "");
	});
	it("zéro ajout / zéro suppression / zéro fichier : compteurs omis", () => {
		const vide = { added: 0, deleted: 0, files: 0 };
		assert.equal(brut(formatBranch(etat({ staged: vide, unstaged: vide }), GIT_CFG)), "main*");
	});
});

describe("formatPath", () => {
	const home = homedir();
	it("full : le dossier personnel devient ~", () => {
		assert.equal(formatPath(`${home}/a/b/c`, "full"), "~/a/b/c");
	});
	it("truncated : deux derniers segments précédés de …", () => {
		assert.equal(formatPath(`${home}/a/b/c`, "truncated"), "…/b/c");
		assert.equal(formatPath("/x/y", "truncated"), "/x/y", "deux segments ou moins : inchangé");
	});
	it("basename : dernier segment ; chemin racine seul renvoyé tel quel", () => {
		assert.equal(formatPath("/a/b/projet", "basename"), "projet");
		assert.equal(formatPath("/", "basename"), "/");
	});
	it("mode par défaut : truncated", () => {
		assert.equal(formatPath("/a/b/c/d"), "…/c/d");
	});
});

describe("formatResetTime", () => {
	const dans = (ms: number) => new Date(Date.now() + ms).toISOString();
	it("heures et minutes, minutes seules, « now » si passé, « N/A » si invalide", () => {
		assert.match(formatResetTime(dans(2 * 3_600_000 + 5 * 60_000 + 30_000)), /^2h5m$/);
		assert.match(formatResetTime(dans(9 * 60_000 + 30_000)), /^9m$/);
		assert.equal(formatResetTime(dans(-1000)), "now");
		assert.equal(formatResetTime("invalide"), "N/A");
	});
});

describe("barres de progression", () => {
	const STYLES = ["filled", "rectangle", "braille"] as const;
	const COULEURS = ["progressive", "green", "yellow", "peach", "black", "white", "purple", "blue", "cyan", "red"] as const;
	const FONDS = ["none", "dark", "gray", "light", "blue", "purple", "cyan", "peach"] as const;

	it("chaque style a exactement la longueur demandée, de 0 à 100 %", () => {
		for (const style of STYLES) {
			for (const p of [0, 1, 33, 50, 99, 100]) {
				for (const longueur of [5, 10, 20]) {
					const barre = brut(formatProgressBar({ percentage: p, length: longueur, style, colorMode: "green", background: "none" }));
					assert.equal([...barre].length, longueur, `${style} ${p}% ${longueur}`);
				}
			}
		}
	});

	it("0 % : aucune case pleine ; 100 % : toutes pleines (filled, rectangle)", () => {
		assert.ok(!brut(formatProgressBarFilled(0, 10, "green", "none")).includes("█"));
		assert.equal(brut(formatProgressBarFilled(100, 10, "green", "none")), "█".repeat(10));
		assert.equal(brut(formatProgressBarRectangle(100, 5, "green", "none")).length, 5);
		assert.equal(brut(formatProgressBarBraille(100, 4, "green", "none")), "⣿".repeat(4));
	});

	it("toutes les couleurs et tous les fonds produisent un rendu, coloré sauf « none »", () => {
		for (const style of STYLES) {
			for (const couleur of COULEURS) {
				for (const fond of FONDS) {
					const r = formatProgressBar({ percentage: 40, length: 10, style, colorMode: couleur as never, background: fond as never });
					assert.ok(brut(r).length > 0);
				}
			}
		}
		const sansFond = formatProgressBarFilled(40, 10, "green", "none");
		const avecFond = formatProgressBarFilled(40, 10, "green", "peach");
		assert.notEqual(sansFond, avecFond);
	});

	it("couleur progressive : change aux seuils 50, 70 et 90 %", () => {
		const rendu = (p: number) => formatProgressBarFilled(p, 10, "progressive", "none").replace(/[█░]/g, "");
		const codes = [10, 60, 80, 95].map(rendu);
		assert.equal(new Set(codes).size, 4);
	});

	it("couleur inconnue : rouge par défaut ; fond inconnu : aucun", () => {
		assert.equal(
			formatProgressBarFilled(40, 10, "inconnue" as never, "inconnu" as never),
			formatProgressBarFilled(40, 10, "red" as never, "none"),
		);
	});
});

describe("couleurs maison", () => {
	it("orange, pêche, fond pêche, noir, blanc, blanc atténué : séquences ANSI autour du texte", () => {
		for (const f of [colors.orange, colors.peach, colors.bgPeach, colors.black, colors.white, colors.dimWhite]) {
			const r = f("x");
			assert.equal(brut(r), "x");
			assert.ok(r.startsWith("\x1b["));
		}
	});
});
