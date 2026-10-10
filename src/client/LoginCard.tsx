/** Models settings card with Host-owned login progress. */
import { useEffect, useState, type ReactNode } from 'react'
import { Button, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { LoginMethod, LoginView } from '../protocol.js'
import { LoginActionError, type LoginApi } from './api.js'
import type { LoginKey } from './locales.js'
import styles from './LoginCard.module.css'

/** Props shared by the connected card and its pure presentation. */
export interface LoginCardProps { api: LoginApi; t: Translate<LoginKey> }
/** Snapshot and actions rendered by the Settings card. */
export interface LoginPanelProps {
  t: Translate<LoginKey>; status?: LoginView; busy: boolean; problem?: LoginKey
  onLogin(method: LoginMethod): void; onCancel(): void; onRefresh(): void
}

/** Render the login state and temporary device instructions with shared controls.
 * @param props - Safe status, localized copy and actions.
 * @returns Card for signed-out, pending or signed-in users.
 */
export function LoginPanel({ t, status, busy, problem, onLogin, onCancel, onRefresh }: LoginPanelProps): ReactNode {
  const pending = status?.phase === 'waiting'
  const badge = pending ? status?.device ? 'devicePending' : 'pending' : status?.authenticated ? 'signedIn' : status?.credential === 'expired' ? 'expired' : 'signedOut'
  const detail = pending ? status?.device ? 'deviceWaiting' : 'waiting' : status?.authenticated ? 'connected' : status?.credential === 'invalid' ? 'invalid' : 'instruction'
  const failure = problem ?? (!status?.authenticated && status?.phase === 'failed' ? status.failure ?? 'failed' : undefined)
  return <section className={styles.card} aria-label={t('title')} data-codex-login-card="true">
    <h3 className={styles.title}>{t('title')}</h3>
    <div className={styles.head}>
      <span className={styles.heading}>{t('heading')}</span>
      {status && <span role="status" className={styles.badge}><StateDot state={pending ? 'warning' : status.authenticated ? 'done' : 'idle'} />{t(badge)}</span>}
    </div>
    <p className={styles.description}>{t('description')}</p>
    {!status && !problem ? <div className={styles.loading}><StateDot state="ongoing" /></div> : <p className={styles.detail}>{t(detail)}</p>}
    {pending && status?.device && <div className={styles.device}>
      <span className={styles.description}>{t('deviceCode')}</span>
      <code className={styles.code}>{status.device.userCode}</code>
      <a className={styles.link} href={status.device.verificationURI} target="_blank" rel="noopener noreferrer">{t('openVerification')}</a>
    </div>}
    <div className={styles.notice} role={failure ? 'alert' : undefined}>{failure ? t(failure) : null}</div>
    <div className={styles.actions}>
      {status && !status.authenticated && !pending && <>
        <Button variant="primary" disabled={busy} onClick={() => onLogin('browser')}>{t('login')}</Button>
        <Button variant="outline" disabled={busy} onClick={() => onLogin('device')}>{t('deviceLogin')}</Button>
      </>}
      {pending && <Button variant="outline" disabled={busy} onClick={onCancel}>{t('cancel')}</Button>}
      <Button variant="outline" disabled={busy} onClick={onRefresh}>{t('refresh')}</Button>
    </div>
  </section>
}

/** Load status on mount/focus and poll sequentially only while awaiting login.
 * @param props - Shared API and locale dictionary binding.
 * @returns Connected Settings card; closing Settings leaves CLI login running.
 */
export function LoginCard({ api, t }: LoginCardProps): ReactNode {
  const [status, setStatus] = useState<LoginView>()
  const [problem, setProblem] = useState<LoginKey>()
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let reading = false
    const refresh = async (): Promise<void> => {
      if (reading || controller.signal.aborted) return
      reading = true
      if (timer) clearTimeout(timer)
      try {
        const next = await api.call('status', controller.signal)
        if (controller.signal.aborted) return
        setStatus(next); setProblem(undefined)
        if (next.phase === 'waiting') timer = setTimeout(() => { void refresh() }, 1000)
      } catch (_error) {
        if (!controller.signal.aborted) setProblem('queryFailure')
      } finally { reading = false }
    }
    const focus = (): void => { void refresh() }
    void refresh()
    window.addEventListener('focus', focus)
    return () => { controller.abort(); if (timer) clearTimeout(timer); window.removeEventListener('focus', focus) }
  }, [api, revision])
  const act = async (method: LoginMethod | 'cancel'): Promise<void> => {
    setBusy(true); setProblem(undefined)
    try { setStatus(await (method === 'cancel' ? api.call('login/cancel') : api.start(method))); setRevision(value => value + 1) } catch (error) {
      setProblem(error instanceof LoginActionError && error.code === 'CODEX_LOGIN_EXECUTABLE' ? 'executable'
        : error instanceof LoginActionError && error.code === 'CODEX_LOGIN_TIMEOUT' ? 'timeout' : 'failed')
    } finally { setBusy(false) }
  }
  return <LoginPanel t={t} status={status} busy={busy} problem={problem}
    onLogin={method => { void act(method) }} onCancel={() => { void act('cancel') }}
    onRefresh={() => { setRevision(value => value + 1) }} />
}
