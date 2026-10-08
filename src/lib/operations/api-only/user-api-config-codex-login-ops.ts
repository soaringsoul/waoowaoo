import { z } from 'zod'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { assertUserProviderConfigurationAvailable } from '@/lib/user-api/availability'
import { decryptApiKey, encryptApiKey } from '@/lib/crypto-utils'
import { ApiError } from '@/lib/api-errors'
import {
  CODEX_DEVICE_LOGIN_TIMEOUT_MS,
  pollCodexDeviceLogin,
  serializeCodexCredential,
  startCodexDeviceLogin,
} from '@/lib/ai-providers/codex/auth'
import { CODEX_DEFAULT_BASE_URL } from '@/lib/ai-providers/codex/models'
import { upsertStoredProviderSecret } from '@/lib/user-api/provider-secret-store'

const CODEX_PROVIDER_ID = 'codex'
const CODEX_PROVIDER_NAME = 'Codex (ChatGPT login)'

const pollInputSchema = z.object({
  loginToken: z.string().trim().min(1).max(4_096),
}).strict()

type LoginTicket = {
  readonly v: 1
  readonly userId: string
  readonly deviceAuthId: string
  readonly userCode: string
  readonly expiresAt: number
}

function readTicket(loginToken: string, userId: string): LoginTicket {
  let ticket: unknown
  try {
    ticket = JSON.parse(decryptApiKey(loginToken))
  } catch {
    throw new ApiError('INVALID_PARAMS', { code: 'CODEX_LOGIN_TICKET_INVALID', field: 'loginToken' })
  }
  if (
    !ticket
    || typeof ticket !== 'object'
    || (ticket as LoginTicket).v !== 1
    || (ticket as LoginTicket).userId !== userId
    || typeof (ticket as LoginTicket).deviceAuthId !== 'string'
    || typeof (ticket as LoginTicket).userCode !== 'string'
    || typeof (ticket as LoginTicket).expiresAt !== 'number'
  ) {
    throw new ApiError('INVALID_PARAMS', { code: 'CODEX_LOGIN_TICKET_INVALID', field: 'loginToken' })
  }
  return ticket as LoginTicket
}

/**
 * "Sign in with ChatGPT" device login for the Codex provider. The browser only
 * holds an encrypted, user-bound ticket; tokens are exchanged and stored
 * server-side and never returned.
 */
export function createUserApiConfigCodexLoginOperations(): ProjectAgentOperationRegistryDraft {
  return {
    api_user_api_config_codex_login_start: {
      id: 'api_user_api_config_codex_login_start',
      summary: 'API-only: Start a ChatGPT device login for the Codex provider.',
      intent: 'act',
      effects: {
        writes: false,
        billable: false,
        destructive: false,
        overwrite: false,
        bulk: false,
        externalSideEffects: true,
        longRunning: false,
      },
      inputSchema: z.unknown(),
      outputSchema: z.unknown(),
      execute: async (ctx) => {
        assertUserProviderConfigurationAvailable()
        const started = await startCodexDeviceLogin()
        const expiresAt = Date.now() + CODEX_DEVICE_LOGIN_TIMEOUT_MS
        const ticket: LoginTicket = {
          v: 1,
          userId: ctx.userId,
          deviceAuthId: started.deviceAuthId,
          userCode: started.userCode,
          expiresAt,
        }
        return {
          loginToken: encryptApiKey(JSON.stringify(ticket)),
          userCode: started.userCode,
          verificationUrl: started.verificationUrl,
          intervalSeconds: started.intervalSeconds,
          expiresAt,
        }
      },
    },

    api_user_api_config_codex_login_poll: {
      id: 'api_user_api_config_codex_login_poll',
      summary: 'API-only: Poll a ChatGPT device login and store the Codex credential once approved.',
      intent: 'act',
      effects: {
        writes: true,
        workspaceResourceImpact: 'none',
        billable: false,
        destructive: false,
        overwrite: true,
        bulk: false,
        externalSideEffects: true,
        longRunning: false,
      },
      inputSchema: pollInputSchema,
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        assertUserProviderConfigurationAvailable()
        const parsed = pollInputSchema.parse(input)
        const ticket = readTicket(parsed.loginToken, ctx.userId)
        if (Date.now() > ticket.expiresAt) {
          return { status: 'expired' as const }
        }
        const result = await pollCodexDeviceLogin({
          deviceAuthId: ticket.deviceAuthId,
          userCode: ticket.userCode,
        })
        if (result.status === 'pending') return { status: 'pending' as const }
        await upsertStoredProviderSecret({
          userId: ctx.userId,
          providerId: CODEX_PROVIDER_ID,
          providerName: CODEX_PROVIDER_NAME,
          baseUrl: CODEX_DEFAULT_BASE_URL,
          secret: serializeCodexCredential(result.bundle),
        })
        return {
          status: 'complete' as const,
          account: {
            ...(result.bundle.email ? { email: result.bundle.email } : {}),
            ...(result.bundle.planType ? { planType: result.bundle.planType } : {}),
          },
        }
      },
    },
  }
}
