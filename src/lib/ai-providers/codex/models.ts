import type { ReasoningEffort } from '@/lib/ai-registry/reasoning-effort'
import type { AiPublicReasoningMode } from '@/lib/ai-registry/types'

/**
 * Models served by the ChatGPT Codex backend for a signed-in ChatGPT plan.
 * Usage is covered by the ChatGPT subscription, so the catalog price is zero
 * (self-hosted billing is OFF; cloud editions keep Codex hidden from the
 * assistant gate, see codex-model-gateway/selection.ts).
 * Which models a plan may use is decided by OpenAI; users can add any other
 * model id their plan exposes.
 */

export const CODEX_DEFAULT_BASE_URL = 'https://chatgpt.com/backend-api/codex'
export const CODEX_PROVIDER_TEST_LLM_MODEL_ID = 'gpt-5.6-luna'

export const CODEX_REASONING_EFFORT_OPTIONS = [
  'medium',
  'low',
  'high',
  'xhigh',
] as const satisfies readonly ReasoningEffort[]

type CodexLlmModelDefinition = {
  readonly modelId: string
  readonly name: string
  readonly publicReasoningMode: Exclude<AiPublicReasoningMode, 'none'>
  readonly reasoningEffortOptions: readonly [ReasoningEffort, ...ReasoningEffort[]]
  readonly defaultReasoningEffort: ReasoningEffort
  readonly contextWindow: number
}

export const CODEX_LLM_MODEL_DEFINITIONS = [
  {
    modelId: 'gpt-5.6-sol',
    name: 'GPT-5.6 Sol (Codex)',
    publicReasoningMode: 'summary_auto',
    reasoningEffortOptions: CODEX_REASONING_EFFORT_OPTIONS,
    defaultReasoningEffort: 'medium',
    contextWindow: 400_000,
  },
  {
    modelId: 'gpt-5.6-terra',
    name: 'GPT-5.6 Terra (Codex)',
    publicReasoningMode: 'summary_auto',
    reasoningEffortOptions: CODEX_REASONING_EFFORT_OPTIONS,
    defaultReasoningEffort: 'medium',
    contextWindow: 400_000,
  },
  {
    modelId: 'gpt-5.6-luna',
    name: 'GPT-5.6 Luna (Codex)',
    publicReasoningMode: 'summary_auto',
    reasoningEffortOptions: CODEX_REASONING_EFFORT_OPTIONS,
    defaultReasoningEffort: 'medium',
    contextWindow: 400_000,
  },
  {
    modelId: 'gpt-5.5',
    name: 'GPT-5.5 (Codex)',
    publicReasoningMode: 'summary_auto',
    reasoningEffortOptions: CODEX_REASONING_EFFORT_OPTIONS,
    defaultReasoningEffort: 'medium',
    contextWindow: 400_000,
  },
] as const satisfies readonly CodexLlmModelDefinition[]

function codexLlmCapabilities(model: CodexLlmModelDefinition) {
  return {
    llm: {
      protocol: 'openai-responses' as const,
      codexRuntimeWireApi: 'responses' as const,
      publicReasoningMode: model.publicReasoningMode,
      reasoningEffortOptions: [...model.reasoningEffortOptions],
      defaultReasoningEffort: model.defaultReasoningEffort,
      contextWindow: model.contextWindow,
    },
  }
}

const SUBSCRIPTION_TOKEN_PRICING = {
  mode: 'capability' as const,
  tiers: [
    { when: { tokenType: 'input' }, amount: 0 },
    { when: { tokenType: 'output' }, amount: 0 },
  ],
}

export const CODEX_BUILTIN_CAPABILITY_CATALOG_ENTRIES = CODEX_LLM_MODEL_DEFINITIONS.map((model) => ({
  modelType: 'llm' as const,
  provider: 'codex',
  modelId: model.modelId,
  capabilities: codexLlmCapabilities(model),
}))

export const CODEX_BUILTIN_PRICING_CATALOG_ENTRIES = CODEX_LLM_MODEL_DEFINITIONS.map((model) => ({
  apiType: 'text' as const,
  provider: 'codex',
  modelId: model.modelId,
  cost: SUBSCRIPTION_TOKEN_PRICING,
}))

export const CODEX_API_CONFIG_CATALOG_MODELS = CODEX_LLM_MODEL_DEFINITIONS.map((model) => ({
  modelId: model.modelId,
  name: model.name,
  type: 'llm' as const,
  provider: 'codex',
}))

/** Applied to model ids a user adds manually (for example a newer Codex model). */
export const CODEX_CUSTOM_MODEL_CAPABILITIES = [
  {
    provider: 'codex',
    modelType: 'llm' as const,
    capabilities: codexLlmCapabilities({
      modelId: '*',
      name: 'custom',
      publicReasoningMode: 'summary_auto',
      reasoningEffortOptions: CODEX_REASONING_EFFORT_OPTIONS,
      defaultReasoningEffort: 'medium',
      contextWindow: 200_000,
    }),
  },
] as const
