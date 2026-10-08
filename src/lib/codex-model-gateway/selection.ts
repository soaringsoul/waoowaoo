import { findBuiltinCapabilities } from '@/lib/ai-registry/capabilities-catalog'
import { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'
import { resolveLlmRuntimeModel } from '@/lib/ai-exec/llm-runtime'
import { getUserModelConfig } from '@/lib/config-service'
import { getProviderConfig } from '@/lib/user-api/runtime-config'
import { verifyWaoRuntimeToken } from '@/lib/wao-mcp/runtime-token'
import { resolveAiProviderAdapter } from '@/lib/ai-providers'
import { getProviderKey } from '@/lib/ai-registry/selection'
import { getBillingMode } from '@/lib/billing/mode'
import type { AiProviderAssistantGatewayUpstream } from '@/lib/ai-providers/runtime-types'
import {
  CODEX_MODEL_GATEWAY_ASSISTANT_ID,
  CODEX_MODEL_GATEWAY_PATH,
  CODEX_MODEL_GATEWAY_PROVIDER_ID,
  CODEX_RUNTIME_BEARER_ENV_KEY,
  CodexModelGatewayError,
  type CodexModelGatewayRuntimeConfig,
  type CodexModelGatewayScope,
} from './contracts'

function requireIdentity(value: string): string {
  if (!value || value !== value.trim()) {
    throw new CodexModelGatewayError('SCOPE_INVALID', 403)
  }
  return value
}

export function normalizeCodexModelGatewayScope(
  scope: CodexModelGatewayScope,
): CodexModelGatewayScope {
  const userId = requireIdentity(scope.userId)
  const projectId = requireIdentity(scope.projectId)
  if (scope.assistantId !== CODEX_MODEL_GATEWAY_ASSISTANT_ID) {
    throw new CodexModelGatewayError('SCOPE_INVALID', 403)
  }
  return {
    userId,
    projectId,
    assistantId: CODEX_MODEL_GATEWAY_ASSISTANT_ID,
  }
}

function parseBaseUrl(
  value: string,
  errorCode: 'PROVIDER_BASE_URL_INVALID' | 'RUNTIME_BASE_URL_INVALID',
): URL {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new CodexModelGatewayError(errorCode, 503)
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
  ) {
    throw new CodexModelGatewayError(errorCode, 503)
  }
  return parsed
}

function buildResponsesEndpoint(baseUrl: string): string {
  const parsed = parseBaseUrl(baseUrl, 'PROVIDER_BASE_URL_INVALID')
  parsed.pathname = `${parsed.pathname.replace(/\/+$/u, '')}/responses`
  return parsed.toString()
}

function buildRuntimeGatewayBaseUrl(runtimeReachableWaoBaseUrl: string): string {
  const parsed = parseBaseUrl(
    runtimeReachableWaoBaseUrl,
    'RUNTIME_BASE_URL_INVALID',
  )
  parsed.pathname = `${parsed.pathname.replace(/\/+$/u, '')}${CODEX_MODEL_GATEWAY_PATH}`
  return parsed.toString().replace(/\/$/u, '')
}

function resolveCodexRuntimeModelId(upstreamModelId: string): string {
  const openAiPrefix = 'openai/'
  if (upstreamModelId.startsWith(openAiPrefix)) {
    const modelId = upstreamModelId.slice(openAiPrefix.length)
    if (modelId) return modelId
  }
  return upstreamModelId
}

function defaultAssistantGatewayUpstream(input: {
  readonly providerKey: string
  readonly providerApiKey: string
  readonly providerBaseUrl: string
}): AiProviderAssistantGatewayUpstream {
  return {
    responsesEndpoint: buildResponsesEndpoint(input.providerBaseUrl),
    headers: {
      Authorization: `Bearer ${input.providerApiKey}`,
      'Content-Type': 'application/json',
    },
    // OpenRouter keeps its historic realtime cost settlement attachment.
    realtimeBilling: input.providerKey === 'openrouter' ? 'openrouter' : 'none',
  }
}

