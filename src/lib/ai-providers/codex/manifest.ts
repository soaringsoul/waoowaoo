import { defineAiProviderManifest } from '@/lib/ai-providers/manifest'
import { codexAdapter } from './adapter'
import {
  CODEX_API_CONFIG_CATALOG_MODELS,
  CODEX_BUILTIN_CAPABILITY_CATALOG_ENTRIES,
  CODEX_BUILTIN_PRICING_CATALOG_ENTRIES,
  CODEX_CUSTOM_MODEL_CAPABILITIES,
  CODEX_DEFAULT_BASE_URL,
} from './models'

const BOTH_TRANSPORTS = ['public-https', 'inline-data-url'] as const

/**
 * Codex via "Sign in with ChatGPT": the Assistant and text tasks run on the
 * user's ChatGPT plan through the ChatGPT Codex backend. User-key mode only;
 * there is no platform-wide ChatGPT credential.
 */
export const codexProviderManifest = defineAiProviderManifest({
  providerKey: 'codex',
  adapter: codexAdapter,
  apiConfig: {
    visibility: 'visible',
    name: 'Codex (ChatGPT login)',
    baseUrl: CODEX_DEFAULT_BASE_URL,
    customModelTypes: ['llm'],
    credentialInput: 'chatgpt-login',
  },
  platformCredentials: {
    envPrefix: 'PLATFORM_CODEX',
  },
  catalogs: {
    capabilities: CODEX_BUILTIN_CAPABILITY_CATALOG_ENTRIES,
    pricing: CODEX_BUILTIN_PRICING_CATALOG_ENTRIES,
    apiConfigModels: CODEX_API_CONFIG_CATALOG_MODELS,
    platformModels: [],
    customModelCapabilities: CODEX_CUSTOM_MODEL_CAPABILITIES,
  },
  mediaInputs: [
    { modality: 'vision', transports: { image: BOTH_TRANSPORTS } },
  ],
})
