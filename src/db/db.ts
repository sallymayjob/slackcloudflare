import { newId, nowIso } from '../util';

const MUTABLE_TABLES = new Set<string>([
  'learners',
  'enrollment',
  'lessons',
  'learner_progress',
  'submission_log',
  'delivery_queue',
  'retry_queue',
  'audit_log',
  'courses',
  'modules',
  'onboarding_requests',
  'onboarding_checklists',
  'onboarding_task_log',
  'config_flags',
]);

function ensureTable(name: string): string {
  if (!MUTABLE_TABLES.has(name)) throw new Error(`UNKNOWN_TABLE:${name}`);
  return name;
}

export interface TableApi<T> {
  findAll(where?: Partial<T>): Promise<T[]>;
  findById(id: string): Promise<T | null>;
  findOne(where: Partial<T>): Promise<T | null>;
  insert(values: Partial<T>): Promise<T>;
  update(id: string, patch: Partial<T>): Promise<T | null>;
}

export class Db {
  constructor(private readonly d1: D1Database) {}

  table<T = Record<string, unknown>>(name: string): TableApi<T> {
    const tableName = ensureTable(name);
    const d1 = this.d1;

    const buildWhereClause = (where?: Partial<T>): { sql: string; binds: unknown[] } => {
      if (!where) return { sql: '', binds: [] };
      const keys = Object.keys(where);
      if (keys.length === 0) return { sql: '', binds: [] };
      const sql = ' WHERE ' + keys.map((k) => `"${k}" = ?`).join(' AND ');
      const binds = keys.map((k) => (where as Record<string, unknown>)[k]);
      return { sql, binds };
    };

    return {
      async findAll(where?: Partial<T>) {
        const { sql, binds } = buildWhereClause(where);
        const { results } = await d1
          .prepare(`SELECT * FROM "${tableName}"${sql}`)
          .bind(...binds)
          .all<T>();
        return results || [];
      },

      async findById(id: string) {
        const row = await d1
          .prepare(`SELECT * FROM "${tableName}" WHERE id = ? LIMIT 1`)
          .bind(id)
          .first<T>();
        return row || null;
      },

      async findOne(where: Partial<T>) {
        const { sql, binds } = buildWhereClause(where);
        const row = await d1
          .prepare(`SELECT * FROM "${tableName}"${sql} LIMIT 1`)
          .bind(...binds)
          .first<T>();
        return row || null;
      },

      async insert(values: Partial<T>) {
        const now = nowIso();
        const row = {
          id: (values as Record<string, unknown>).id ?? newId(),
          createdAt: (values as Record<string, unknown>).createdAt ?? now,
          updatedAt: (values as Record<string, unknown>).updatedAt ?? now,
          ...values,
        } as Record<string, unknown>;

        const keys = Object.keys(row);
        const placeholders = keys.map(() => '?').join(', ');
        const columns = keys.map((k) => `"${k}"`).join(', ');
        await d1
          .prepare(`INSERT INTO "${tableName}" (${columns}) VALUES (${placeholders})`)
          .bind(...keys.map((k) => row[k]))
          .run();
        return row as unknown as T;
      },

      async update(id: string, patch: Partial<T>) {
        const now = nowIso();
        const full = { ...patch, updatedAt: now } as Record<string, unknown>;
        const keys = Object.keys(full);
        if (keys.length === 0) return this.findById(id);
        const setClause = keys.map((k) => `"${k}" = ?`).join(', ');
        await d1
          .prepare(`UPDATE "${tableName}" SET ${setClause} WHERE id = ?`)
          .bind(...keys.map((k) => full[k]), id)
          .run();
        return this.findById(id);
      },
    };
  }

  async audit(action: string, resourceType: string, metadata: Record<string, unknown>): Promise<void> {
    const now = nowIso();
    const id = newId('audit');
    await this.d1
      .prepare(
        `INSERT INTO audit_log (id, actor, action, resourceType, resourceId, status, message, metadata, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        String(metadata.actor ?? 'system'),
        action,
        resourceType,
        String(metadata.resourceId ?? ''),
        String(metadata.status ?? 'ok'),
        String(metadata.message ?? ''),
        JSON.stringify(metadata || {}),
        now,
        now
      )
      .run();
  }

  raw(): D1Database {
    return this.d1;
  }
}
