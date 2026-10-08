import { AppError } from '@/lib/errors/app-error'
import { fetchWithProviderProxy } from '@/lib/http/outbound-proxy'
import { ProviderHttpError, readProviderJsonResponse } from '../failure'

/**
 * ChatGPT ("Sign in with ChatGPT") credentials for the Codex backend.
 *
 * The bundle is stored exactly like an API key: encrypted in the provider's
 * `apiKey` field. It never leaves the server after it is saved; refreshed
 * tokens are written back under a row lock because OpenAI rotates refresh
 * tokens on every use.
 */

export const CODEX_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
export const CODEX_OAUTH_ISSUER = 'https://auth.openai.com'
export const CODEX_OAUTH_TOKEN_URL = `${CODEX_OAUTH_ISSUER}/oauth/token`
export const CODEX_DEVICE_USER_CODE_URL = `${CODEX_OAUTH_ISSUER}/api/accounts/deviceauth/usercode`
export const CODEX_DEVICE_TOKEN_URL = `${CODEX_OAUTH_ISSUER}/api/accounts/deviceauth/token`
export const CODEX_DEVICE_VERIFICATION_URL = `${CODEX_OAUTH_ISSUER}/codex/device`
export const CODEX_DEVICE_REDIRECT_URI = `${CODEX_OAUTH_ISSUER}/deviceauth/callback`
export const CODEX_DEVICE_LOGIN_TIMEOUT_MS = 15 * 60 * 1000

/** Refresh when the access token has less than this much life left. */
const ACCESS_TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000
const AUTH_REQUEST_TIMEOUT_MS = 30_000
const AUTH_RESPONSE_MAX_BYTES = 1024 * 1024

export type CodexCredentialBundle = {
  readonly kind: 'chatgpt'
  readonly accessToken: string
  readonly refreshToken: string
  readonly idToken?: string
  readonly accountId: string
  readonly email?: string
  readonly planType?: string
  /** Access token expiry (epoch ms); 0 when unknown, which forces a refresh. */
  readonly expiresAt: number
}

