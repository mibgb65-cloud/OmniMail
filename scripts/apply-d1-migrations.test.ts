import { existsSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyD1Migrations, migrationImport, migrationNames, parseAppliedMigrations } from './apply-d1-migrations.mjs'
import { root, WranglerCommandError, withRetry } from './wrangler-command.mjs'

const databases: DatabaseSync[] = []
afterEach(() => {
  for (const db of databases.splice(0)) db.close()
})

function fixture(options: {
  failure?: 'before-import' | 'after-import' | 'verify' | 'permanent' | 'missing-record'
  queryFailures?: number
} = {}) {
  const db = new DatabaseSync(':memory:')
  databases.push(db)
  const files: string[] = []
  let failure = options.failure
  let queryFailures = options.queryFailures ?? 0
  let imports = 0
  const run = vi.fn((args: string[]) => {
    if (args.includes('--command')) {
      if (queryFailures-- > 0) throw new Error('HTTP 503')
      if (failure === 'verify' && imports > 0) {
        failure = undefined
        throw new Error('ECONNRESET')
      }
      try {
        const rows = db.prepare('SELECT name FROM d1_migrations ORDER BY name').all()
        return JSON.stringify([{ success: true, results: rows }])
      } catch (error) {
        throw new WranglerCommandError({
          status: 1, stderr: '', stdout: JSON.stringify({ error: { text: (error as Error).message } }),
        })
      }
    }
    const file = args[args.indexOf('--file') + 1]
    const bootstrap = file === 'scripts/bootstrap-legacy-d1.sql'
    if (!bootstrap) {
      imports += 1
      files.push(file)
      if (failure === 'permanent') throw new Error('near invalid: syntax error: SQLITE_ERROR')
      if (failure === 'before-import') {
        failure = undefined
        throw new Error('fetch failed')
      }
      if (failure === 'missing-record') return ''
    }
    const sql = readFileSync(bootstrap ? join(root, file) : file, 'utf8')
    db.exec('BEGIN')
    try {
      db.exec(sql)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    if (!bootstrap && failure === 'after-import') {
      failure = undefined
      throw new Error('fetch failed')
    }
    return ''
  })
  const sleep = vi.fn()
  const retry = (operation: () => Promise<void>, retryOptions: object) => withRetry(operation, {
    ...retryOptions, sleep, random: () => 0, warn: vi.fn(),
  })
  return { db, run, retry, sleep, files, imports: () => imports }
}

describe('部署 D1 迁移', () => {
  it('处理 stdout 中的缺表错误，初始化空库并可重复部署', async () => {
    const f = fixture()
    await applyD1Migrations(f)
    await applyD1Migrations(f)
    expect(f.imports()).toBe(1)
    expect(f.db.prepare('SELECT count(*) AS count FROM d1_migrations').get()).toEqual({ count: 34 })
    expect(f.db.prepare("SELECT name FROM sqlite_master WHERE name = 'users'").get()).toEqual({ name: 'users' })
    expect(f.files.every((file) => !existsSync(file))).toBe(true)
  })

  it.each(['after-import', 'verify'] as const)('远端已提交但 %s 失败时不重复执行 ALTER/DROP', async (failure) => {
    const f = fixture({ failure })
    await applyD1Migrations(f)
    expect(f.imports()).toBe(1)
    expect(f.sleep).toHaveBeenCalledOnce()
    expect(f.db.prepare('SELECT count(*) AS count FROM d1_migrations').get()).toEqual({ count: 34 })
  })

  it('导入前网络中断可以安全重试，所有临时 SQL 文件均被清理', async () => {
    const f = fixture({ failure: 'before-import', queryFailures: 1 })
    await applyD1Migrations(f)
    expect(f.imports()).toBe(2)
    expect(f.sleep).toHaveBeenCalledTimes(2)
    expect(f.files.every((file) => !existsSync(file))).toBe(true)
  })

  it('中途已完成的迁移保持原状，仅导入剩余迁移', async () => {
    const f = fixture()
    f.db.exec(readFileSync(join(root, 'scripts/bootstrap-legacy-d1.sql'), 'utf8'))
    f.db.exec(migrationImport(migrationNames().slice(0, 20)))
    await applyD1Migrations(f)
    expect(f.db.prepare('SELECT count(*) AS count FROM d1_migrations').get()).toEqual({ count: 34 })
    expect(f.imports()).toBe(1)
  })

  it.each(['permanent', 'missing-record'] as const)('不把 %s 错误伪装成迁移成功', async (failure) => {
    const f = fixture({ failure })
    await expect(applyD1Migrations(f)).rejects.toThrow(failure === 'permanent' ? 'SQLITE_ERROR' : '迁移未完成')
    expect(f.imports()).toBe(1)
    expect(f.sleep).not.toHaveBeenCalled()
    expect(f.files.every((file) => !existsSync(file))).toBe(true)
  })

  it.each(['{}', '[]', '[{"success":false,"results":[]}]', '[{"success":true}]', '<html>503</html>'])('拒绝异常迁移查询结果：%s', (output) => {
    expect(() => parseAppliedMigrations(output)).toThrow()
  })

  it('拒绝包含路径或 SQL 的迁移名称', () => {
    expect(() => migrationImport(['0001_../../secret.sql'])).toThrow('非法迁移')
    expect(() => parseAppliedMigrations(JSON.stringify([
      { success: true, results: [{ name: "0001_'; DROP TABLE users;--.sql" }] },
    ]))).toThrow('格式异常')
  })

  it('本地迁移显式保持本地目标和隔离持久化目录', async () => {
    const run = vi.fn()
    await applyD1Migrations({ mode: '--local', persistTo: 'test-state', run })
    expect(run).toHaveBeenCalledTimes(2)
    for (const [args] of run.mock.calls) {
      expect(args).toContain('--local')
      expect(args).toContain('test-state')
      expect(args).not.toContain('--remote')
    }
  })
})
