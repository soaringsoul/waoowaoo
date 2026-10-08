import { describe, expect, it, vi } from 'vitest'
import {
  buildCodexBackendHeaders,
  collapseCodexStreamToJson,
  createCodexBackendFetch,
  prepareCodexBackendBody,
} from '@/lib/ai-providers/codex/backend'

function sse(events: unknown[]): string {
  return events.map((event) => `event: x\ndata: ${JSON.stringify(event)}\n\n`).join('')
}

describe('Codex ChatGPT backend shaping', () => {
  it('lifts system prompts into instructions and enforces backend flags', () => {
    const body: Record<string, unknown> = {
      model: 'gpt-5.6-sol',
      input: [
        { role: 'system', content: 'be brief' },
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
      ],
      max_output_tokens: 10,
      temperature: 0.2,
      store: true,
    }
    prepareCodexBackendBody(body)
    expect(body).toEqual({
      model: 'gpt-5.6-sol',
      instructions: 'be brief',
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
      store: false,
      stream: true,
    })
    const again = structuredClone(body)
    prepareCodexBackendBody(again)
    expect(again).toEqual(body)
  })

  it('collapses a streamed completion into a Responses JSON body', async () => {
    const response = await collapseCodexStreamToJson(new Response(sse([
      { type: 'response.created', response: { id: 'r1', status: 'in_progress' } },
      { type: 'response.completed', response: { id: 'r1', status: 'completed', output: [] } },
    ])))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ id: 'r1', status: 'completed', output: [] })

    const failed = await collapseCodexStreamToJson(new Response(sse([
      { type: 'response.failed', response: { id: 'r2', error: { code: 'usage_limit_reached', message: 'limit' } } },
    ])))
    expect(failed.status).toBe(502)
    await expect(failed.json()).resolves.toEqual({ error: { code: 'usage_limit_reached', message: 'limit' } })
  })

  it('forces streaming upstream but returns JSON to non-streaming SDK calls', async () => {
    const send = vi.fn<typeof fetch>(async () => new Response(sse([
      { type: 'response.completed', response: { id: 'r3', output: [] } },
    ]), { status: 200 }))
    const codexFetch = createCodexBackendFetch(send)
    const response = await codexFetch('https://chatgpt.com/backend-api/codex/responses', {
      method: 'POST',
      body: JSON.stringify({ model: 'gpt-5.6-sol', input: [], max_output_tokens: 5 }),
    })
    const init = send.mock.calls[0]?.[1]
    expect(JSON.parse(String(init?.body))).toMatchObject({ stream: true, store: false })
    expect(JSON.parse(String(init?.body))).not.toHaveProperty('max_output_tokens')
    expect(new Headers(init?.headers).get('accept')).toBe('text/event-stream')
    await expect(response.json()).resolves.toEqual({ id: 'r3', output: [] })
  })

  it('sends the ChatGPT account headers the backend requires', () => {
    expect(buildCodexBackendHeaders({
      kind: 'chatgpt',
      accessToken: 'at',
      refreshToken: 'rt',
      accountId: 'acct',
      expiresAt: 0,
    })).toMatchObject({
      Authorization: 'Bearer at',
      'ChatGPT-Account-ID': 'acct',
      originator: 'codex_cli_rs',
    })
  })
})
