import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  assistantModel: '',
  provider: '',
  modelId: '',
  providerConfig: { id: '', name: '', apiKey: '', baseUrl: undefined as string | undefined },
  billingMode: 'OFF' as 'OFF' | 'SHADOW' | 'ENFORCE',
  getProviderConfig: vi.fn(),
}))

vi.mock('@/lib/config-service', () => ({
  getUserModelConfig: async () => ({ assistantModel: mocks.assistantModel }),
}))
vi.mock('@/lib/ai-exec/llm-runtime', () => ({
  resolveLlmRuntimeModel: async (_userId: string, modelKey: string) => ({
    provider: mocks.provider,
    modelId: mocks.modelId,
    modelKey,
  }),
}))
vi.mock('@/lib/user-api/runtime-config', () => ({
  getProviderConfig: mocks.getProviderConfig,
}))
vi.mock('@/lib/billing/mode', () => ({
  getBillingMode: async () => mocks.billingMode,
}))

import { resolveCodexModelGatewayUpstream } from '@/lib/codex-model-gateway/selection'

function jwt(claims: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'none' })}.${encode(claims)}.sig`
}

const scope = { userId: 'user-1', projectId: 'project-1', assistantId: 'workspace-command' } as const

function select(provider: string, modelId: string, providerConfig: Partial<typeof mocks.providerConfig>) {
  mocks.provider = provider
  mocks.modelId = modelId
  mocks.assistantModel = `${provider}::${modelId}`
  mocks.providerConfig = { id: provider, name: provider, apiKey: 'key', baseUrl: undefined, ...providerConfig }
}

describe('Codex model gateway provider selection', () => {
  beforeEach(() => {
    mocks.billingMode = 'OFF'
    mocks.getProviderConfig.mockReset()
    mocks.getProviderConfig.mockImplementation(async () => mocks.providerConfig)
  })

  it('keeps OpenRouter on its responses endpoint with realtime billing attached', async () => {
    select('openrouter', 'openai/gpt-5.5', { apiKey: 'or-key', baseUrl: 'https://openrouter.ai/api/v1' })
    const upstream = await resolveCodexModelGatewayUpstream(scope)
    expect(upstream).toMatchObject({
      providerKey: 'openrouter',
      runtimeModelId: 'gpt-5.5',
      responsesEndpoint: 'https://openrouter.ai/api/v1/responses',
      realtimeBilling: 'openrouter',
    })
    expect(upstream.headers.Authorization).toBe('Bearer or-key')
  })

  it('routes OpenAI API keys to the official Responses API', async () => {
    select('openai', 'gpt-5.6-sol', { apiKey: 'sk-test', baseUrl: 'https://api.openai.com/v1' })
    const upstream = await resolveCodexModelGatewayUpstream(scope)
    expect(upstream).toMatchObject({
      providerKey: 'openai',
      responsesEndpoint: 'https://api.openai.com/v1/responses',
      realtimeBilling: 'none',
    })
    expect(upstream.headers.Authorization).toBe('Bearer sk-test')
  })

  it('routes ChatGPT-login Codex credentials to the ChatGPT Codex backend', async () => {
    const credential = JSON.stringify({
      kind: 'chatgpt',
      accessToken: jwt({ exp: Math.floor(Date.now() / 1000) + 3600 }),
      refreshToken: 'rt',
      accountId: 'acct-1',
      expiresAt: Date.now() + 3600_000,
    })
    select('codex', 'gpt-5.6-sol', { apiKey: credential, baseUrl: 'https://chatgpt.com/backend-api/codex' })
    const upstream = await resolveCodexModelGatewayUpstream(scope)
    expect(upstream).toMatchObject({
      providerKey: 'codex',
      responsesEndpoint: 'https://chatgpt.com/backend-api/codex/responses',
      realtimeBilling: 'none',
    })
    expect(upstream.headers['ChatGPT-Account-ID']).toBe('acct-1')
    const body: Record<string, unknown> = { input: [{ role: 'developer', content: 'rules' }], max_output_tokens: 3 }
    upstream.prepareBody?.(body)
    expect(body).toMatchObject({ instructions: 'rules', input: [], store: false, stream: true })
  })

  it('accepts custom model ids on OpenAI-compatible endpoints', async () => {
    select('openai-compatible:relay', 'my-model', { apiKey: 'relay-key', baseUrl: 'https://relay.example.com/v1/' })
    const upstream = await resolveCodexModelGatewayUpstream(scope)
    expect(upstream.responsesEndpoint).toBe('https://relay.example.com/v1/responses')
    expect(upstream.realtimeBilling).toBe('none')
  })

  it('rejects models without a Responses route before reading credentials', async () => {
    select('google', 'gemini-3.1-flash-lite-preview', { apiKey: 'g' })
    await expect(resolveCodexModelGatewayUpstream(scope)).rejects.toMatchObject({
      code: 'PROVIDER_RESPONSES_UNSUPPORTED',
    })
    expect(mocks.getProviderConfig).not.toHaveBeenCalled()
  })

  it('keeps billed deployments on the historic OpenRouter-only gate', async () => {
    mocks.billingMode = 'ENFORCE'
    select('openai', 'gpt-5.6-sol', { apiKey: 'sk-test', baseUrl: 'https://api.openai.com/v1' })
    await expect(resolveCodexModelGatewayUpstream(scope)).rejects.toMatchObject({
      code: 'PROVIDER_RESPONSES_UNSUPPORTED',
    })
    expect(mocks.getProviderConfig).not.toHaveBeenCalled()
  })
})
