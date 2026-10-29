import type { AuthUser } from './auth';

/**
 * Collects WHERE conditions with numbered parameters. Values always travel as $n parameters;
 * only fixed SQL fragments written in code are concatenated.
 */
export class Where {
  readonly params: unknown[];
  private readonly parts: string[] = [];

  constructor(params: unknown[] = []) {
    this.params = params;
  }

  /** Adds a parameter and returns its placeholder ($n). */
  p(value: unknown): string {
    this.params.push(value);
    return `$${this.params.length}`;
  }

  /** Adds a condition; `?` placeholders are replaced by the given values in order. */
  add(condition: string, ...values: unknown[]): this {
    let i = 0;
    this.parts.push(condition.replace(/\?/g, () => this.p(values[i++])));
    return this;
  }

  /** Adds the condition only when the value is set. */
  addIf(value: unknown, condition: string): this {
    if (value !== undefined && value !== null && value !== '') this.add(condition, value);
    return this;
  }

  toString(): string {
    return this.parts.length ? `WHERE ${this.parts.join(' AND ')}` : '';
  }

  get and(): string {
    return this.parts.length ? ` AND ${this.parts.join(' AND ')}` : '';
  }
}

/** Limits a query on employees (aliased `alias`) to the departments a manager may see. */
export function scopeEmployees(w: Where, user: AuthUser, alias = 'e'): Where {
  if (user.role === 'manager') {
    w.add(`${alias}.department_id = ANY(?::uuid[])`, user.departmentIds ?? []);
  }
  return w;
}

export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => '\\' + c);
}

export function pageParams(q: { page?: number; pageSize?: number }, maxSize = 200) {
  const pageSize = Math.min(Math.max(Number(q.pageSize) || 50, 1), maxSize);
  const page = Math.max(Number(q.page) || 1, 1);
  return { limit: pageSize, offset: (page - 1) * pageSize, page, pageSize };
}
