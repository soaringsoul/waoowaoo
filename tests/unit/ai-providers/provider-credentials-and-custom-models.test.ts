import { describe, expect, it } from 'vitest'
import { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'
import { findBuiltinCapabilities } from '@/lib/ai-registry/capabilities-catalog'
import { normalizeProviderSecretForStorage } from '@/lib/user-api/api-config-provider-normalization'
import { ApiError } from '@/lib/api-errors'
import { listApiConfigCatalogProviders } from '@/lib/ai-registry/api-config-catalog'

ensureAiCatalogsRegistered()

describe('multi-provider catalog additions', () => {
  it('gives custom Codex and OpenAI-compatible LLMs an assistant-capable default', () => {
    expect(findBuiltinCapabilities('llm', 'codex', 'gpt-5.7-preview')?.llm).toMatchObject({
      protocol: 'openai-responses',
      codexRuntimeWireApi: 'responses',
    })
    expect(findBuiltinCapabilities('llm', 'openai-compatible:relay', 'deepseek-chat')?.llm).toMatchObject({
      protocol: 'openai-compatible-chat',
      codexRuntimeWireApi: 'responses',
    })
    expect(findBuiltinCapabilities('llm', 'openrouter', 'unknown/model')).toBeUndefined()
  })

  it('exposes Codex login, editable base URLs, and custom model types in the API config catalog', () => {
    const providers = new Map(listApiConfigCatalogProviders().map((provider) => [provider.id, provider]))
    expect(providers.get('codex')).toMatchObject({
      credentialInput: 'chatgpt-login',
      customModelTypes: ['llm'],
      baseUrl: 'https://chatgpt.com/backend-api/codex',
    })
    expect(providers.get('openai')).toMatchObject({ baseUrlEditable: true, baseUrl: 'https://api.openai.com/v1' })
    expect(providers.get('openai-compatible')).toMatchObject({ baseUrlEditable: true, customModelTypes: ['llm'] })
    for (const id of ['openrouter', 'ark']) expect(providers.has(id)).toBe(true)
  })

  it('canonicalizes ChatGPT credentials before encryption and leaves API keys untouched', () => {
    const credential = JSON.stringify({
      tokens: { access_token: 'at', refresh_token: 'rt', account_id: 'acct-9' },
    })
    expect(JSON.parse(normalizeProviderSecretForStorage('codex', credential))).toMatchObject({
      kind: 'chatgpt',
      accessToken: 'at',
      refreshToken: 'rt',
      accountId: 'acct-9',
    })
    expect(normalizeProviderSecretForStorage('openai', 'sk-test')).toBe('sk-test')
    try {
      normalizeProviderSecretForStorage('codex', 'sk-test')
      throw new Error('EXPECTED_INVALID_CREDENTIAL')
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError)
      expect((error as ApiError).details).toMatchObject({ code: 'PROVIDER_CREDENTIAL_INVALID', providerId: 'codex' })
    }
  })
})
