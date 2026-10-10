import { vi } from 'vitest'
import type { OAuthAuth } from '@earendil-works/pi-ai'
export const sdk = { login: vi.fn<OAuthAuth['login']>(), refresh: vi.fn<OAuthAuth['refresh']>() }