async function resolveSelectedAssistantModel(scope: CodexModelGatewayScope) {
  const config = await getUserModelConfig(scope.userId)
  const modelKey = config.assistantModel?.trim() || ''
  if (!modelKey) {
    throw new CodexModelGatewayError(
      'ASSISTANT_MODEL_NOT_CONFIGURED',
      422,
    )
  }

  let selection: Awaited<ReturnType<typeof resolveLlmRuntimeModel>>
  try {
    selection = await resolveLlmRuntimeModel(scope.userId, modelKey)
  } catch {
    throw new CodexModelGatewayError('ASSISTANT_MODEL_UNSUPPORTED', 422)
  }
  // Self-hosted billing is OFF and treats realtime settlement as a no-op.
  // Billed modes keep the historic OpenRouter-only assistant gate so
  // non-OpenRouter usage never bypasses OpenRouter realtime cost settlement.
  const billingMode = await getBillingMode()
  if (billingMode !== 'OFF' && selection.provider !== 'openrouter') {
    throw new CodexModelGatewayError(
      'PROVIDER_RESPONSES_UNSUPPORTED',
      422,
    )
  }
  ensureAiCatalogsRegistered()
  const providerKey = getProviderKey(selection.provider)
  const adapter = resolveAiProviderAdapter(providerKey)
  const codexRuntimeWireApi = findBuiltinCapabilities(
    'llm',
    selection.provider,
    selection.modelId,
  )?.llm?.codexRuntimeWireApi
  if (codexRuntimeWireApi !== 'responses') {
    throw new CodexModelGatewayError(
      'PROVIDER_RESPONSES_UNSUPPORTED',
      422,
    )
  }

  let providerConfig: Awaited<ReturnType<typeof getProviderConfig>>
  try {
    providerConfig = await getProviderConfig(
      scope.userId,
      selection.provider,
    )
  } catch {
    throw new CodexModelGatewayError(
      'PROVIDER_CONFIG_UNAVAILABLE',
      503,
    )
  }

  const providerOwned = adapter.assistantGateway?.resolveUpstream({
    providerConfig,
    modelId: selection.modelId,
  })
  const providerBaseUrl = providerConfig.baseUrl?.trim() || ''
  const upstream = providerOwned ?? (
    providerBaseUrl
      ? defaultAssistantGatewayUpstream({
          providerKey,
          providerApiKey: providerConfig.apiKey,
          providerBaseUrl,
        })
      : null
  )
  if (!upstream) {
    throw new CodexModelGatewayError('PROVIDER_BASE_URL_INVALID', 503)
  }
  if (upstream.realtimeBilling === 'openrouter' && providerKey !== 'openrouter') {
    throw new Error(`CODEX_GATEWAY_REALTIME_BILLING_PROVIDER_MISMATCH:${providerKey}`)
  }

  return {
    selection,
    providerKey,
    upstream,
  }
}

export async function resolveCodexModelGatewayUpstream(
  scopeValue: CodexModelGatewayScope,
): Promise<{
  readonly runtimeModelId: string
  readonly modelId: string
  readonly modelKey: string
  readonly providerKey: string
  readonly responsesEndpoint: string
  readonly headers: Readonly<Record<string, string>>
  readonly prepareBody?: (body: Record<string, unknown>) => void
  readonly realtimeBilling: 'openrouter' | 'none'
}> {
  const scope = normalizeCodexModelGatewayScope(scopeValue)
  const resolved = await resolveSelectedAssistantModel(scope)
  return {
    runtimeModelId: resolveCodexRuntimeModelId(resolved.selection.modelId),
    modelId: resolved.selection.modelId,
    modelKey: resolved.selection.modelKey,
    providerKey: resolved.providerKey,
    responsesEndpoint: resolved.upstream.responsesEndpoint,
    headers: resolved.upstream.headers,
    ...(resolved.upstream.prepareBody
      ? { prepareBody: resolved.upstream.prepareBody }
      : {}),
    realtimeBilling: resolved.upstream.realtimeBilling,
  }
}

/**
 * Produces the complete custom-provider projection consumed by the assistant
 * runtime. Provider credentials never cross this boundary; the returned token
 * is the exact Wao project capability already used by MCP.
 */
export async function resolveCodexModelGatewayRuntimeConfig(params: {
  readonly scope: CodexModelGatewayScope
  readonly runtimeReachableWaoBaseUrl: string
  readonly runtimeBearerToken: string
}): Promise<CodexModelGatewayRuntimeConfig> {
  const scope = normalizeCodexModelGatewayScope(params.scope)
  const tokenScope = verifyWaoRuntimeToken(params.runtimeBearerToken)
  if (
    tokenScope.userId !== scope.userId
    || tokenScope.projectId !== scope.projectId
    || tokenScope.assistantId !== scope.assistantId
  ) {
    throw new CodexModelGatewayError(
      'RUNTIME_TOKEN_SCOPE_MISMATCH',
      403,
    )
  }
  const resolved = await resolveSelectedAssistantModel(scope)
  return {
    runtimeModelId: resolveCodexRuntimeModelId(resolved.selection.modelId),
    modelId: resolved.selection.modelId,
    modelKey: resolved.selection.modelKey,
    modelProviderId: CODEX_MODEL_GATEWAY_PROVIDER_ID,
    baseUrl: buildRuntimeGatewayBaseUrl(
      params.runtimeReachableWaoBaseUrl,
    ),
    wireApi: 'responses',
    bearerTokenEnvironmentKey: CODEX_RUNTIME_BEARER_ENV_KEY,
    bearerToken: params.runtimeBearerToken,
    requestMaxRetries: 1,
    streamMaxRetries: 2,
  }
}
