import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, types } from 'pg';
import { config } from '../config';

// DATE stays 'YYYY-MM-DD' (no timezone shifting), NUMERIC and BIGINT become numbers (counts, minutes, days).
types.setTypeParser(1082, (v) => v);
types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

/** Something that can run a parameterised query: the pool or a client inside a transaction. */
export interface Queryable {
  query<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = any>(sql: string, params?: unknown[]): Promise<T>;
  maybeOne<T = any>(sql: string, params?: unknown[]): Promise<T | null>;
}

class Executor implements Queryable {
  constructor(protected readonly target: Pool | PoolClient) {}

  async query<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.target.query(sql, params as any[]);
    return res.rows as T[];
  }

  async one<T = any>(sql: string, params: unknown[] = []): Promise<T> {
    const rows = await this.query<T>(sql, params);
    if (rows.length !== 1) throw new Error(`Expected exactly one row, got ${rows.length}`);
    return rows[0];
  }

  async maybeOne<T = any>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }
}

export type Tx = Queryable;

/** All SQL in the app goes through here, always with $n parameters (never string-built values). */
@Injectable()
export class Db extends Executor implements OnModuleDestroy {
  readonly pool: Pool;

  constructor() {
    const pool = new Pool({ connectionString: config.databaseUrl, max: config.databasePoolSize });
    super(pool);
    this.pool = pool;
  }

  async tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(new Executor(client));
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