export class CodexCredentialError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CodexCredentialError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function decodeJwtClaims(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length < 2 || !parts[1]) return null
  try {
    const jwtPayloadJson = Buffer.from(parts[1].replace(/-/gu, '+').replace(/_/gu, '/'), 'base64').toString('utf8')
    const parsed: unknown = JSON.parse(jwtPayloadJson)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function readOpenAiAuthClaims(claims: Record<string, unknown> | null): Record<string, unknown> {
  const auth = claims?.['https://api.openai.com/auth']
  return isRecord(auth) ? auth : {}
}

function readEmail(claims: Record<string, unknown> | null): string {
  const direct = readString(claims?.email)
  if (direct) return direct
  const profile = claims?.['https://api.openai.com/profile']
  return isRecord(profile) ? readString(profile.email) : ''
}

function readExpiryMs(token: string): number {
  const exp = decodeJwtClaims(token)?.exp
  return typeof exp === 'number' && Number.isFinite(exp) && exp > 0 ? exp * 1000 : 0
}

export function buildCodexCredentialBundle(input: {
  readonly accessToken: string
  readonly refreshToken: string
  readonly idToken?: string
  readonly accountId?: string
  readonly expiresInSeconds?: number
  readonly now?: number
}): CodexCredentialBundle {
  const accessToken = input.accessToken.trim()
  const refreshToken = input.refreshToken.trim()
  if (!accessToken) throw new CodexCredentialError('access_token is missing')
  if (!refreshToken) throw new CodexCredentialError('refresh_token is missing')
  const idToken = input.idToken?.trim() || undefined
  const idClaims = idToken ? decodeJwtClaims(idToken) : null
  const accessClaims = decodeJwtClaims(accessToken)
  const accountId = input.accountId?.trim()
    || readString(readOpenAiAuthClaims(idClaims).chatgpt_account_id)
    || readString(readOpenAiAuthClaims(accessClaims).chatgpt_account_id)
  if (!accountId) {
    throw new CodexCredentialError('ChatGPT account id is missing (expected tokens.account_id or a ChatGPT id_token)')
  }
  const planType = readString(readOpenAiAuthClaims(idClaims).chatgpt_plan_type)
    || readString(readOpenAiAuthClaims(accessClaims).chatgpt_plan_type)
  const email = readEmail(idClaims) || readEmail(accessClaims)
  const jwtExpiry = readExpiryMs(accessToken)
  const expiresAt = jwtExpiry || (
    typeof input.expiresInSeconds === 'number' && input.expiresInSeconds > 0
      ? (input.now ?? Date.now()) + input.expiresInSeconds * 1000
      : 0
  )
  return {
    kind: 'chatgpt',
    accessToken,
    refreshToken,
    ...(idToken ? { idToken } : {}),
    accountId,
    ...(email ? { email } : {}),
    ...(planType ? { planType } : {}),
    expiresAt,
  }
}

/**
 * Accepts the canonical stored bundle, a Codex CLI `~/.codex/auth.json`
 * (`{ tokens: { access_token, refresh_token, id_token, account_id } }`), or a
 * bare OAuth token response.
 */
export function parseCodexCredential(raw: string): CodexCredentialBundle {
  const credentialText = raw.trim()
  if (!credentialText) throw new CodexCredentialError('credential is empty')
  let parsed: unknown
  try {
    parsed = JSON.parse(credentialText)
  } catch {
    throw new CodexCredentialError(
      'expected the JSON produced by ChatGPT login (or the contents of ~/.codex/auth.json); plain API keys belong to the OpenAI provider',
    )
  }
  if (!isRecord(parsed)) throw new CodexCredentialError('credential JSON must be an object')
  if (parsed.kind === 'chatgpt') {
    const bundle = buildCodexCredentialBundle({
      accessToken: readString(parsed.accessToken),
      refreshToken: readString(parsed.refreshToken),
      idToken: readString(parsed.idToken) || undefined,
      accountId: readString(parsed.accountId) || undefined,
    })
    const storedExpiry = typeof parsed.expiresAt === 'number' && Number.isFinite(parsed.expiresAt)
      ? parsed.expiresAt
      : 0
    return bundle.expiresAt || !storedExpiry ? bundle : { ...bundle, expiresAt: storedExpiry }
  }
  const tokens = isRecord(parsed.tokens) ? parsed.tokens : parsed
  const accessToken = readString(tokens.access_token)
  const refreshToken = readString(tokens.refresh_token)
  if (!accessToken && !refreshToken && readString(parsed.OPENAI_API_KEY)) {
    throw new CodexCredentialError(
      'this auth.json only contains an OpenAI API key; configure it on the OpenAI provider instead',
    )
  }
  return buildCodexCredentialBundle({
    accessToken,
    refreshToken,
    idToken: readString(tokens.id_token) || undefined,
    accountId: readString(tokens.account_id) || undefined,
    expiresInSeconds: typeof tokens.expires_in === 'number' ? tokens.expires_in : undefined,
  })
}

export function serializeCodexCredential(bundle: CodexCredentialBundle): string {
  return JSON.stringify(bundle)
}

export function isCodexAccessTokenFresh(bundle: CodexCredentialBundle, now = Date.now()): boolean {
  return bundle.expiresAt > now + ACCESS_TOKEN_REFRESH_MARGIN_MS
}

async function readJsonBody(response: Response): Promise<Record<string, unknown>> {
  try {
    const parsed = await readProviderJsonResponse<unknown>({
      response,
      provider: 'codex',
      phase: 'submit',
      maxBytes: AUTH_RESPONSE_MAX_BYTES,
    })
    return isRecord(parsed) ? parsed : {}
  } catch (error: unknown) {
    if (error instanceof ProviderHttpError) return { raw: (error.diagnosticText ?? '').slice(0, 500) }
    throw error
  }
}

function describeAuthError(body: Record<string, unknown>): string {
  const error = isRecord(body.error) ? body.error : null
  return readString(error?.code)
    || readString(error?.message)
    || readString(body.error)
    || readString(body.error_description)
    || readString(body.raw)
    || 'unknown_error'
}

function tokenResponseToBundle(
  body: Record<string, unknown>,
  previous?: CodexCredentialBundle,
): CodexCredentialBundle {
  return buildCodexCredentialBundle({
    accessToken: readString(body.access_token),
    refreshToken: readString(body.refresh_token) || previous?.refreshToken || '',
    idToken: readString(body.id_token) || previous?.idToken,
    accountId: previous?.accountId,
    expiresInSeconds: typeof body.expires_in === 'number' ? body.expires_in : undefined,
  })
}

export async function refreshCodexCredential(
  bundle: CodexCredentialBundle,
  send: typeof fetch = fetchWithProviderProxy as typeof fetch,
): Promise<CodexCredentialBundle> {
  const response = await send(CODEX_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      client_id: CODEX_OAUTH_CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: bundle.refreshToken,
      scope: 'openid profile email',
    }).toString(),
    signal: AbortSignal.timeout(AUTH_REQUEST_TIMEOUT_MS),
  })
  const body = await readJsonBody(response)
  if (!response.ok) {
    const reason = describeAuthError(body)
    throw new AppError(
      response.status === 400 || response.status === 401 ? 'PROVIDER_AUTH_INVALID' : 'EXTERNAL_ERROR',
      `ChatGPT token refresh failed (${String(response.status)} ${reason}); sign in to Codex again in API settings`,
      { provider: 'codex', details: { providerStatus: response.status, providerCode: reason.slice(0, 128) } },
    )
  }
  return tokenResponseToBundle(body, bundle)
}

