// Équivalent minimal de `expect` de bun:test, sur node:assert, limité aux assertions
// employées par ces tests : toBe, toEqual, toContain, toMatch, et leurs formes `not`.
import assert from "node:assert/strict";

function contient(recu: unknown, attendu: unknown): boolean {
	if (typeof recu === "string") return recu.includes(String(attendu));
	if (Array.isArray(recu)) return recu.includes(attendu);
	throw new TypeError(`toContain attend une chaîne ou un tableau, reçu ${typeof recu}`);
}

function assertions(recu: unknown, inverse: boolean) {
	const verifier = (ok: boolean, message: string) => {
		if (ok === inverse) assert.fail(inverse ? `non attendu : ${message}` : message);
	};
	return {
		toBe(attendu: unknown) {
			verifier(Object.is(recu, attendu), `${String(recu)} devrait être ${String(attendu)}`);
		},
		toEqual(attendu: unknown) {
			let egal = true;
			try {
				assert.deepStrictEqual(recu, attendu);
			} catch {
				egal = false;
			}
			verifier(egal, `${JSON.stringify(recu)} devrait égaler ${JSON.stringify(attendu)}`);
		},
		toContain(attendu: unknown) {
			verifier(contient(recu, attendu), `${JSON.stringify(recu)} devrait contenir ${JSON.stringify(attendu)}`);
		},
		toMatch(motif: RegExp | string) {
			const regex = typeof motif === "string" ? new RegExp(motif) : motif;
			verifier(regex.test(String(recu)), `${JSON.stringify(recu)} devrait correspondre à ${regex}`);
		},
	};
}

export function expect(recu: unknown) {
	return { ...assertions(recu, false), not: assertions(recu, true) };
}
