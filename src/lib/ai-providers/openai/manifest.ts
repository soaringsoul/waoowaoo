import { openAiAdapter } from '@/lib/ai-providers/openai/adapter'
import {
  OPENAI_API_CONFIG_CATALOG_MODELS,
  OPENAI_BUILTIN_CAPABILITY_CATALOG_ENTRIES,
  OPENAI_BUILTIN_PRICING_CATALOG_ENTRIES,
  OPENAI_DEFAULT_BASE_URL,
  OPENAI_PLATFORM_MODEL_PRESETS,
} from '@/lib/ai-providers/openai/models'
import { defineAiProviderManifest } from '@/lib/ai-providers/manifest'

const BOTH_TRANSPORTS = ['public-https', 'inline-data-url'] as const

export const openAiProviderManifest = defineAiProviderManifest({
  providerKey: 'openai',
  adapter: openAiAdapter,
  apiConfig: {
    visibility: 'visible',
    name: 'OpenAI',
    baseUrl: OPENAI_DEFAULT_BASE_URL,
    baseUrlEditable: true,
  },
  platformCredentials: {
    envPrefix: 'PLATFORM_OPENAI',
  },
  catalogs: {
    capabilities: OPENAI_BUILTIN_CAPABILITY_CATALOG_ENTRIES,
    pricing: OPENAI_BUILTIN_PRICING_CATALOG_ENTRIES,
    apiConfigModels: OPENAI_API_CONFIG_CATALOG_MODELS,
    platformModels: OPENAI_PLATFORM_MODEL_PRESETS,
  },
  mediaInputs: [
    { modality: 'vision', transports: { image: BOTH_TRANSPORTS } },
    { modality: 'image', transports: { image: BOTH_TRANSPORTS } },
  ],
})
