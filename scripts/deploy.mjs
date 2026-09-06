import { parseArgs } from 'node:util'
import { applyD1Migrations } from './apply-d1-migrations.mjs'
import { isMainModule, reportFailure, runWrangler, withRetry } from './wrangler-command.mjs'

export function deploymentOptions(args) {
  // 只接收能同时安全传给迁移与部署的目标参数，避免 --name 等覆盖项导致两个操作指向不同资源。
  const { values } = parseArgs({
    args,
    options: {
      env: { type: 'string', short: 'e' },
      config: { type: 'string', short: 'c' },
      'env-file': { type: 'string', multiple: true },
      profile: { type: 'string' },
      'dry-run': { type: 'boolean' },
      outdir: { type: 'string' },
      minify: { type: 'boolean' },
    },
  })
  for (const [key, value] of Object.entries(values)) {
    for (const entry of Array.isArray(value) ? value : [value]) {
      if (typeof entry === 'string'
        && (!entry.trim() || entry.length > 4096 || /[\0\r\n]/.test(entry))) {
        throw new Error(`无效的 --${key} 参数。`)
      }
    }
  }
  const configArgs = []
  for (const key of ['env', 'config', 'env-file', 'profile']) {
    const value = values[key]
    if (value === undefined) continue
    for (const entry of Array.isArray(value) ? value : [value]) {
      configArgs.push(`--${key}`, entry)
    }
  }
  return { configArgs, dryRun: values['dry-run'] === true }
}

export function isUnprovisionedD1(error) {
  // 仅对 Wrangler 明确报告的自动创建绑定缺失执行首次发布，权限或手工配置错误不能走此分支。
  return /Couldn't find an auto-provisioned D1 DB named '[a-zA-Z0-9_-]+' for binding 'DB'/.test(error.message)
}

export async function deploy(args = [], {
  run = runWrangler,
  migrate = applyD1Migrations,
  retry = withRetry,
} = {}) {
  const { configArgs, dryRun } = deploymentOptions(args)
  const publish = () => retry(() => run(['deploy', ...args]), { label: 'Worker 部署' })
  if (dryRun) {
    await run(['deploy', ...args])
    return
  }
  console.log('正在检查并迁移 D1……')
  try {
    await migrate({ configArgs })
  } catch (error) {
    if (!isUnprovisionedD1(error)) throw error
    console.log('首次部署：D1 尚未创建，先由 Wrangler 创建并绑定资源，再初始化数据库。')
    await publish()
    try {
      await retry(() => migrate({ configArgs }), {
        label: '等待新建 D1 可用',
        shouldRetry: isUnprovisionedD1,
      })
    } catch (migrationError) {
      throw new Error(`Worker 已发布，但 D1 初始化未完成。请修复以下原因后重新运行 npm run deploy：\n${migrationError.message}`)
    }
    console.log('首次部署完成，D1 迁移校验通过。')
    return
  }
  await publish()
  console.log('部署完成，D1 迁移校验通过。')
}

if (isMainModule(import.meta.url)) {
  await deploy(process.argv.slice(2)).catch(reportFailure)
}
