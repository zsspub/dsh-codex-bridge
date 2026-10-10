/** Standalone login page using the plugin's authenticated Connection routes. */
import type { ReactNode } from 'react'
import { LoginCard, type LoginCardProps } from './LoginCard.js'
import styles from './LoginCard.module.css'

/** Login dependencies and the connected page's remote-access guidance. */
export interface LoginSectionProps extends LoginCardProps { remote: boolean }

/** Render login independently of the host Models settings document.
 * @param props - Plugin API, localized copy and page access mode.
 * @returns Settings page available on both local and remote origins.
 */
export function LoginSection({ api, t, remote }: LoginSectionProps): ReactNode {
  return <div className={styles.section} data-codex-login-section="true">
    <h2 className={styles.title}>{t('nav')}</h2>
    {remote && <p className={styles.description}>{t('remoteHint')}</p>}
    <LoginCard api={api} t={t} />
  </div>
}
