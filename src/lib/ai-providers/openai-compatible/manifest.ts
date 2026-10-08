import { defineAiProviderManifest } from '@/lib/ai-providers/manifest'
import { openAiCompatibleAdapter } from './adapter'
import {
  OPENAI_COMPATIBLE_API_CONFIG_CATALOG_MODELS,
  OPENAI_COMPATIBLE_CAPABILITY_CATALOG_ENTRIES,
  OPENAI_COMPATIBLE_CUSTOM_MODEL_CAPABILITIES,
  OPENAI_COMPATIBLE_PRICING_CATALOG_ENTRIES,
  OPENAI_COMPATIBLE_PROVIDER_KEY,
} from './models'

const BOTH_TRANSPORTS = ['public-https', 'inline-data-url'] as const

export const openAiCompatibleProviderManifest = defineAiProviderManifest({
  providerKey: OPENAI_COMPATIBLE_PROVIDER_KEY,
  adapter: openAiCompatibleAdapter,
  apiConfig: {
    visibility: 'visible',
    name: 'OpenAI-compatible (custom base URL)',
    baseUrlEditable: true,
    customModelTypes: ['llm'],
  },
  platformCredentials: {
    envPrefix: 'PLATFORM_OPENAI_COMPATIBLE',
    requiresBaseUrl: true,
  },
  catalogs: {
    capabilities: OPENAI_COMPATIBLE_CAPABILITY_CATALOG_ENTRIES,
    pricing: OPENAI_COMPATIBLE_PRICING_CATALOG_ENTRIES,
    apiConfigModels: OPENAI_COMPATIBLE_API_CONFIG_CATALOG_MODELS,
    platformModels: [],
    customModelCapabilities: OPENAI_COMPATIBLE_CUSTOM_MODEL_CAPABILITIES,
  },
  mediaInputs: [
    { modality: 'vision', transports: { image: BOTH_TRANSPORTS } },
    { modality: 'image', transports: { image: BOTH_TRANSPORTS } },
  ],
})
