'use client'

import { useState } from 'react'
import type { ProviderCardProps, ProviderCardTranslator } from './types'
import type { UseProviderCardStateResult } from './hooks/useProviderCardState'
import { AppIcon } from '@/components/ui/icons'
import { CodexLoginPanel } from './CodexLoginPanel'

interface ProviderBaseFieldsProps {
  provider: ProviderCardProps['provider']
  t: ProviderCardTranslator
  state: UseProviderCardStateResult
  onUpdateBaseUrl?: ProviderCardProps['onUpdateBaseUrl']
  onCredentialStored?: ProviderCardProps['onCredentialStored']
}

function BaseUrlField({
  provider,
  t,
  onUpdateBaseUrl,
}: {
  provider: ProviderCardProps['provider']
  t: ProviderCardTranslator
  onUpdateBaseUrl: NonNullable<ProviderCardProps['onUpdateBaseUrl']>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(provider.baseUrl ?? '')
  return (
    <div className="glass-surface-soft flex items-center gap-3 rounded-xl px-3 py-2">
      <span className="shrink-0 text-xs font-medium text-[var(--glass-text-secondary)]">{t('baseUrl')}</span>
      {editing ? (
        <form
          className="flex min-w-0 flex-1 items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            onUpdateBaseUrl(provider.id, draft.trim())
            setEditing(false)
          }}
        >
          <input
            type="url"
            autoComplete="off"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={t('baseUrlPlaceholder')}
            aria-label={t('baseUrl')}
            className="glass-input-base min-w-0 flex-1 px-3 py-1.5 text-xs"
            autoFocus
          />
          <button type="submit" className="glass-icon-btn-sm" aria-label={t('save')}>
            <AppIcon name="check" className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => { setDraft(provider.baseUrl ?? ''); setEditing(false) }}
            className="glass-icon-btn-sm"
            aria-label={t('cancel')}
          >
            <AppIcon name="close" className="h-4 w-4" />
          </button>
        </form>
      ) : (
        <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
          <span className="truncate text-xs text-[var(--glass-text-tertiary)]">
            {provider.baseUrl || t('notConfigured')}
          </span>
          <button
            type="button"
            onClick={() => { setDraft(provider.baseUrl ?? ''); setEditing(true) }}
            className="glass-btn-base glass-btn-soft px-2.5 py-1.5 text-xs"
          >
            <AppIcon name={provider.baseUrl ? 'edit' : 'plus'} className="h-3.5 w-3.5" />
            {t('configureBaseUrl')}
          </button>
        </div>
      )}
    </div>
  )
}

export function ProviderBaseFields({ provider, t, state, onUpdateBaseUrl, onCredentialStored }: ProviderBaseFieldsProps) {
  const usesChatGptLogin = provider.credentialInput === 'chatgpt-login'
  return (
    <div className="space-y-2 px-4 pt-3">
      {provider.baseUrlEditable && onUpdateBaseUrl && (
        <BaseUrlField provider={provider} t={t} onUpdateBaseUrl={onUpdateBaseUrl} />
      )}
      {usesChatGptLogin && (
        <CodexLoginPanel providerId={provider.id} t={t} onCredentialStored={onCredentialStored} />
      )}
      <div className="glass-surface-soft flex items-center gap-3 rounded-xl px-3 py-2">
        <span className="shrink-0 text-xs font-medium text-[var(--glass-text-secondary)]">
          {usesChatGptLogin ? t('codexLogin.credentialLabel') : t('apiKeyLabel')}
        </span>
        {state.isEditing ? (
          <form
            className="flex min-w-0 flex-1 items-center gap-2"
            onSubmit={(event) => { event.preventDefault(); state.handleSaveKey() }}
          >
            <input
              type="password"
              autoComplete="off"
              value={state.tempKey}
              onChange={(event) => state.setTempKey(event.target.value)}
              placeholder={usesChatGptLogin ? t('codexLogin.pastePlaceholder') : t('enterApiKey')}
              aria-label={usesChatGptLogin ? t('codexLogin.credentialLabel') : t('apiKeyLabel')}
              className="glass-input-base min-w-0 flex-1 px-3 py-1.5 text-xs"
              autoFocus
            />
            <button type="submit" className="glass-icon-btn-sm" aria-label={t('save')}>
              <AppIcon name="check" className="h-4 w-4" />
            </button>
            <button type="button" onClick={state.handleCancelEdit} className="glass-icon-btn-sm" aria-label={t('cancel')}>
              <AppIcon name="close" className="h-4 w-4" />
            </button>
          </form>
        ) : (
          <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
            <span className="text-xs text-[var(--glass-text-tertiary)]">
              {provider.hasApiKey
                ? (usesChatGptLogin ? t('codexLogin.connected') : t('keyConfigured'))
                : t('notConfigured')}
            </span>
            <button type="button" onClick={state.startEditKey} className="glass-btn-base glass-btn-soft px-2.5 py-1.5 text-xs">
              <AppIcon name={provider.hasApiKey ? 'edit' : 'plus'} className="h-3.5 w-3.5" />
              {usesChatGptLogin
                ? t('codexLogin.pasteAuthJson')
                : (provider.hasApiKey ? t('configure') : t('configureApiKey'))}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
