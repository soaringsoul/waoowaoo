import { describe, expect, it, vi } from 'vitest'
import {
  CODEX_OAUTH_CLIENT_ID,
  CODEX_OAUTH_TOKEN_URL,
  CodexCredentialError,
  isCodexAccessTokenFresh,
  parseCodexCredential,
  pollCodexDeviceLogin,
  refreshCodexCredential,
  serializeCodexCredential,
} from '@/lib/ai-providers/codex/auth'

function jwt(claims: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'none' })}.${encode(claims)}.sig`
}

const NOW = Date.UTC(2026, 9, 8)
const accessToken = jwt({ exp: Math.floor(NOW / 1000) + 3600 })
const idToken = jwt({
  email: 'user@example.com',
  'https://api.openai.com/auth': { chatgpt_account_id: 'acct-123', chatgpt_plan_type: 'pro' },
})

describe('Codex ChatGPT credential', () => {
  it('parses a Codex CLI auth.json and round-trips the canonical bundle', () => {
    const bundle = parseCodexCredential(JSON.stringify({
      OPENAI_API_KEY: null,
      tokens: { access_token: accessToken, refresh_token: 'rt-1', id_token: idToken },
      last_refresh: '2026-10-08T00:00:00Z',
    }))
    expect(bundle).toMatchObject({
      kind: 'chatgpt',
      accessToken,
      refreshToken: 'rt-1',
      accountId: 'acct-123',
      email: 'user@example.com',
      planType: 'pro',
      expiresAt: (Math.floor(NOW / 1000) + 3600) * 1000,
    })
    expect(parseCodexCredential(serializeCodexCredential(bundle))).toEqual(bundle)
    expect(isCodexAccessTokenFresh(bundle, NOW)).toBe(true)
    expect(isCodexAccessTokenFresh(bundle, NOW + 3600 * 1000)).toBe(false)
  })

  it('rejects plain API keys and API-key-only auth.json files', () => {
    expect(() => parseCodexCredential('sk-plain-key')).toThrow(CodexCredentialError)
    expect(() => parseCodexCredential(JSON.stringify({ OPENAI_API_KEY: 'sk-x' })))
      .toThrow(/OpenAI provider/u)
    expect(() => parseCodexCredential(JSON.stringify({
      tokens: { access_token: 'opaque', refresh_token: 'rt' },
    }))).toThrow(/account id/u)
  })

  it('refreshes with the form-encoded refresh grant and keeps rotating tokens', async () => {
    const bundle = parseCodexCredential(JSON.stringify({
      tokens: { access_token: accessToken, refresh_token: 'rt-old', id_token: idToken },
    }))
    const nextAccess = jwt({ exp: Math.floor(NOW / 1000) + 7200 })
    const send = vi.fn(async () => new Response(JSON.stringify({
      access_token: nextAccess,
      refresh_token: 'rt-new',
    }), { status: 200 }))
    const refreshed = await refreshCodexCredential(bundle, send as unknown as typeof fetch)
    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(CODEX_OAUTH_TOKEN_URL)
    const form = new URLSearchParams(String(init.body))
    expect(form.get('grant_type')).toBe('refresh_token')
    expect(form.get('client_id')).toBe(CODEX_OAUTH_CLIENT_ID)
    expect(form.get('refresh_token')).toBe('rt-old')
    expect(refreshed).toMatchObject({
      accessToken: nextAccess,
      refreshToken: 'rt-new',
      accountId: 'acct-123',
      idToken,
    })
  })

  it('surfaces an invalid refresh token as an auth failure', async () => {
    const bundle = parseCodexCredential(JSON.stringify({
      tokens: { access_token: accessToken, refresh_token: 'rt-old', id_token: idToken },
    }))
    const send = vi.fn(async () => new Response(JSON.stringify({
      error: { code: 'refresh_token_reused' },
    }), { status: 401 }))
    await expect(refreshCodexCredential(bundle, send as unknown as typeof fetch))
      .rejects.toMatchObject({ code: 'PROVIDER_AUTH_INVALID' })
  })

  it('reports device login as pending until the user approves it', async () => {
    const pending = vi.fn(async () => new Response('', { status: 403 }))
    await expect(pollCodexDeviceLogin({ deviceAuthId: 'd', userCode: 'U' }, pending as unknown as typeof fetch))
      .resolves.toEqual({ status: 'pending' })

    const send = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        authorization_code: 'code-1',
        code_verifier: 'verifier-1',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: accessToken,
        refresh_token: 'rt-1',
        id_token: idToken,
      }), { status: 200 }))
    const result = await pollCodexDeviceLogin({ deviceAuthId: 'd', userCode: 'U' }, send as unknown as typeof fetch)
    expect(result.status).toBe('complete')
    const exchange = new URLSearchParams(String((send.mock.calls[1] as unknown as [string, RequestInit])[1].body))
    expect(exchange.get('grant_type')).toBe('authorization_code')
    expect(exchange.get('code_verifier')).toBe('verifier-1')
  })
})
