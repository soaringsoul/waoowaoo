import { generateText } from 'ai'
import type {
  AiProviderAdapter,
  AiProviderConnectionTestStep,
  AiProviderLanguageModelContext,
} from '@/lib/ai-providers/runtime-types'
import { createAiProviderFailureAdapter } from '@/lib/ai-providers/failure'
import { createOpenAiStyleLanguageModel } from '@/lib/ai-providers/shared/openai-responses'
import { projectConnectionTestFailure } from '@/lib/ai-providers/shared/connection-test'
import { composeModelKey } from '@/lib/ai-registry/selection'
import { DEFAULT_REASONING_EFFORT } from '@/lib/ai-registry/reasoning-effort'
import {
  CodexCredentialError,
  isCodexAccessTokenFresh,
  parseCodexCredential,
  refreshCodexCredential,
  serializeCodexCredential,
} from './auth'
import {
  buildCodexBackendHeaders,
  createCodexBackendFetch,
  prepareCodexBackendBody,
} from './backend'
import { CODEX_DEFAULT_BASE_URL, CODEX_PROVIDER_TEST_LLM_MODEL_ID } from './models'

const codexFailureAdapter = createAiProviderFailureAdapter('codex')

function resolveCodexBaseUrl(baseUrl: string | undefined): string {
  const normalized = baseUrl?.trim().replace(/\/+$/u, '')
  return normalized || CODEX_DEFAULT_BASE_URL
}

function createCodexLanguageModel(input: AiProviderLanguageModelContext) {
  if (input.protocol !== 'openai-responses') {
    throw new Error(`LLM_PROTOCOL_PROVIDER_MISMATCH:codex:${input.protocol}`)
  }
  const bundle = parseCodexCredential(input.providerConfig.apiKey)
  const headers = buildCodexBackendHeaders(bundle)
  return createOpenAiStyleLanguageModel(input, {
    baseUrl: resolveCodexBaseUrl(input.providerConfig.baseUrl),
    apiKey: bundle.accessToken,
    headers: {
      'ChatGPT-Account-ID': headers['ChatGPT-Account-ID'],
      'OpenAI-Beta': headers['OpenAI-Beta'],
      originator: headers.originator,
      'User-Agent': headers['User-Agent'],
    },
    send: createCodexBackendFetch(),
  })
}

export const codexAdapter: AiProviderAdapter = {
  providerKey: 'codex',
  failure: codexFailureAdapter,
  credential: {
    platformCredentialsSupported: false,
    normalizeForStorage: (secret) => serializeCodexCredential(parseCodexCredential(secret)),
    resolveRuntimeSecret: async ({ secret, refreshUnderLock }) => {
      const bundle = parseCodexCredential(secret)
      if (isCodexAccessTokenFresh(bundle)) return secret
      return await refreshUnderLock(async (latestSecret) => {
        const latest = parseCodexCredential(latestSecret)
        if (isCodexAccessTokenFresh(latest)) return latestSecret
        return serializeCodexCredential(await refreshCodexCredential(latest))
      })
    },
  },
  assistantGateway: {
    resolveUpstream: ({ providerConfig }) => {
      const bundle = parseCodexCredential(providerConfig.apiKey)
      return {
        responsesEndpoint: `${resolveCodexBaseUrl(providerConfig.baseUrl)}/responses`,
        headers: buildCodexBackendHeaders(bundle),
        prepareBody: prepareCodexBackendBody,
        realtimeBilling: 'none',
      }
    },
  },
  languageModel: {
    create: createCodexLanguageModel,
  },
  connectionTest: {
    diagnose: async (input) => {
      const model = input.llmModel || CODEX_PROVIDER_TEST_LLM_MODEL_ID
      const steps: AiProviderConnectionTestStep[] = []
      let bundle: ReturnType<typeof parseCodexCredential>
      try {
        bundle = parseCodexCredential(input.apiKey)
        if (!isCodexAccessTokenFresh(bundle, Date.now() - 4 * 60 * 1000)) {
          throw new CodexCredentialError('access token expired; save the credential so it can be refreshed, or sign in again')
        }
      } catch (error) {
        steps.push({
          name: 'models',
          status: 'fail',
          messageKey: 'connectionTest.authInvalid',
          diagnostic: error instanceof Error ? error.message : String(error),
        })
        steps.push({ name: 'textGen', status: 'skip', messageKey: 'connectionTest.skippedModelsFailure', model })
        return { success: false, steps }
      }
      steps.push({
        name: 'models',
        status: 'pass',
        messageKey: 'connectionTest.modelsOk',
        diagnostic: [bundle.email, bundle.planType].filter(Boolean).join(' · ') || undefined,
      })
      try {
        const response = await generateText({
          model: createCodexLanguageModel({
            providerKey: 'codex',
            selection: { provider: 'codex', modelId: model, modelKey: composeModelKey('codex', model) },
            providerConfig: {
              id: 'codex',
              name: 'Codex',
              apiKey: input.apiKey,
              baseUrl: input.baseUrl,
            },
            protocol: 'openai-responses',
            publicReasoningMode: 'none',
            executionMode: 'sync',
            reasoning: false,
            reasoningEffort: DEFAULT_REASONING_EFFORT,
          }),
          prompt: '1+1=? Reply with only the number.',
          maxRetries: 0,
        })
        const answer = response.text.trim()
        steps.push({
          name: 'textGen',
          status: answer ? 'pass' : 'fail',
          messageKey: answer ? 'connectionTest.textGenerationOk' : 'connectionTest.emptyResponse',
          model: response.response.modelId || model,
        })
      } catch (error) {
        steps.push({
          name: 'textGen',
          status: 'fail',
          model,
          ...projectConnectionTestFailure(codexFailureAdapter, error),
        })
      }
      return { success: steps.every((step) => step.status !== 'fail'), steps }
    },
  },
}
