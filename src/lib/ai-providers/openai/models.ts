import { usdToCredits } from '@/lib/ai-registry/pricing-currency'
import type { PlatformModelPreset } from '@/lib/platform-models/types'
import type { ReasoningEffort } from '@/lib/ai-registry/reasoning-effort'
import type { AiPublicReasoningMode } from '@/lib/ai-registry/types'
import { buildGptImage2OptionSchema } from '@/lib/ai-providers/shared/gpt-image-2'

/**
 * Official OpenAI API (api.openai.com) — user-selectable Responses LLMs plus
 * GPT Image 2. Hosted web search stays a platform-only specialist priced below;
 * it must never appear as an assistant model.
 */

export const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1'
export const OPENAI_WEB_SEARCH_MODEL_ID = 'gpt-5.6-luna'
export const OPENAI_PROVIDER_TEST_LLM_MODEL_ID = 'gpt-5.6-luna'

export const OPENAI_GPT_5_5_MODEL_ID = 'gpt-5.5'
export const OPENAI_GPT_5_6_LUNA_MODEL_ID = 'gpt-5.6-luna'
export const OPENAI_GPT_5_6_TERRA_MODEL_ID = 'gpt-5.6-terra'
export const OPENAI_GPT_5_6_SOL_MODEL_ID = 'gpt-5.6-sol'
export const OPENAI_GPT_IMAGE_2_MODEL_ID = 'gpt-image-2'

export const OPENAI_GPT_5_6_REASONING_EFFORT_OPTIONS = [
  'medium',
  'low',
  'high',
  'xhigh',
  'max',
  'none',
] as const satisfies readonly ReasoningEffort[]

export const OPENAI_GPT_IMAGE_2_QUALITY_OPTIONS = ['high', 'medium', 'low'] as const
export const OPENAI_GPT_IMAGE_2_ASPECT_RATIO_OPTIONS = [
  '1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16',
] as const

const INPUT_USD_PER_MILLION_TOKENS = 0.2
const OUTPUT_USD_PER_MILLION_TOKENS = 1.2
const WEB_SEARCH_CALL_USD_PER_MILLION_CALLS = 10 * 1_000

type OpenAiLlmModelDefinition = {
  modelId: string
  name: string
  pricingUsdPerMillion: readonly [input: number, output: number]
  publicReasoningMode: Exclude<AiPublicReasoningMode, 'none'>
  reasoningEffortOptions: readonly [ReasoningEffort, ...ReasoningEffort[]]
  defaultReasoningEffort: ReasoningEffort
  contextWindow: number
  showInApiConfig: boolean
}

export const OPENAI_LLM_MODEL_DEFINITIONS = [
  {
    modelId: OPENAI_GPT_5_5_MODEL_ID,
    name: 'GPT-5.5',
    pricingUsdPerMillion: [5, 30],
    publicReasoningMode: 'summary_auto',
    reasoningEffortOptions: ['none', 'low', 'medium', 'high', 'xhigh'],
    defaultReasoningEffort: 'medium',
    contextWindow: 1_050_000,
    showInApiConfig: false,
  },
  {
    modelId: OPENAI_GPT_5_6_LUNA_MODEL_ID,
    name: 'GPT-5.6 Luna',
    pricingUsdPerMillion: [0.2, 1.2],
    publicReasoningMode: 'summary_auto',
    reasoningEffortOptions: OPENAI_GPT_5_6_REASONING_EFFORT_OPTIONS,
    defaultReasoningEffort: 'medium',
    contextWindow: 1_050_000,
    showInApiConfig: true,
  },
  {
    modelId: OPENAI_GPT_5_6_TERRA_MODEL_ID,
    name: 'GPT-5.6 Terra',
    pricingUsdPerMillion: [2, 12],
    publicReasoningMode: 'summary_auto',
    reasoningEffortOptions: OPENAI_GPT_5_6_REASONING_EFFORT_OPTIONS,
    defaultReasoningEffort: 'medium',
    contextWindow: 1_050_000,
    showInApiConfig: true,
  },
  {
    modelId: OPENAI_GPT_5_6_SOL_MODEL_ID,
    name: 'GPT-5.6 Sol',
    pricingUsdPerMillion: [2, 10],
    publicReasoningMode: 'summary_auto',
    reasoningEffortOptions: OPENAI_GPT_5_6_REASONING_EFFORT_OPTIONS,
    defaultReasoningEffort: 'medium',
    contextWindow: 1_050_000,
    showInApiConfig: true,
  },
] as const satisfies readonly OpenAiLlmModelDefinition[]

function openAiTokenPricing(inputUsdPerMillion: number, outputUsdPerMillion: number) {
  return {
    mode: 'capability' as const,
    tiers: [
      { when: { tokenType: 'input' }, amount: usdToCredits(inputUsdPerMillion) },
      { when: { tokenType: 'output' }, amount: usdToCredits(outputUsdPerMillion) },
    ],
  }
}

