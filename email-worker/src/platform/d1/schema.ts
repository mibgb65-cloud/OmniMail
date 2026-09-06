import {
  LEGACY_BASELINES,
  RECOVERABLE_MIGRATIONS,
  REQUIRED_MIGRATION,
  WRANGLER_MIGRATION_NAMES,
} from './schema-migrations'

const schemaChecks = new WeakMap<D1Database, Promise<void>>()

function migrationTableExists(db: D1Database) {
  return db.prepare(
    "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'd1_migrations' LIMIT 1",
  ).first<{ found: number }>()
}

function appliedMigration(db: D1Database, name: string) {
  return db.prepare(
    'SELECT 1 AS applied FROM d1_migrations WHERE name = ? LIMIT 1',
  ).bind(name).first<{ applied: number }>()
}

function migrationError(cause?: unknown, migration = REQUIRED_MIGRATION): Error {
  const detail = cause instanceof Error && cause.message ? ` ${cause.message}` : ''
  return new Error(
    `D1 数据库迁移未完成，请运行 npm run deploy 完成数据库初始化和部署（单独运行 npx wrangler deploy 不会执行迁移）。`
      + ` 缺少迁移：${migration}。${detail}`,
  )
}

async function bootstrapLegacyMigrations(db: D1Database): Promise<void> {
  const hasMigrationTable = Boolean(await migrationTableExists(db))

  let legacyVersion: string | undefined
  try {
    legacyVersion = (await db.prepare(
      "SELECT value FROM settings WHERE key = 'schema_version' LIMIT 1",
    ).first<{ value: string }>())?.value
  } catch (error) {
    if (hasMigrationTable || await migrationTableExists(db)) return
    throw migrationError(error)
  }

  if (!legacyVersion && hasMigrationTable) return

  const baseline = legacyVersion ? LEGACY_BASELINES[legacyVersion] : undefined
  if (!baseline) {
    if (!hasMigrationTable && await migrationTableExists(db)) return
    throw migrationError(new Error(
      `无法识别旧版数据库结构标记：${legacyVersion ?? '缺失'}`,
    ))
  }

  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS d1_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    ...WRANGLER_MIGRATION_NAMES.slice(0, baseline).map((name) => (
      db.prepare(
        `INSERT INTO d1_migrations (name)
         SELECT ? WHERE NOT EXISTS (
           SELECT 1 FROM d1_migrations WHERE name = ?
         )`,
      ).bind(name, name)
    )),
  ])
}

async function applyRecoverableMigration(
  db: D1Database,
  migration: typeof RECOVERABLE_MIGRATIONS[number],
): Promise<void> {
  if (await appliedMigration(db, migration.name)) return

  if (migration.name === '0020_device_token_scopes.sql') {
    const column = await db.prepare(
      "SELECT 1 AS present FROM pragma_table_info('device_sessions') WHERE name = 'scopes' LIMIT 1",
    ).first<{ present: number }>()
    if (column?.present === 1) {
      await recordMigration(db, migration.name).run()
      return
    }
  }

  try {
    await db.batch([
      ...migration.statements.map((sql) => db.prepare(sql)),
      recordMigration(db, migration.name),
    ])
  } catch (error) {
    // Another isolate may have completed the migration after our first check.
    if (await appliedMigration(db, migration.name)) return
    throw error
  }
}

function recordMigration(db: D1Database, migration: string): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO d1_migrations (name)
     SELECT ? WHERE NOT EXISTS (SELECT 1 FROM d1_migrations WHERE name = ?)`,
  ).bind(migration, migration)
}

async function ensureRequiredMigrations(db: D1Database): Promise<void> {
  try {
    if (await appliedMigration(db, REQUIRED_MIGRATION)) return
  } catch {
    // A fresh database has no migration table yet; continue into recovery.
  }
  await bootstrapLegacyMigrations(db)
  for (const migration of RECOVERABLE_MIGRATIONS) {
    try {
      await applyRecoverableMigration(db, migration)
    } catch (error) {
      throw migrationError(error, migration.name)
    }
  }
}

export function ensureSchema(db: D1Database): Promise<void> {
  const current = schemaChecks.get(db)
  if (current) return current

  const check = ensureRequiredMigrations(db)
  schemaChecks.set(db, check)
  check.catch(() => {
    if (schemaChecks.get(db) === check) schemaChecks.delete(db)
  })
  return check
}
