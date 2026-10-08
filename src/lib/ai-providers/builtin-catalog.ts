import { AI_PROVIDER_MANIFESTS } from '@/lib/ai-providers/manifests'
import type {
  ProviderCapabilityCatalogDeclaration,
  ProviderCustomModelCapabilityDeclaration,
  ProviderPricingCatalogDeclaration,
} from '@/lib/ai-providers/manifest'
import type { ApiConfigCatalogModel } from '@/lib/ai-registry/api-config-catalog'

export function listBuiltinCapabilityCatalogEntries(): readonly ProviderCapabilityCatalogDeclaration[] {
  return AI_PROVIDER_MANIFESTS.flatMap((manifest) => manifest.catalogs.capabilities)
}

export function listBuiltinPricingCatalogEntries(): readonly ProviderPricingCatalogDeclaration[] {
  return AI_PROVIDER_MANIFESTS.flatMap((manifest) => manifest.catalogs.pricing)
}

export function listBuiltinApiConfigCatalogModels(): readonly ApiConfigCatalogModel[] {
  return AI_PROVIDER_MANIFESTS.flatMap((manifest) => manifest.catalogs.apiConfigModels)
}

export function listBuiltinCustomModelCapabilityEntries(): readonly ProviderCustomModelCapabilityDeclaration[] {
  return AI_PROVIDER_MANIFESTS.flatMap((manifest) => manifest.catalogs.customModelCapabilities ?? [])
}
