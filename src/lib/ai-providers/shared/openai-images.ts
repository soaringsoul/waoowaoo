import { normalizeToBase64ForGeneration } from '@/lib/media/outbound-image'
import { fetchWithProviderProxy } from '@/lib/http/outbound-proxy'
import { decodeBase64WithLimit, MAX_IMAGE_BYTES } from '@/lib/http/body-limits'
import { readProviderJsonResponse, ProviderHttpError } from '@/lib/ai-providers/failure'
import { ProviderSubmissionError } from '@/lib/ai-exec/submission-error'
import { AppError } from '@/lib/errors/app-error'
import { requireSelectedModelId } from '@/lib/ai-providers/shared/model-selection'
import type { GptImage2ImageSize } from '@/lib/ai-providers/shared/gpt-image-2'
import type {
  AiProviderImageExecutionContext,
  GenerateResult,
} from '@/lib/ai-providers/runtime-types'
import { requireProviderBaseUrl } from './openai-responses'

const OPENAI_IMAGE_TIMEOUT_MS = 5 * 60 * 1000
const OPENAI_IMAGE_RESPONSE_MAX_BYTES = 40 * 1024 * 1024

type OpenAiImagesOptions = {
  readonly referenceImages?: readonly string[]
  readonly imageSize?: GptImage2ImageSize
  readonly quality?: string
  readonly outputFormat?: string
  readonly background?: string
  readonly outputCompression?: number
  readonly moderation?: string
}

type OpenAiImagesResponse = {
  readonly data?: ReadonlyArray<{ readonly b64_json?: string; readonly url?: string }>
  readonly usage?: Record<string, unknown>
}

function mediaTypeForFormat(outputFormat: string): string {
  if (outputFormat === 'jpeg') return 'image/jpeg'
  if (outputFormat === 'webp') return 'image/webp'
  return 'image/png'
}

function dataUrlToBlob(dataUrl: string): { blob: Blob; extension: string } {
  const match = /^data:([^;,]+);base64,([\s\S]*)$/u.exec(dataUrl)
  if (!match) throw new Error('OPENAI_IMAGE_REFERENCE_INVALID')
  const mimeType = match[1].toLowerCase()
  const bytes = decodeBase64WithLimit(match[2], MAX_IMAGE_BYTES, 'OpenAI image reference')
  const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'png'
  return { blob: new Blob([new Uint8Array(bytes)], { type: mimeType }), extension }
}

function rejectedSubmission(providerKey: string, error: unknown): never {
  if (error instanceof ProviderHttpError && error.statusCode >= 400 && error.statusCode < 500) {
    throw new ProviderSubmissionError('PROVIDER_SUBMISSION_REJECTED', error.message, {
      disposition: 'rejected',
      provider: providerKey,
      details: { providerStatus: error.statusCode },
      cause: error,
    })
  }
  throw error
}

/**
 * OpenAI Images API (`/images/generations`, `/images/edits` when reference
 * images are present). Used by the official OpenAI provider and by
 * OpenAI-compatible relays that expose the same surface.
 */
export async function executeOpenAiImagesApiGeneration(
  providerKey: string,
  input: AiProviderImageExecutionContext,
): Promise<GenerateResult> {
  const apiKey = input.providerConfig.apiKey.trim()
  if (!apiKey) throw new AppError('PROVIDER_AUTH_INVALID', undefined, { provider: providerKey })
  const baseUrl = requireProviderBaseUrl(input.providerConfig.baseUrl, providerKey, 'image')
  const modelId = requireSelectedModelId(input.selection, `${providerKey}:image`)
  const prompt = input.prompt.trim()
  if (!prompt) throw new Error(`${providerKey.toUpperCase()}_IMAGE_PROMPT_REQUIRED`)
  const options = (input.options ?? {}) as OpenAiImagesOptions
  const outputFormat = options.outputFormat?.trim() || 'png'
  const size = options.imageSize ? `${options.imageSize.width}x${options.imageSize.height}` : undefined
  const references = await Promise.all((options.referenceImages ?? []).map(normalizeToBase64ForGeneration))

  const common: Record<string, string> = {
    model: modelId,
    prompt,
    n: '1',
    output_format: outputFormat,
    ...(size ? { size } : {}),
    ...(options.quality ? { quality: options.quality } : {}),
    ...(options.background ? { background: options.background } : {}),
    ...(options.outputCompression !== undefined ? { output_compression: String(options.outputCompression) } : {}),
    ...(options.moderation ? { moderation: options.moderation } : {}),
  }

  let response: Response
  if (references.length === 0) {
    response = await fetchWithProviderProxy(`${baseUrl}/images/generations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...common,
        n: 1,
        ...(options.outputCompression !== undefined ? { output_compression: options.outputCompression } : {}),
      }),
      signal: AbortSignal.timeout(OPENAI_IMAGE_TIMEOUT_MS),
    })
  } else {
    const form = new FormData()
    for (const [key, value] of Object.entries(common)) form.append(key, value)
    references.forEach((reference, index) => {
      const { blob, extension } = dataUrlToBlob(reference)
      form.append('image[]', blob, `reference-${index + 1}.${extension}`)
    })
    response = await fetchWithProviderProxy(`${baseUrl}/images/edits`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(OPENAI_IMAGE_TIMEOUT_MS),
    })
  }

  let payload: OpenAiImagesResponse
  try {
    payload = await readProviderJsonResponse<OpenAiImagesResponse>({
      response,
      provider: providerKey,
      phase: response.ok ? 'result' : 'submit',
      maxBytes: OPENAI_IMAGE_RESPONSE_MAX_BYTES,
    })
  } catch (error) {
    rejectedSubmission(providerKey, error)
  }
  if (!response.ok) {
    rejectedSubmission(providerKey, new ProviderHttpError({
      provider: providerKey,
      phase: 'submit',
      statusCode: response.status,
      requestId: response.headers.get('x-request-id'),
      contentType: response.headers.get('content-type'),
      errorEnvelope: payload,
      diagnosticText: JSON.stringify(payload).slice(0, 2_000),
    }))
  }
  const first = payload.data?.[0]
  if (first?.b64_json) {
    decodeBase64WithLimit(first.b64_json, MAX_IMAGE_BYTES, `${providerKey} generated image`)
    return {
      success: true,
      imageBase64: first.b64_json,
      imageUrl: `data:${mediaTypeForFormat(outputFormat)};base64,${first.b64_json}`,
      ...(payload.usage ? { metadata: { providerUsage: payload.usage } } : {}),
    }
  }
  if (first?.url) {
    return { success: true, imageUrl: first.url }
  }
  throw new Error(`${providerKey.toUpperCase()}_IMAGE_EMPTY_RESPONSE`)
}
