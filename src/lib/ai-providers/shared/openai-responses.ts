import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type {
  AiProviderAssistantGateway,
  AiProviderLanguageModelContext,
} from '@/lib/ai-providers/runtime-types'
import { fetchWithProviderProxy } from '@/lib/http/outbound-proxy'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function requireProviderBaseUrl(baseUrl: string | undefined, providerKey: string, scope: string): string {
  const normalized = typeof baseUrl === 'string' ? baseUrl.trim().replace(/\/+$/u, '') : ''
  if (!normalized) throw new Error(`PROVIDER_BASE_URL_MISSING: ${providerKey} (${scope})`)
  let parsed: URL
  try {
    parsed = new URL(normalized)
  } catch {
    throw new Error(`PROVIDER_BASE_URL_INVALID: ${providerKey} (${scope})`)
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
  ) {
    throw new Error(`PROVIDER_BASE_URL_INVALID: ${providerKey} (${scope})`)
  }
  return normalized
}

/**
 * Assistant gateway contract for providers that serve the OpenAI Responses API
 * at `<baseUrl>/responses` with a Bearer API key (OpenAI, Ark, relays).
 */
export function createBearerResponsesAssistantGateway(providerKey: string): AiProviderAssistantGateway {
  return {
    resolveUpstream: ({ providerConfig }) => ({
      responsesEndpoint: `${requireProviderBaseUrl(providerConfig.baseUrl, providerKey, 'assistant')}/responses`,
      headers: {
        Authorization: `Bearer ${providerConfig.apiKey}`,
        'Content-Type': 'application/json',
      },
      realtimeBilling: 'none',
    }),
  }
}

async function readJsonRequestBody(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Record<string, unknown> | null> {
  const bodyText = typeof init?.body === 'string'
    ? init.body
    : typeof Request !== 'undefined' && input instanceof Request
      ? await input.clone().text()
      : ''
  if (!bodyText) return null
  try {
    const parsed: unknown = JSON.parse(bodyText)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Wraps fetch so provider code can adjust the JSON body the AI SDK produced
 * (reasoning effort, provider-required flags) without forking the SDK.
 */
export function createJsonBodyRewritingFetch(
  rewrite: (body: Record<string, unknown>) => void,
  send: typeof fetch = fetchWithProviderProxy as typeof fetch,
): typeof fetch {
  return (async (requestInput: RequestInfo | URL, requestInit?: RequestInit) => {
    const body = await readJsonRequestBody(requestInput, requestInit)
    if (!body) return await send(requestInput, requestInit)
    rewrite(body)
    const nextBody = JSON.stringify(body)
    if (typeof requestInit?.body === 'string') {
      return await send(requestInput, { ...requestInit, body: nextBody })
    }
    if (typeof Request !== 'undefined' && requestInput instanceof Request) {
      return await send(new Request(requestInput, { body: nextBody }), requestInit)
    }
    return await send(requestInput, { ...requestInit, body: nextBody })
  }) as typeof fetch
}

export function applyResponsesReasoning(
  body: Record<string, unknown>,
  input: Pick<AiProviderLanguageModelContext, 'reasoning' | 'reasoningEffort' | 'publicReasoningMode'>,
): void {
  if (!input.reasoning) return
  const current = isRecord(body.reasoning) ? body.reasoning : {}
  body.reasoning = {
    ...current,
    effort: input.reasoningEffort,
    ...(input.publicReasoningMode === 'summary_auto' ? { summary: 'auto' } : {}),
  }
}

/**
 * Language model for OpenAI-style providers. `openai-responses` uses the
 * Responses API; `openai-compatible-chat` uses Chat Completions for relays
 * that only implement that surface.
 */
export function createOpenAiStyleLanguageModel(
  input: AiProviderLanguageModelContext,
  options?: {
    readonly baseUrl?: string
    readonly apiKey?: string
    readonly headers?: Readonly<Record<string, string>>
    readonly rewriteResponsesBody?: (body: Record<string, unknown>) => void
    readonly send?: typeof fetch
  },
) {
  const baseURL = requireProviderBaseUrl(
    options?.baseUrl ?? input.providerConfig.baseUrl,
    input.providerKey,
    'language-model',
  )
  const apiKey = options?.apiKey ?? input.providerConfig.apiKey
  if (input.protocol === 'openai-responses') {
    const provider = createOpenAI({
      baseURL,
      apiKey,
      name: input.providerKey,
      ...(options?.headers ? { headers: { ...options.headers } } : {}),
      fetch: createJsonBodyRewritingFetch((body) => {
        applyResponsesReasoning(body, input)
        options?.rewriteResponsesBody?.(body)
      }, options?.send),
    })
    return provider.responses(input.selection.modelId)
  }
  if (input.protocol === 'openai-compatible-chat') {
    const provider = createOpenAICompatible({
      baseURL,
      apiKey,
      name: input.providerKey,
      includeUsage: true,
      ...(options?.headers ? { headers: { ...options.headers } } : {}),
      fetch: createJsonBodyRewritingFetch((body) => {
        if (input.reasoning) body.reasoning_effort = input.reasoningEffort
      }, options?.send),
    })
    return provider.chatModel(input.selection.modelId)
  }
  throw new Error(`LLM_PROTOCOL_PROVIDER_MISMATCH:${input.providerKey}:${input.protocol}`)
}
