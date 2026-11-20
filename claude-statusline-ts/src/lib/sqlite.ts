// Adaptateur : expose le sous-ensemble de l'API `bun:sqlite` utilisé par ce projet
// (query().get/all, run, close) au-dessus de `node:sqlite` (Node 22.13+ / 24).
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

type Params = SQLInputValue[];

export class Statement<Row, Args extends Params = Params> {
	private readonly db: DatabaseSync;
	private readonly sql: string;

	constructor(db: DatabaseSync, sql: string) {
		this.db = db;
		this.sql = sql;
	}

	/** Première ligne, ou null (bun:sqlite renvoie null, node:sqlite undefined). */
	get(...args: Args): Row | null {
		const row = this.db.prepare(this.sql).get(...args);
		return row === undefined ? null : (row as Row);
	}

	all(...args: Args): Row[] {
		return this.db.prepare(this.sql).all(...args) as Row[];
	}
}

export class Database {
	private readonly db: DatabaseSync;

	constructor(path: string) {
		this.db = new DatabaseSync(path);
	}

	query<Row, Args extends Params = Params>(sql: string): Statement<Row, Args> {
		return new Statement<Row, Args>(this.db, sql);
	}

	/** Sans paramètre : accepte plusieurs instructions ; avec paramètres : une seule. */
	run(sql: string, params?: Params): void {
		if (params === undefined || params.length === 0) {
			this.db.exec(sql);
			return;
		}
		this.db.prepare(sql).run(...params);
	}

	close(): void {
		this.db.close();
	}
}
