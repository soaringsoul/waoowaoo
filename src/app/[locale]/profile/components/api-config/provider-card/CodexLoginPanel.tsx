'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import { useToast } from '@/contexts/ToastContext'
import type { ProviderCardTranslator } from './types'

interface CodexLoginStart {
  loginToken: string
  userCode: string
  verificationUrl: string
  intervalSeconds: number
  expiresAt: number
}

type CodexLoginPollResult =
  | { status: 'pending' }
  | { status: 'expired' }
  | { status: 'complete'; account?: { email?: string; planType?: string } }

interface CodexLoginPanelProps {
  providerId: string
  t: ProviderCardTranslator
  onCredentialStored?: (providerId: string) => void
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `HTTP ${response.status}`
    try {
      const payload = await response.json() as { error?: { message?: string }; message?: string }
      message = payload.error?.message || payload.message || message
    } catch {
      // keep the HTTP status message
    }
    throw new Error(message)
  }
  return await response.json() as T
}

/**
 * "Sign in with ChatGPT" via OpenAI's device-code flow. Tokens are exchanged
 * and stored by the server; the browser only sees the one-time user code.
 */
export function CodexLoginPanel({ providerId, t, onCredentialStored }: CodexLoginPanelProps) {
  const { showToast } = useToast()
  const [login, setLogin] = useState<CodexLoginStart | null>(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cancelledRef = useRef(false)

  const stopPolling = useCallback(() => {
    cancelledRef.current = true
  }, [])

  useEffect(() => stopPolling, [stopPolling])

  const waitForApproval = useCallback(async (ticket: CodexLoginStart) => {
    const intervalMs = Math.max(ticket.intervalSeconds, 2) * 1000
    while (!cancelledRef.current) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
      if (cancelledRef.current) return
      try {
        const result = await readJson<CodexLoginPollResult>(await apiFetch('/api/user/api-config/codex-login/poll', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ loginToken: ticket.loginToken }),
        }))
        if (cancelledRef.current) return
        if (result.status === 'pending') continue
        setLogin(null)
        if (result.status === 'expired') {
          setError(t('codexLogin.expired'))
          return
        }
        onCredentialStored?.(providerId)
        const account = [result.account?.email, result.account?.planType].filter(Boolean).join(' · ')
        showToast(account ? t('codexLogin.successWithAccount', { account }) : t('codexLogin.success'), 'success')
        return
      } catch (pollError) {
        if (cancelledRef.current) return
        setLogin(null)
        setError(pollError instanceof Error ? pollError.message : String(pollError))
        return
      }
    }
  }, [onCredentialStored, providerId, showToast, t])

  const start = useCallback(async () => {
    stopPolling()
    setError(null)
    setStarting(true)
    let ticket: CodexLoginStart
    try {
      ticket = await readJson<CodexLoginStart>(await apiFetch('/api/user/api-config/codex-login/start', {
        method: 'POST',
      }))
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : String(startError))
      return
    } finally {
      setStarting(false)
    }
    cancelledRef.current = false
    setLogin(ticket)
    void waitForApproval(ticket)
  }, [stopPolling, waitForApproval])

  const cancel = useCallback(() => {
    stopPolling()
    setLogin(null)
  }, [stopPolling])

  return (
    <div className="space-y-2">
      {!login && (
        <button
          type="button"
          onClick={() => { void start() }}
          disabled={starting}
          className="glass-btn-base glass-btn-primary px-2.5 py-1.5 text-xs"
        >
          <AppIcon name={starting ? 'refresh' : 'externalLink'} className="h-3.5 w-3.5" />
          {t('codexLogin.signIn')}
        </button>
      )}
      {login && (
        <div className="glass-surface-soft space-y-2 rounded-xl px-3 py-2 text-xs text-[var(--glass-text-secondary)]">
          <p>{t('codexLogin.instructions')}</p>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={login.verificationUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="glass-btn-base glass-btn-soft px-2.5 py-1.5 text-xs"
            >
              <AppIcon name="externalLink" className="h-3.5 w-3.5" />
              {t('codexLogin.openPage')}
            </a>
            <code className="rounded-md bg-[var(--glass-bg-surface-strong)] px-2 py-1 text-sm font-semibold tracking-widest text-[var(--glass-text-primary)]">
              {login.userCode}
            </code>
            <span className="text-[var(--glass-text-tertiary)]">{t('codexLogin.waiting')}</span>
            <button type="button" onClick={cancel} className="glass-btn-base glass-btn-soft px-2 py-1 text-xs">
              {t('cancel')}
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="text-xs text-[var(--glass-tone-danger-fg)]">{t('codexLogin.failed', { message: error })}</p>
      )}
      <p className="text-[11px] text-[var(--glass-text-tertiary)]">{t('codexLogin.rotationWarning')}</p>
    </div>
  )
}
