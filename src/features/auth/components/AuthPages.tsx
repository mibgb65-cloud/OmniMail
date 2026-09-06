import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Cloud,
  Globe2,
  Layers3,
  LoaderCircle,
  Monitor,
  Moon,
  RefreshCw,
  ShieldCheck,
  Sun,
} from 'lucide-react'
import {
  type FormEvent,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react'
import { api, type RegistrationDomainPolicy, type User } from '../../../shared/api'
import type { SetupRequirements } from '../../../shared/api'
import { errorMessage } from '../../../shared/api/errorMessage'
import { t } from '../../../shared/i18n'
import { AuthModal, type AuthMode } from './AuthModal'
export { AuthModal } from './AuthModal'
import {
  getThemePreference,
  setThemePreference,
  subscribeTheme,
} from '../../../shared/theme'
import { OmniLogo } from '../../../shared/ui/brand/OmniLogo'
import { LanguageToggle } from '../../../shared/ui/language/LanguageToggle'

export function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark" aria-hidden="true"><OmniLogo size={18} /></span>
      <span>OmniMail</span>
    </span>
  )
}

export function ThemeToggle({ labeled = false }: { labeled?: boolean }) {
  const preference = useSyncExternalStore(
    subscribeTheme,
    getThemePreference,
    getThemePreference,
  )
  const choices = [
    { value: 'light' as const, label: '亮色', Icon: Sun },
    { value: 'dark' as const, label: '暗色', Icon: Moon },
    { value: 'system' as const, label: '跟随系统', Icon: Monitor },
  ]
  return (
    <div
      className={`theme-selector ${labeled ? 'is-labeled' : ''}`}
      role="radiogroup"
      aria-label={t('界面主题')}
    >
      {choices.map(({ value, label, Icon }) => (
        <button
          className={preference === value ? 'is-selected' : ''}
          type="button"
          role="radio"
          aria-checked={preference === value}
          aria-label={t('{theme}主题', { theme: t(label) })}
          data-tooltip={t(label)}
          key={value}
          onClick={() => setThemePreference(value)}
        >
          <Icon size={15} />
          {labeled && <span>{t(label)}</span>}
        </button>
      ))}
    </div>
  )
}

export function PageLoader() {
  return (
    <div className="page-loader" role="status" aria-label={t('正在打开 OmniMail')}>
      <div className="opening-splash" aria-hidden="true">
        <span className="opening-splash__mark"><OmniLogo size={35} /></span>
        <span className="opening-splash__copy">
          <strong>OmniMail</strong>
          <small>YOUR DOMAINS · ONE INBOX</small>
        </span>
        <span className="opening-splash__track"><span /></span>
      </div>
      <span className="sr-only">{t('正在打开 OmniMail')}</span>
    </div>
  )
}

export function ConnectionError({ message, retry }: { message: string; retry: () => void }) {
  return (
    <main className="center-page">
      <section className="auth-card error-card">
        <span className="auth-symbol auth-symbol--danger"><AlertCircle size={27} /></span>
        <p className="eyebrow">CONNECTION ERROR</p>
        <h1>{t('暂时无法连接邮箱')}</h1>
        <p>{message}</p>
        <button className="button button--primary" type="button" onClick={retry}>
          <RefreshCw size={16} /> {t('重新连接')}
        </button>
      </section>
    </main>
  )
}

