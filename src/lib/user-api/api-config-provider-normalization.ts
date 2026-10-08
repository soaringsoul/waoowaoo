import { ApiError } from '@/lib/api-errors'
import { isApiConfigCatalogProviderId } from '@/lib/ai-registry/api-config-catalog'
import { resolveAiProviderManifest } from '@/lib/ai-providers/manifests'
import type { StoredProvider } from './api-config-types'
import { getProviderKey, isRecord, readTrimmedString } from './api-config-shared'

function assertSupportedProvider(providerId: string, field: string) {
  if (isApiConfigCatalogProviderId(providerId)) return
  throw new ApiError('INVALID_PARAMS', {
    code: 'PROVIDER_NOT_SUPPORTED',
    field,
  })
}

function normalizeProviderBaseUrl(value: string, field: string): string {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('PROTOCOL_INVALID')
    return parsed.toString().replace(/\/$/, '')
  } catch {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PROVIDER_BASE_URL_INVALID',
      field,
    })
  }
}

/**
 * Lets providers with structured credentials (for example a ChatGPT login
 * token bundle) validate and canonicalize the submitted secret before it is
 * encrypted. Plain API-key providers store the trimmed key unchanged.
 */
export function normalizeProviderSecretForStorage(providerId: string, secret: string): string {
  const credential = resolveAiProviderManifest(getProviderKey(providerId)).adapter.credential
  if (!credential?.normalizeForStorage) return secret
  try {
    return credential.normalizeForStorage(secret)
  } catch (error) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PROVIDER_CREDENTIAL_INVALID',
      field: 'providers.apiKey',
      providerId,
      message: error instanceof Error ? error.message : 'credential is invalid',
    })
  }
}

export function resolveProviderByIdOrKey(
  providers: readonly StoredProvider[],
  providerId: string,
): StoredProvider | null {
  const exact = providers.find((provider) => provider.id === providerId)
  if (exact) return exact

  const providerKey = getProviderKey(providerId)
  const candidates = providers.filter((provider) => getProviderKey(provider.id) === providerKey)
  if (candidates.length === 0) return null
  if (candidates.length > 1) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PROVIDER_AMBIGUOUS',
      field: 'providers',
    })
  }

  return candidates[0]
}

export function normalizeProvidersInput(rawProviders: unknown): StoredProvider[] {
  if (rawProviders === undefined) return []
  if (!Array.isArray(rawProviders)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PROVIDER_PAYLOAD_INVALID',
      field: 'providers',
    })
  }

  const normalized: StoredProvider[] = []
  for (let index = 0; index < rawProviders.length; index += 1) {
    const item = rawProviders[index]
    if (!isRecord(item)) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'PROVIDER_PAYLOAD_INVALID',
        field: `providers[${index}]`,
      })
    }
    const id = readTrimmedString(item.id)
    const name = readTrimmedString(item.name)
    if (!id || !name) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'PROVIDER_PAYLOAD_INVALID',
        field: `providers[${index}]`,
      })
    }
    const normalizedId = id.toLowerCase()
    assertSupportedProvider(normalizedId, `providers[${index}].id`)
    if (normalized.some((provider) => provider.id.toLowerCase() === normalizedId)) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'PROVIDER_DUPLICATE',
        field: `providers[${index}].id`,
      })
    }
    const rawBaseUrl = readTrimmedString(item.baseUrl)
    const baseUrl = rawBaseUrl
      ? normalizeProviderBaseUrl(rawBaseUrl, `providers[${index}].baseUrl`)
      : undefined

    normalized.push({
      id,
      name,
      baseUrl,
      apiKey: typeof item.apiKey === 'string' ? item.apiKey.trim() : undefined,
    })
  }

  return normalized
}

export function parseStoredProviders(rawProviders: string | null | undefined): StoredProvider[] {
  if (!rawProviders) return []
  let parsedUnknown: unknown
  try {
    parsedUnknown = JSON.parse(rawProviders)
  } catch {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PROVIDER_PAYLOAD_INVALID',
      field: 'customProviders',
    })
  }
  if (!Array.isArray(parsedUnknown)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PROVIDER_PAYLOAD_INVALID',
      field: 'customProviders',
    })
  }

  const normalized: StoredProvider[] = []
  for (let index = 0; index < parsedUnknown.length; index += 1) {
    const raw = parsedUnknown[index]
    if (!isRecord(raw)) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'PROVIDER_PAYLOAD_INVALID',
        field: `customProviders[${index}]`,
      })
    }

    const id = readTrimmedString(raw.id)
    const name = readTrimmedString(raw.name)
    if (!id || !name) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'PROVIDER_PAYLOAD_INVALID',
        field: `customProviders[${index}]`,
      })
    }

    assertSupportedProvider(id, `customProviders[${index}].id`)

    const baseUrl = readTrimmedString(raw.baseUrl) || undefined

    normalized.push({
      id,
      name,
      baseUrl,
      apiKey: typeof raw.apiKey === 'string' ? raw.apiKey.trim() : undefined,
    })
  }

  return normalized
}
