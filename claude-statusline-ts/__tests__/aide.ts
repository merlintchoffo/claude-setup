// Outils communs aux tests : dossiers temporaires isolés, jamais les vraies données.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const RACINE = join(import.meta.dirname, "..");

export function dossierTemporaire(prefixe = "statusline-test-"): string {
	return mkdtempSync(join(tmpdir(), prefixe));
}

export function supprimer(chemin: string): void {
	rmSync(chemin, { recursive: true, force: true });
}

/** Exécute un script du projet dans un processus séparé, HOME et données isolés. */
export function lancer(
	script: string,
	options: { args?: string[]; entree?: string; env?: Record<string, string> } = {},
) {
	const r = spawnSync(process.execPath, [join(RACINE, script), ...(options.args ?? [])], {
		input: options.entree ?? "",
		encoding: "utf-8",
		env: { PATH: process.env.PATH ?? "", NO_COLOR: "1", ...options.env },
		timeout: 20000,
	});
	return { code: r.status, sortie: r.stdout, erreur: r.stderr };
}

export function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf-8",
		env: {
			PATH: process.env.PATH ?? "",
			HOME: cwd,
			GIT_CONFIG_NOSYSTEM: "1",
			GIT_AUTHOR_NAME: "t",
			GIT_AUTHOR_EMAIL: "t@t",
			GIT_COMMITTER_NAME: "t",
			GIT_COMMITTER_EMAIL: "t@t",
		},
	});
}
