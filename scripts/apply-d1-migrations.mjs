import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { needsLegacyBootstrap, pendingMigrationNames } from './migration-plan.mjs'
import { isMainModule, reportFailure, root, runWrangler, withRetry } from './wrangler-command.mjs'

export function migrationNames() {
  return readdirSync(join(root, 'migrations'))
    .filter((name) => /^\d{4}_[a-zA-Z0-9_-]+\.sql$/.test(name))
    .sort()
}

export function parseAppliedMigrations(output) {
  let response
  try {
    response = JSON.parse(output.trim())
  } catch {
    throw new Error('Wrangler 返回了无效的 D1 JSON，无法确认迁移状态。')
  }
  if (!Array.isArray(response) || response.length !== 1
    || response[0]?.success !== true || !Array.isArray(response[0].results)
    || response[0].results.some((row) => typeof row?.name !== 'string'
      || !/^\d{4}_[a-zA-Z0-9_-]+\.sql$/.test(row.name))) {
    throw new Error('Wrangler 返回的 D1 迁移记录格式异常，已停止部署。')
  }
  return new Set(response[0].results.map(({ name }) => name))
}

export function migrationImport(names) {
  return names.map((name) => {
    if (!/^\d{4}_[a-zA-Z0-9_-]+\.sql$/.test(name)) throw new Error('非法迁移文件名。')
    const sql = readFileSync(join(root, 'migrations', name), 'utf8').trimEnd()
    return `${sql}\nINSERT INTO d1_migrations (name) VALUES ('${name}');`
  }).join('\n\n') + '\n'
}

export async function applyD1Migrations({
  mode = '--remote',
  configArgs = [],
  persistTo = process.env.OMNIMAIL_D1_PERSIST_TO?.trim(),
  run = runWrangler,
  retry = withRetry,
} = {}) {
  if (mode !== '--remote' && mode !== '--local') {
    throw new Error('用法：node scripts/apply-d1-migrations.mjs --remote|--local')
  }
  const persistence = mode === '--local' && persistTo ? ['--persist-to', persistTo] : []
  const execute = (args, capture = false) => run([...args, ...configArgs], { capture })
  if (mode === '--local') {
    await execute(['d1', 'execute', 'DB', mode, ...persistence, '--file', 'scripts/bootstrap-legacy-d1.sql', '--yes'])
    await execute(['d1', 'migrations', 'apply', 'DB', mode, ...persistence])
    return
  }

  const readApplied = async () => parseAppliedMigrations(await execute([
    'd1', 'execute', 'DB', '--remote',
    '--command', 'SELECT name FROM d1_migrations ORDER BY name', '--json',
  ], true))
  const available = migrationNames()

  // 整个规划步骤重试：导入已在远端提交但响应丢失时，先重新读取记录，不能直接重放 ALTER/DROP。
  await retry(async () => {
    let applied
    try {
      applied = await readApplied()
    } catch (error) {
      if (!/no such table:\s*d1_migrations\b/i.test(error.message)) throw error
      applied = null
    }
    if (needsLegacyBootstrap(applied)) {
      await execute(['d1', 'execute', 'DB', '--remote', '--file', 'scripts/bootstrap-legacy-d1.sql', '--yes'])
      applied = await readApplied()
    }
    const pending = pendingMigrationNames(available, applied)
    if (pending.length === 0) {
      console.log('D1 迁移已全部完成。')
      return
    }
    console.log(`正在应用 ${pending.length} 个 D1 迁移……`)
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'omnimail-d1-'))
    try {
      const importPath = join(temporaryDirectory, 'migrations.sql')
      writeFileSync(importPath, migrationImport(pending), 'utf8')
      await execute(['d1', 'execute', 'DB', '--remote', '--file', importPath, '--yes'])
      const completed = await readApplied()
      const missing = pendingMigrationNames(available, completed)
      if (missing.length) throw new Error(`D1 迁移未完成或未记录：${missing.join(', ')}`)
      console.log('D1 迁移完成，记录校验通过。')
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true })
    }
  }, { label: 'D1 迁移' })
}

if (isMainModule(import.meta.url)) {
  if (process.argv.length !== 3) {
    reportFailure(new Error('用法：node scripts/apply-d1-migrations.mjs --remote|--local'))
  } else {
    await applyD1Migrations({ mode: process.argv[2] }).catch(reportFailure)
  }
}
