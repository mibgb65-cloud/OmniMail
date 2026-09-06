import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

export const root = dirname(dirname(fileURLToPath(import.meta.url)))
const wranglerCli = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js')

export function redactOutput(output, env = process.env) {
  let text = String(output ?? '')
  for (const [name, value] of Object.entries(env)) {
    if (/(?:TOKEN|SECRET|PASSWORD|API_KEY|CREDENTIALS_KEY)/i.test(name) && value) {
      text = text.replaceAll(value, '[已隐藏]')
    }
  }
  return text
    .replace(/(Authorization\s*[:=]\s*(?:Bearer\s+)?)[^\s"']+/gi, '$1[已隐藏]')
    .replace(/(https?:\/\/[^\s?"']+)\?[^\s"']+/gi, '$1?[已隐藏]')
}

function errorDetail(output) {
  try {
    const parsed = JSON.parse(output)
    if (typeof parsed.error === 'string') return parsed.error
    if (typeof parsed.error?.text === 'string') {
      return [
        parsed.error.text,
        ...(Array.isArray(parsed.error.notes) ? parsed.error.notes.map((note) => note?.text) : []),
        parsed.error.code === undefined ? '' : `code: ${parsed.error.code}`,
        parsed.error.status === undefined ? '' : `HTTP ${parsed.error.status}`,
      ].filter(Boolean).join('\n')
    }
  } catch {
    // Wrangler 普通日志和 JSON 错误使用不同格式，两者都需要保留。
  }
  return output
}

export class WranglerCommandError extends Error {
  constructor(result, env = process.env) {
    const detail = [errorDetail(result.stdout), errorDetail(result.stderr), result.error?.message]
      .filter(Boolean).join('\n').trim()
    super(redactOutput(detail || `Wrangler 退出码：${result.status}，信号：${result.signal ?? '无'}`, env))
    this.name = 'WranglerCommandError'
    this.code = result.error?.code
  }
}

export function runWrangler(args, { capture = false, env = process.env } = {}) {
  const result = spawnSync(process.execPath, [wranglerCli, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...env, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
    stdio: 'pipe',
    maxBuffer: 16 * 1024 * 1024,
    timeout: 10 * 60 * 1000,
  })
  // --json 的错误可能只写入 stdout；只检查 stderr 会丢失首次部署的真正原因。
  if (result.error || result.status !== 0) throw new WranglerCommandError(result, env)
  if (!capture) {
    if (result.stdout) process.stdout.write(redactOutput(result.stdout, env))
    if (result.stderr) process.stderr.write(redactOutput(result.stderr, env))
  }
  return result.stdout
}

export function isTransientError(error) {
  const message = error instanceof Error ? error.message : String(error)
  if (/authentication|authorization|unauthorized|forbidden|permission|invalid (?:api )?token|\b(?:401|403|10000|9109)\b|SQLITE_ERROR|no such (?:table|column)|syntax error|duplicate column|constraint failed/i.test(message)) {
    return false
  }
  return error?.code === 'ETIMEDOUT'
    || /fetch failed|network|socket|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|UND_ERR_|timed?\s*out|timeout|\b429\b|\b5(?:00|02|03|04|20|21|22|23|24)\b|too many requests|rate.?limit|temporarily unavailable|service unavailable|internal (?:server )?error|SQLITE_BUSY|database is locked|D1 DB is busy|D1_ERROR.*(?:overloaded|reset)|D1 reset before execute completed/i.test(message)
}

export async function withRetry(operation, {
  label = 'Cloudflare 操作',
  attempts = 5,
  shouldRetry = isTransientError,
  sleep = delay,
  random = Math.random,
  warn = console.warn,
} = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      if (attempt === attempts || !shouldRetry(error)) throw error
      const waitMs = Math.min(2000 * 2 ** (attempt - 1), 16000) + Math.floor(random() * 1000)
      warn(`[${label}] 暂时失败，${(waitMs / 1000).toFixed(1)} 秒后重试（${attempt + 1}/${attempts}）：\n${redactOutput(error.message)}`)
      await sleep(waitMs)
    }
  }
}

export function isMainModule(url) {
  return Boolean(process.argv[1]) && url === pathToFileURL(resolve(process.argv[1])).href
}

export function reportFailure(error) {
  console.error(`部署或迁移失败：${redactOutput(error instanceof Error ? error.message : error)}`)
  console.error('请检查上述具体原因。认证或权限错误需检查 Cloudflare 构建 API Token 的 D1 编辑权限；修复后重新运行 npm run deploy。')
  process.exitCode = 1
}
