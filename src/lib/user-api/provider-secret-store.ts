import { prisma } from '@/lib/prisma'
import { decryptApiKey, encryptApiKey } from '@/lib/crypto-utils'
import { AppError } from '@/lib/errors/app-error'

const PROVIDER_SECRET_LOCK_TIMEOUT_MS = 45_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function parseRawProviders(raw: string | null | undefined, providerId: string): Record<string, unknown>[] {
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new AppError('PROVIDER_AUTH_INVALID', 'Provider configuration is invalid', { provider: providerId })
  }
  if (!Array.isArray(parsed) || !parsed.every(isRecord)) {
    throw new AppError('PROVIDER_AUTH_INVALID', 'Provider configuration is invalid', { provider: providerId })
  }
  return parsed
}

/**
 * Serializes OAuth-style credential refreshes across app and worker processes
 * with a row lock on the user's preference row, then persists the refreshed
 * secret re-encrypted in place. Refresh tokens rotate on use, so two
 * concurrent refreshes with the same token must never happen.
 */
export async function refreshStoredProviderSecret(
  userId: string,
  providerId: string,
  refresh: (latestSecret: string) => Promise<string>,
): Promise<string> {
  return await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM user_preferences WHERE userId = ${userId} FOR UPDATE`
    const pref = await tx.userPreference.findUnique({
      where: { userId },
      select: { customProviders: true },
    })
    const providers = parseRawProviders(pref?.customProviders, providerId)
    const index = providers.findIndex((raw) => readTrimmedString(raw.id) === providerId)
    const stored = index === -1 ? null : providers[index]
    const encrypted = stored ? readTrimmedString(stored.apiKey) : ''
    if (!stored || !encrypted) {
      throw new AppError('PROVIDER_AUTH_INVALID', 'Provider credential is missing', { provider: providerId })
    }
    const latestSecret = decryptApiKey(encrypted)
    const nextSecret = await refresh(latestSecret)
    if (nextSecret !== latestSecret) {
      providers[index] = { ...stored, apiKey: encryptApiKey(nextSecret) }
      await tx.userPreference.update({
        where: { userId },
        data: { customProviders: JSON.stringify(providers) },
      })
    }
    return nextSecret
  }, { timeout: PROVIDER_SECRET_LOCK_TIMEOUT_MS, maxWait: PROVIDER_SECRET_LOCK_TIMEOUT_MS })
}

/**
 * Stores a credential obtained by a server-side login flow (for example the
 * ChatGPT device login) without the browser ever seeing the secret. Other
 * providers, models and defaults are left untouched.
 */
export async function upsertStoredProviderSecret(input: {
  readonly userId: string
  readonly providerId: string
  readonly providerName: string
  readonly baseUrl?: string
  readonly secret: string
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.userPreference.upsert({
      where: { userId: input.userId },
      create: { userId: input.userId },
      update: {},
    })
    await tx.$queryRaw`SELECT id FROM user_preferences WHERE userId = ${input.userId} FOR UPDATE`
    const pref = await tx.userPreference.findUnique({
      where: { userId: input.userId },
      select: { customProviders: true },
    })
    const providers = parseRawProviders(pref?.customProviders, input.providerId)
    const encrypted = encryptApiKey(input.secret)
    const index = providers.findIndex((raw) => readTrimmedString(raw.id) === input.providerId)
    if (index === -1) {
      providers.push({
        id: input.providerId,
        name: input.providerName,
        ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
        apiKey: encrypted,
      })
    } else {
      providers[index] = { ...providers[index], apiKey: encrypted }
    }
    await tx.userPreference.update({
      where: { userId: input.userId },
      data: { customProviders: JSON.stringify(providers) },
    })
  }, { timeout: PROVIDER_SECRET_LOCK_TIMEOUT_MS, maxWait: PROVIDER_SECRET_LOCK_TIMEOUT_MS })
}