export function SetupPage({
  superAdminEmail = '',
  requirements,
  onAuthenticated,
}: {
  superAdminEmail?: string
  requirements: SetupRequirements
  onAuthenticated: (user: User) => void
}) {
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [setupToken, setSetupToken] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const readiness = [
    { label: t('D1 数据库'), ready: requirements.databaseReady },
    { label: t('R2 邮件存储'), ready: requirements.storageReady },
    { label: t('邮件解析队列'), ready: requirements.queueReady },
    { label: t('主管理员邮箱'), ready: requirements.superAdminReady },
    { label: t('初始化令牌'), ready: requirements.setupTokenReady },
  ]
  const deploymentReady = readiness.every((item) => item.ready)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const result = await api.setup({ displayName, password, setupToken })
      onAuthenticated(result.user)
    } catch (submitError) {
      setError(errorMessage(submitError))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-page__top">
        <Brand />
        <div><LanguageToggle /><ThemeToggle /></div>
      </div>
      <section className="auth-card setup-card">
        <span className="auth-symbol"><ShieldCheck size={27} /></span>
        <p className="eyebrow">FIRST RUN</p>
        <h1>{t('设置你的邮箱')}</h1>
        <p className="auth-lead">
          {t('为 Worker 中配置的主管理员创建密码。登录身份与域名收件地址相互独立。')}
        </p>

        <section className={`setup-readiness ${deploymentReady ? 'is-ready' : ''}`}>
          <header>
            <span><Cloud size={17} />{t('部署前置检查')}</span>
            <strong>{t(deploymentReady ? '可以继续' : '需要配置')}</strong>
          </header>
          <ul>
            {readiness.map((item) => (
              <li className={item.ready ? 'is-ready' : ''} key={item.label}>
                {item.ready ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
                <span>{item.label}</span>
                <small>{t(item.ready ? '已就绪' : '未检测到')}</small>
              </li>
            ))}
          </ul>
          {!deploymentReady && (
            <>
              <p>{t('请在 Worker 中补齐缺少的绑定或变量，重新部署后刷新此页面。检查结果不会包含 Secret 的实际内容。')}</p>
              <button
                className="button button--secondary setup-check-refresh"
                type="button"
                onClick={() => window.location.reload()}
              >
                <RefreshCw aria-hidden="true" size={15} />
                <span>{t('重新检查')}</span>
              </button>
            </>
          )}
        </section>

        <form className="auth-form" onSubmit={submit}>
          <label>
            <span>{t('显示名称')}</span>
            <input
              autoComplete="name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder={t('例如：Omni')}
              maxLength={60}
              required
            />
          </label>
          <div className="configured-admin">
            <span>{t('主管理员登录邮箱')}</span>
            <strong>{superAdminEmail || t('尚未配置 SUPER_ADMIN_EMAIL')}</strong>
          </div>
          <label>
            <span>{t('密码')}</span>
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={t('至少 10 个字符')}
              minLength={10}
              required
            />
          </label>
          <label>
            <span>{t('一次性设置令牌')}</span>
            <input
              type="password"
              autoComplete="off"
              value={setupToken}
              onChange={(event) => setSetupToken(event.target.value)}
              placeholder={t('Worker 中的 SETUP_TOKEN')}
              required
            />
          </label>
          {error && <p className="form-error" role="alert"><AlertCircle size={16} />{error}</p>}
          <button
            className="button button--primary auth-submit"
            type="submit"
            disabled={submitting || !deploymentReady}
          >
            {submitting && <LoaderCircle className="spin" size={17} />}
            {t('创建主管理员')}
          </button>
        </form>

        <div className="privacy-note">
          <ShieldCheck size={16} />
          <p>{t('密码经过 PBKDF2 派生后保存；邮件正文与附件保存在你的私有 Cloudflare R2 中。')}</p>
        </div>
      </section>
    </main>
  )
}