function openAiGptImage2Pricing() {
  const rows = [
    ['1024x768', { low: 0.005, medium: 0.037, high: 0.145 }],
    ['1024x1024', { low: 0.006, medium: 0.053, high: 0.211 }],
    ['1024x1536', { low: 0.005, medium: 0.042, high: 0.165 }],
    ['1920x1080', { low: 0.005, medium: 0.040, high: 0.158 }],
  ] as const
  return {
    mode: 'capability' as const,
    tiers: rows.flatMap(([imageSize, prices]) => [
      { when: { imageSize, quality: 'low' }, amount: usdToCredits(prices.low) },
      { when: { imageSize, quality: 'medium' }, amount: usdToCredits(prices.medium) },
      { when: { imageSize, quality: 'high' }, amount: usdToCredits(prices.high) },
    ]),
  }
}

// The web-search specialist entry below already prices gpt-5.6-luna tokens at
// the same rates (plus tool calls); one model id must have exactly one entry.
const OPENAI_LLM_PRICING = OPENAI_LLM_MODEL_DEFINITIONS
  .filter((model) => model.modelId !== OPENAI_WEB_SEARCH_MODEL_ID)
  .map((model) => {
  const [inputUsd, outputUsd] = model.pricingUsdPerMillion
  return {
    apiType: 'text' as const,
    provider: 'openai',
    modelId: model.modelId,
    cost: openAiTokenPricing(inputUsd, outputUsd),
  }
})

const OPENAI_LLM_CAPABILITIES = OPENAI_LLM_MODEL_DEFINITIONS.map((model) => ({
  modelType: 'llm' as const,
  provider: 'openai',
  modelId: model.modelId,
  capabilities: {
    llm: {
      protocol: 'openai-responses' as const,
      codexRuntimeWireApi: 'responses' as const,
      publicReasoningMode: model.publicReasoningMode,
      reasoningEffortOptions: [...model.reasoningEffortOptions],
      defaultReasoningEffort: model.defaultReasoningEffort,
      contextWindow: model.contextWindow,
    },
  },
}))

const OPENAI_LLM_API_CONFIG = OPENAI_LLM_MODEL_DEFINITIONS
  .filter((model) => model.showInApiConfig)
  .map((model) => ({
    modelId: model.modelId,
    name: model.name,
    type: 'llm' as const,
    provider: 'openai',
  }))

export const OPENAI_BUILTIN_PRICING_CATALOG_ENTRIES = [
  {
    apiType: 'text' as const,
    provider: 'openai',
    modelId: OPENAI_WEB_SEARCH_MODEL_ID,
    cost: {
      mode: 'capability' as const,
      tiers: [
        { when: { tokenType: 'input' }, amount: usdToCredits(INPUT_USD_PER_MILLION_TOKENS) },
        { when: { tokenType: 'output' }, amount: usdToCredits(OUTPUT_USD_PER_MILLION_TOKENS) },
        { when: { tokenType: 'toolCall' }, amount: usdToCredits(WEB_SEARCH_CALL_USD_PER_MILLION_CALLS) },
      ],
    },
  },
  ...OPENAI_LLM_PRICING,
  {
    apiType: 'image' as const,
    provider: 'openai',
    modelId: OPENAI_GPT_IMAGE_2_MODEL_ID,
    cost: openAiGptImage2Pricing(),
  },
] as const

export const OPENAI_BUILTIN_CAPABILITY_CATALOG_ENTRIES = [
  ...OPENAI_LLM_CAPABILITIES,
  {
    modelType: 'image' as const,
    provider: 'openai',
    modelId: OPENAI_GPT_IMAGE_2_MODEL_ID,
    capabilities: {
      image: {
        resolutionOptions: ['1K'],
        maxReferenceImages: 16,
        qualityOptions: [...OPENAI_GPT_IMAGE_2_QUALITY_OPTIONS],
      },
    },
  },
] as const

export const OPENAI_API_CONFIG_CATALOG_MODELS = [
  ...OPENAI_LLM_API_CONFIG,
  {
    modelId: OPENAI_GPT_IMAGE_2_MODEL_ID,
    name: 'GPT Image 2',
    type: 'image' as const,
    provider: 'openai',
  },
] as const

export const OPENAI_PLATFORM_MODEL_PRESETS: readonly PlatformModelPreset[] = []

export function resolveOpenAiOptionSchema(modality: 'image' | 'video' | 'music' | 'voice', modelId?: string) {
  if (modality !== 'image' || modelId !== OPENAI_GPT_IMAGE_2_MODEL_ID) {
    throw new Error(`OPENAI_OPTION_SCHEMA_UNSUPPORTED:${modality}:${modelId || '<missing>'}`)
  }
  return buildGptImage2OptionSchema({
    resolutionOptions: ['1K'],
    aspectRatioOptions: OPENAI_GPT_IMAGE_2_ASPECT_RATIO_OPTIONS,
    qualityOptions: OPENAI_GPT_IMAGE_2_QUALITY_OPTIONS,
    defaultResolution: '1K',
    defaultQuality: 'high',
    defaultOutputFormat: 'png',
    maxReferenceImages: 16,
    excludedKeys: ['keepOriginalAspectRatio', 'responseFormat'],
  })
}
