import type { ReasoningEffort } from '@/lib/ai-registry/reasoning-effort'
import { resolveOpenAiOptionSchema } from '@/lib/ai-providers/openai/models'

/**
 * OpenAI-compatible endpoints (new-api / one-api, LiteLLM, vLLM, Azure-style
 * relays, DashScope / DeepSeek / Moonshot / Zhipu / MiniMax compatible mode).
 *
 * Text tasks use Chat Completions, which every compatible server implements.
 * The Assistant needs the Responses API: it works only when the endpoint also
 * serves `POST <baseUrl>/responses` (new-api, LiteLLM, OpenAI, DashScope and
 * others do); otherwise the Assistant reports the provider error.
 * Prices are unknown for arbitrary relays and are registered as zero; the
 * self-hosted edition does not bill.
 */

export const OPENAI_COMPATIBLE_PROVIDER_KEY = 'openai-compatible'
export const OPENAI_COMPATIBLE_TEST_LLM_MODEL_ID = 'gpt-5.5'
export const OPENAI_COMPATIBLE_GPT_IMAGE_2_MODEL_ID = 'gpt-image-2'

const REASONING_EFFORT_OPTIONS = ['medium', 'low', 'high'] as const satisfies readonly ReasoningEffort[]

const RELAY_LLM_CAPABILITIES = {
  llm: {
    protocol: 'openai-compatible-chat' as const,
    codexRuntimeWireApi: 'responses' as const,
    publicReasoningMode: 'native' as const,
    reasoningEffortOptions: [...REASONING_EFFORT_OPTIONS],
    defaultReasoningEffort: 'medium' as const,
    contextWindow: 128_000,
  },
}

const PRESET_LLMS = [
  { modelId: 'gpt-5.5', name: 'gpt-5.5' },
] as const

const ZERO_TOKEN_PRICING = {
  mode: 'capability' as const,
  tiers: [
    { when: { tokenType: 'input' }, amount: 0 },
    { when: { tokenType: 'output' }, amount: 0 },
  ],
}

export const OPENAI_COMPATIBLE_CAPABILITY_CATALOG_ENTRIES = [
  ...PRESET_LLMS.map((model) => ({
    modelType: 'llm' as const,
    provider: OPENAI_COMPATIBLE_PROVIDER_KEY,
    modelId: model.modelId,
    capabilities: RELAY_LLM_CAPABILITIES,
  })),
  {
    modelType: 'image' as const,
    provider: OPENAI_COMPATIBLE_PROVIDER_KEY,
    modelId: OPENAI_COMPATIBLE_GPT_IMAGE_2_MODEL_ID,
    capabilities: {
      image: {
        resolutionOptions: ['1K'],
        maxReferenceImages: 16,
        qualityOptions: ['high', 'medium', 'low'],
      },
    },
  },
] as const

export const OPENAI_COMPATIBLE_PRICING_CATALOG_ENTRIES = [
  ...PRESET_LLMS.map((model) => ({
    apiType: 'text' as const,
    provider: OPENAI_COMPATIBLE_PROVIDER_KEY,
    modelId: model.modelId,
    cost: ZERO_TOKEN_PRICING,
  })),
  {
    apiType: 'image' as const,
    provider: OPENAI_COMPATIBLE_PROVIDER_KEY,
    modelId: OPENAI_COMPATIBLE_GPT_IMAGE_2_MODEL_ID,
    cost: { mode: 'flat' as const, flatAmount: 0 },
  },
] as const

export const OPENAI_COMPATIBLE_API_CONFIG_CATALOG_MODELS = [
  ...PRESET_LLMS.map((model) => ({
    modelId: model.modelId,
    name: model.name,
    type: 'llm' as const,
    provider: OPENAI_COMPATIBLE_PROVIDER_KEY,
  })),
  {
    modelId: OPENAI_COMPATIBLE_GPT_IMAGE_2_MODEL_ID,
    name: 'gpt-image-2',
    type: 'image' as const,
    provider: OPENAI_COMPATIBLE_PROVIDER_KEY,
  },
] as const

export const OPENAI_COMPATIBLE_CUSTOM_MODEL_CAPABILITIES = [
  {
    provider: OPENAI_COMPATIBLE_PROVIDER_KEY,
    modelType: 'llm' as const,
    capabilities: RELAY_LLM_CAPABILITIES,
  },
] as const

export function resolveOpenAiCompatibleOptionSchema(modality: 'image' | 'video' | 'music' | 'voice', modelId?: string) {
  if (modality !== 'image' || modelId !== OPENAI_COMPATIBLE_GPT_IMAGE_2_MODEL_ID) {
    throw new Error(`OPENAI_COMPATIBLE_OPTION_SCHEMA_UNSUPPORTED:${modality}:${modelId || '<missing>'}`)
  }
  return resolveOpenAiOptionSchema('image', 'gpt-image-2')
}
