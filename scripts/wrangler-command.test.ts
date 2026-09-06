import { describe, expect, it, vi } from 'vitest'
import { isTransientError, redactOutput, WranglerCommandError, withRetry } from './wrangler-command.mjs'

describe('Wrangler 错误与重试', () => {
  it('保留只出现在 stdout 中的 JSON 错误，让新数据库进入初始化分支', () => {
    const error = new WranglerCommandError({
      status: 1,
      stdout: JSON.stringify({ error: { text: 'no such table: d1_migrations: SQLITE_ERROR' } }),
      stderr: '',
    })
    expect(error.message).toBe('no such table: d1_migrations: SQLITE_ERROR')
  })

  it('同时保留 stdout 和 stderr 的诊断', () => {
    const error = new WranglerCommandError({ status: 1, stdout: 'HTTP 503', stderr: 'fetch failed' })
    expect(error.message).toContain('HTTP 503')
    expect(error.message).toContain('fetch failed')
    expect(isTransientError(error)).toBe(true)
  })

  it('保留 API 错误附注和状态码，用于识别限流和服务故障', () => {
    const error = new WranglerCommandError({
      status: 1, stderr: '', stdout: JSON.stringify({
        error: { text: 'A request to the Cloudflare API failed.', notes: [{ text: 'Too many requests' }], status: 429 },
      }),
    })
    expect(error.message).toContain('Too many requests')
    expect(error.message).toContain('HTTP 429')
    expect(isTransientError(error)).toBe(true)
  })

  it('隐藏环境中的凭据、认证头和签名 URL 参数', () => {
    const output = redactOutput(
      'secret-value Authorization: Bearer abc123 https://upload.example.com/file?signature=hidden&token=key',
      { CLOUDFLARE_API_TOKEN: 'secret-value' },
    )
    expect(output).not.toMatch(/secret-value|abc123|signature|hidden&token/)
    expect(output).toContain('https://upload.example.com/file')
  })

  it.each([
    'fetch failed', 'ECONNRESET', 'HTTP 429', 'status: 503', 'SQLITE_BUSY',
    'D1 DB is busy', 'D1 reset before execute completed!',
  ])('识别临时错误：%s', (message) => {
    expect(isTransientError(new Error(message))).toBe(true)
  })

  it.each([
    'Authentication error [code: 10000]', 'Forbidden HTTP 403', 'Missing D1 permission',
    'no such table: users: SQLITE_ERROR', 'duplicate column name: scopes',
    'UNIQUE constraint failed: users.email', 'Unknown argument: wrong',
  ])('不重试永久错误：%s', (message) => {
    expect(isTransientError(new Error(message))).toBe(false)
  })

  it('按退避间隔重试并返回恢复结果', async () => {
    const operation = vi.fn().mockRejectedValueOnce(new Error('HTTP 503'))
      .mockRejectedValueOnce(new Error('ECONNRESET')).mockResolvedValue('ok')
    const sleep = vi.fn()
    await expect(withRetry(operation, { sleep, random: () => 0, warn: vi.fn() })).resolves.toBe('ok')
    expect(sleep.mock.calls).toEqual([[2000], [4000]])
    expect(operation).toHaveBeenCalledTimes(3)
  })

  it('最多尝试五次，最终仍失败时向调用者抛出真实错误', async () => {
    const error = new Error('HTTP 503')
    const operation = vi.fn().mockRejectedValue(error)
    const sleep = vi.fn()
    await expect(withRetry(operation, { sleep, random: () => 0, warn: vi.fn() })).rejects.toBe(error)
    expect(operation).toHaveBeenCalledTimes(5)
    expect(sleep.mock.calls).toEqual([[2000], [4000], [8000], [16000]])
  })

  it('权限错误立即退出', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('Authentication error'))
    const sleep = vi.fn()
    await expect(withRetry(operation, { sleep })).rejects.toThrow('Authentication')
    expect(operation).toHaveBeenCalledOnce()
    expect(sleep).not.toHaveBeenCalled()
  })
})