export type CodexDeviceLoginStart = {
  readonly deviceAuthId: string
  readonly userCode: string
  readonly verificationUrl: string
  readonly intervalSeconds: number
}

export async function startCodexDeviceLogin(
  send: typeof fetch = fetchWithProviderProxy as typeof fetch,
): Promise<CodexDeviceLoginStart> {
  const response = await send(CODEX_DEVICE_USER_CODE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id: CODEX_OAUTH_CLIENT_ID }),
    signal: AbortSignal.timeout(AUTH_REQUEST_TIMEOUT_MS),
  })
  const body = await readJsonBody(response)
  if (!response.ok) {
    throw new AppError('EXTERNAL_ERROR', `ChatGPT device login could not start (${String(response.status)} ${describeAuthError(body)})`, {
      provider: 'codex',
      details: { providerStatus: response.status },
    })
  }
  const deviceAuthId = readString(body.device_auth_id)
  const userCode = readString(body.user_code) || readString(body.usercode)
  if (!deviceAuthId || !userCode) {
    throw new AppError('EXTERNAL_ERROR', 'ChatGPT device login response is missing the user code', { provider: 'codex' })
  }
  const intervalRaw = typeof body.interval === 'number' ? body.interval : Number.parseInt(readString(body.interval), 10)
  const intervalSeconds = Number.isFinite(intervalRaw) && intervalRaw > 0 ? Math.min(intervalRaw, 30) : 5
  return {
    deviceAuthId,
    userCode,
    verificationUrl: CODEX_DEVICE_VERIFICATION_URL,
    intervalSeconds,
  }
}

export type CodexDeviceLoginPoll =
  | { readonly status: 'pending' }
  | { readonly status: 'complete'; readonly bundle: CodexCredentialBundle }

export async function pollCodexDeviceLogin(
  input: { readonly deviceAuthId: string; readonly userCode: string },
  send: typeof fetch = fetchWithProviderProxy as typeof fetch,
): Promise<CodexDeviceLoginPoll> {
  const response = await send(CODEX_DEVICE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ device_auth_id: input.deviceAuthId, user_code: input.userCode }),
    signal: AbortSignal.timeout(AUTH_REQUEST_TIMEOUT_MS),
  })
  if (response.status === 403 || response.status === 404) {
    await response.body?.cancel()
    return { status: 'pending' }
  }
  const body = await readJsonBody(response)
  if (!response.ok) {
    throw new AppError('EXTERNAL_ERROR', `ChatGPT device login failed (${String(response.status)} ${describeAuthError(body)})`, {
      provider: 'codex',
      details: { providerStatus: response.status },
    })
  }
  const authorizationCode = readString(body.authorization_code)
  const codeVerifier = readString(body.code_verifier)
  if (!authorizationCode || !codeVerifier) {
    throw new AppError('EXTERNAL_ERROR', 'ChatGPT device login response is missing the authorization code', { provider: 'codex' })
  }
  const tokenResponse = await send(CODEX_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: authorizationCode,
      redirect_uri: CODEX_DEVICE_REDIRECT_URI,
      client_id: CODEX_OAUTH_CLIENT_ID,
      code_verifier: codeVerifier,
    }).toString(),
    signal: AbortSignal.timeout(AUTH_REQUEST_TIMEOUT_MS),
  })
  const tokenBody = await readJsonBody(tokenResponse)
  if (!tokenResponse.ok) {
    throw new AppError('PROVIDER_AUTH_INVALID', `ChatGPT token exchange failed (${String(tokenResponse.status)} ${describeAuthError(tokenBody)})`, {
      provider: 'codex',
      details: { providerStatus: tokenResponse.status },
    })
  }
  return { status: 'complete', bundle: tokenResponseToBundle(tokenBody) }
}
