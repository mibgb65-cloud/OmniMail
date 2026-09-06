import { describe, expect, it, vi } from 'vitest'
import { deploy, deploymentOptions } from './deploy.mjs'
import { withRetry } from './wrangler-command.mjs'

const missingDatabase = new Error("Couldn't find an auto-provisioned D1 DB named 'omni-mail-db' for binding 'DB'. Run 'wrangler deploy' to provision it.")
const retry = (operation: () => Promise<void>, options: object) => withRetry(operation, {
  ...options, sleep: vi.fn(), warn: vi.fn(), random: () => 0,
})

describe('部署入口', () => {
  it('已有数据库先迁移再发布', async () => {
    const events: string[] = []
    await deploy([], {
      migrate: async () => { events.push('migrate') },
      run: async () => { events.push('deploy') }, retry,
    })
    expect(events).toEqual(['migrate', 'deploy'])
  })

  it('首次部署先创建绑定，等待资源可用后完成迁移', async () => {
    const events: string[] = []
    let calls = 0
    await deploy([], {
      migrate: async () => {
        events.push('migrate')
        if (calls++ < 2) throw missingDatabase
      },
      run: async () => { events.push('deploy') }, retry,
    })
    expect(events).toEqual(['migrate', 'deploy', 'migrate', 'migrate'])
  })

  it.each(['Authentication error', 'SQLITE_ERROR', "Couldn't find a D1 DB named 'configured-db'"])(
    '迁移遇到 %s 时停止发布', async (message) => {
      const run = vi.fn()
      await expect(deploy([], {
        migrate: vi.fn().mockRejectedValue(new Error(message)), run, retry,
      })).rejects.toThrow(message)
      expect(run).not.toHaveBeenCalled()
    },
  )

  it('首次发布后初始化失败，明确报告尚未完成并返回失败', async () => {
    const migrate = vi.fn().mockRejectedValueOnce(missingDatabase)
      .mockRejectedValue(new Error('Forbidden HTTP 403'))
    const run = vi.fn()
    await expect(deploy([], { migrate, run, retry })).rejects.toThrow('Worker 已发布，但 D1 初始化未完成')
    expect(run).toHaveBeenCalledOnce()
  })

  it('上传遇到网络故障时重试，不重复迁移', async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error('HTTP 503')).mockResolvedValue('ok')
    const migrate = vi.fn()
    await deploy([], { run, migrate, retry })
    expect(run).toHaveBeenCalledTimes(2)
    expect(migrate).toHaveBeenCalledOnce()
  })

  it('dry-run 完全跳过远程迁移和资源初始化', async () => {
    const run = vi.fn()
    const migrate = vi.fn()
    await deploy(['--dry-run', '--outdir', '.wrangler/preview'], { run, migrate, retry })
    expect(migrate).not.toHaveBeenCalled()
    expect(run).toHaveBeenCalledExactlyOnceWith(['deploy', '--dry-run', '--outdir', '.wrangler/preview'])
  })

  it('配置、环境与认证参数传给同一次部署的迁移操作', async () => {
    const args = ['--env', 'staging', '--config', 'staging.jsonc', '--env-file', '.env.staging', '--profile', 'test']
    const migrate = vi.fn()
    const run = vi.fn()
    await deploy(args, { migrate, run, retry })
    expect(migrate).toHaveBeenCalledWith({ configArgs: args })
    expect(run).toHaveBeenCalledWith(['deploy', ...args])
  })

  it('未知目标覆盖或无效参数在任何远端操作前报错', async () => {
    expect(() => deploymentOptions(['--env', '\n'])).toThrow('无效')
    const run = vi.fn()
    const migrate = vi.fn()
    await expect(deploy(['--name', 'other-worker'], { run, migrate, retry })).rejects.toThrow()
    expect(run).not.toHaveBeenCalled()
    expect(migrate).not.toHaveBeenCalled()
  })
})
