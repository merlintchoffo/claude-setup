import { execFile } from "node:child_process";

export interface GitStatus {
	branch: string;
	hasChanges: boolean;
	staged: {
		added: number;
		deleted: number;
		files: number;
	};
	unstaged: {
		added: number;
		deleted: number;
		files: number;
	};
}

interface Resultat {
	exitCode: number;
	stdout: string;
}

// Lance git sans shell (aucune interprétation des arguments), avec un délai maximal :
// la statusline ne doit jamais rester bloquée sur un dépôt lent.
function git(args: string[], cwd?: string): Promise<Resultat> {
	return new Promise((resolve) => {
		execFile("git", args, { cwd, timeout: 2000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
			const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
			resolve({ exitCode: code, stdout: String(stdout) });
		});
	});
}

const SANS_GIT: GitStatus = {
	branch: "no-git",
	hasChanges: false,
	staged: { added: 0, deleted: 0, files: 0 },
	unstaged: { added: 0, deleted: 0, files: 0 },
};

export function parseStats(diff: string): { added: number; deleted: number } {
	let added = 0;
	let deleted = 0;
	for (const line of diff.split("\n")) {
		if (!line.trim()) continue;
		// Fichier binaire : git écrit « - » ; compté 0 ligne.
		const [a, d] = line.split("\t").map((n) => Number.parseInt(n, 10) || 0);
		added += a;
		deleted += d;
	}
	return { added, deleted };
}

function compterFichiers(liste: string): number {
	return liste.split("\n").filter((f) => f.trim()).length;
}

export async function getGitStatus(cwd?: string): Promise<GitStatus> {
	const estDepot = await git(["rev-parse", "--git-dir"], cwd);
	if (estDepot.exitCode !== 0) {
		return structuredClone(SANS_GIT);
	}

	const branch = (await git(["branch", "--show-current"], cwd)).stdout.trim() || "detached";

	const diffCheck = await git(["diff-index", "--quiet", "HEAD", "--"], cwd);
	const cachedCheck = await git(["diff-index", "--quiet", "--cached", "HEAD", "--"], cwd);

	if (diffCheck.exitCode === 0 && cachedCheck.exitCode === 0) {
		return { ...structuredClone(SANS_GIT), branch };
	}

	const [unstagedDiff, stagedDiff, stagedFiles, unstagedFiles] = await Promise.all([
		git(["diff", "--numstat"], cwd),
		git(["diff", "--cached", "--numstat"], cwd),
		git(["diff", "--cached", "--name-only"], cwd),
		git(["diff", "--name-only"], cwd),
	]);

	const unstagedStats = parseStats(unstagedDiff.stdout);
	const stagedStats = parseStats(stagedDiff.stdout);

	return {
		branch,
		hasChanges: true,
		staged: { ...stagedStats, files: compterFichiers(stagedFiles.stdout) },
		unstaged: { ...unstagedStats, files: compterFichiers(unstagedFiles.stdout) },
	};
}