export function PublicLanding({
  appName,
  registrationEnabled,
  registrationMethod,
  linuxDoLoginEnabled,
  registrationDomainPolicy,
  turnstileSiteKey,
  onAuthenticated,
}: {
  appName: string
  registrationEnabled: boolean
  registrationMethod: 'password' | 'linuxdo'
  linuxDoLoginEnabled: boolean
  registrationDomainPolicy: RegistrationDomainPolicy
  turnstileSiteKey: string
  onAuthenticated: (user: User) => void
}) {
  const [authMode, setAuthMode] = useState<AuthMode | null>(() => (
    new URLSearchParams(window.location.search).has('auth_error')
      || new URLSearchParams(window.location.search).has('mfa_required')
      ? 'login'
      : null
  ))
  const closeModal = () => setAuthMode(null)

  return (
    <div className="public-landing">
      <header className="public-nav">
        <Brand />
        <div>
          <LanguageToggle />
          <ThemeToggle />
          <button className="button button--secondary" type="button" onClick={() => setAuthMode('login')}>
            {t('登录')}
          </button>
          {registrationEnabled && (
            <button className="button button--primary" type="button" onClick={() => setAuthMode('register')}>
              {t('创建账户')}
            </button>
          )}
        </div>
      </header>

      <main className="public-main">
        <section className="public-hero">
          <div className="public-hero__copy">
            <p className="eyebrow">YOUR DOMAINS · ONE INBOX</p>
            <h1>{t('把多个域名，收进一个清爽邮箱。')}</h1>
            <p>{t('基于 Cloudflare Workers、Static Assets、D1 与 R2 的轻量邮件工作台。集中管理域名、邮箱地址和访问权限。')}</p>
            <div className="public-hero__actions">
              <button className="button button--primary" type="button" onClick={() => setAuthMode('login')}>
                {t('进入邮箱')} <ArrowRight size={16} />
              </button>
              {registrationEnabled && (
                <button className="button button--secondary" type="button" onClick={() => setAuthMode('register')}>
                  {t('创建普通账户')}
                </button>
              )}
            </div>
            <small>
              {t(registrationEnabled
                ? registrationMethod === 'linuxdo'
                  ? '仅开放 Linux DO 注册；邮箱能力由管理员统一分配。'
                  : '外部注册已开放；邮箱能力由管理员统一分配。'
                : '当前仅允许管理员创建或邀请账户。')}
            </small>
          </div>

          <div className="public-mail-preview" aria-hidden="true">
            <header><Brand /><span>ALL MAILBOXES</span></header>
            <div className="public-mail-preview__body">
              <aside><span /><span /><span /><span /></aside>
              <div>
                <p><strong>{t('统一收件箱')}</strong><small>{t('3 个域名 · 8 个邮箱')}</small></p>
                <article><span>O</span><p><strong>Omni Updates</strong><small>{t('欢迎使用你的新邮箱工作台')}</small></p><time>{t('刚刚')}</time></article>
                <article><span>D</span><p><strong>Domain Notice</strong><small>{t('域名邮件路由已经连接')}</small></p><time>09:42</time></article>
                <article><span>T</span><p><strong>Team Inbox</strong><small>{t('权限设置已更新')}</small></p><time>{t('昨天')}</time></article>
              </div>
            </div>
          </div>
        </section>

        <section className="public-features" aria-label={t('主要能力')}>
          <article><Globe2 size={20} /><strong>{t('多域名统一管理')}</strong><p>{t('一个工作台管理多个域名与域名下的邮箱。')}</p></article>
          <article><Layers3 size={20} /><strong>{t('精细账户权限')}</strong><p>{t('区分管理员、普通用户与临时用户。')}</p></article>
          <article><Cloud size={20} /><strong>{t('Cloudflare 原生')}</strong><p>{t('邮件数据保留在你自己的 Cloudflare 资源中。')}</p></article>
        </section>
      </main>

      <footer className="public-footer">
        <Brand />
        <span>Private email workspace on Cloudflare.</span>
      </footer>

      {authMode && (
        <AuthModal
          key={authMode}
          mode={authMode}
          appName={appName}
          registrationEnabled={registrationEnabled}
          registrationMethod={registrationMethod}
          linuxDoLoginEnabled={linuxDoLoginEnabled}
          registrationDomainPolicy={registrationDomainPolicy}
          turnstileSiteKey={turnstileSiteKey}
          onModeChange={setAuthMode}
          onClose={closeModal}
          onAuthenticated={onAuthenticated}
        />
      )}
    </div>
  )
}
