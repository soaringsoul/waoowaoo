import { readResponseBufferWithLimit } from '@/lib/http/body-limits'
import { fetchWithProviderProxy } from '@/lib/http/outbound-proxy'
import type { CodexCredentialBundle } from './auth'

/**
 * Request shaping for the ChatGPT Codex backend (`/backend-api/codex`).
 *
 * The backend only accepts streamed, unstored Responses requests with the
 * system prompt in top-level `instructions`, authorized by the ChatGPT access
 * token plus the ChatGPT account id. It is the same endpoint the official
 * Codex CLI uses when signed in with ChatGPT.
 */

export const CODEX_BACKEND_ORIGINATOR = 'codex_cli_rs'
const CODEX_BACKEND_USER_AGENT = 'codex_cli_rs/0.146.0 (waoowaoo codex gateway)'
const UNSUPPORTED_BACKEND_FIELDS = [
  'max_output_tokens',
  'max_completion_tokens',
  'temperature',
  'top_p',
  'previous_response_id',
  'prompt_cache_retention',
  'safety_identifier',
] as const

const CODEX_STREAM_MAX_BYTES = 40 * 1024 * 1024

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function buildCodexBackendHeaders(bundle: CodexCredentialBundle): Record<string, string> {
  return {
    Authorization: `Bearer ${bundle.accessToken}`,
    'ChatGPT-Account-ID': bundle.accountId,
    'OpenAI-Beta': 'responses=experimental',
    originator: CODEX_BACKEND_ORIGINATOR,
    'User-Agent': CODEX_BACKEND_USER_AGENT,
    'Content-Type': 'application/json',
  }
}

function readMessageText(content: unknown): string | null {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return null
  const parts: string[] = []
  for (const part of content) {
    if (!isRecord(part) || typeof part.text !== 'string') return null
    if (part.type !== 'input_text' && part.type !== 'text') return null
    parts.push(part.text)
  }
  return parts.join('\n\n')
}

/**
 * Lifts system/developer messages into `instructions` and applies the
 * backend's mandatory flags. Idempotent, so the Assistant gateway (whose
 * request was already normalized) and the AI SDK path share it.
 */
export function prepareCodexBackendBody(body: Record<string, unknown>): void {
  const instructions: string[] = typeof body.instructions === 'string' && body.instructions.trim()
    ? [body.instructions]
    : []
  if (Array.isArray(body.input)) {
    const input: unknown[] = []
    for (const item of body.input) {
      if (isRecord(item) && (item.role === 'system' || item.role === 'developer')
        && (item.type === undefined || item.type === 'message')) {
        const text = readMessageText(item.content)
        if (text !== null) {
          if (text.trim()) instructions.push(text)
          continue
        }
      }
      input.push(item)
    }
    body.input = input
  }
  body.instructions = instructions.join('\n\n')
  body.store = false
  body.stream = true
  for (const field of UNSUPPORTED_BACKEND_FIELDS) delete body[field]
}

function parseSseEvents(text: string): Record<string, unknown>[] {
  const events: Record<string, unknown>[] = []
  for (const block of text.split(/\r?\n\r?\n/u)) {
    const boundedFrameData = block
      .split(/\r?\n/u)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
    if (!boundedFrameData || boundedFrameData === '[DONE]') continue
    try {
      const parsed: unknown = JSON.parse(boundedFrameData)
      if (isRecord(parsed)) events.push(parsed)
    } catch {
      // Ignore keep-alive or non-JSON frames.
    }
  }
  return events
}

/**
 * The backend streams every response. For non-streaming SDK calls the final
 * `response.completed` payload is returned as the JSON body the Responses API
 * would have produced, so `generateText` works unchanged.
 */
export async function collapseCodexStreamToJson(response: Response): Promise<Response> {
  const streamBody = await readResponseBufferWithLimit(response, CODEX_STREAM_MAX_BYTES, 'codex backend stream')
  const events = parseSseEvents(streamBody.toString('utf8'))
  const terminal = [...events].reverse().find((event) => (
    event.type === 'response.completed'
    || event.type === 'response.done'
    || event.type === 'response.failed'
    || event.type === 'response.incomplete'
    || event.type === 'error'
  ))
  const payload = terminal && isRecord(terminal.response) ? terminal.response : null
  if (terminal?.type === 'response.failed' || terminal?.type === 'error' || !payload) {
    const error = payload && isRecord(payload.error)
      ? payload.error
      : isRecord(terminal?.error)
        ? terminal.error
        : { message: 'Codex backend stream ended without a completed response', code: 'response_stream_disconnected' }
    return new Response(JSON.stringify({ error }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

export function createCodexBackendFetch(
  send: typeof fetch = fetchWithProviderProxy as typeof fetch,
): typeof fetch {
  return (async (requestInput: RequestInfo | URL, requestInit?: RequestInit) => {
    const bodyText = typeof requestInit?.body === 'string' ? requestInit.body : ''
    if (!bodyText) return await send(requestInput, requestInit)
    let body: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(bodyText)
      if (!isRecord(parsed)) return await send(requestInput, requestInit)
      body = parsed
    } catch {
      return await send(requestInput, requestInit)
    }
    const callerWantsStream = body.stream === true
    prepareCodexBackendBody(body)
    const headers = new Headers(requestInit?.headers)
    headers.set('Accept', 'text/event-stream')
    const response = await send(requestInput, {
      ...requestInit,
      headers,
      body: JSON.stringify(body),
    })
    if (callerWantsStream || !response.ok) return response
    return await collapseCodexStreamToJson(response)
  }) as typeof fetch
}
