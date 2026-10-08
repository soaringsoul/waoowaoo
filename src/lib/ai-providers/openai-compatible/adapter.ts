import type { AiProviderAdapter } from '@/lib/ai-providers/runtime-types'
import { createAiProviderFailureAdapter } from '@/lib/ai-providers/failure'
import { createAiSdkConnectionTester } from '@/lib/ai-providers/shared/connection-test'
import { describeMediaVariantBase } from '@/lib/ai-providers/shared/media-adapter'
import {
  createBearerResponsesAssistantGateway,
  createOpenAiStyleLanguageModel,
} from '@/lib/ai-providers/shared/openai-responses'
import { executeOpenAiImagesApiGeneration } from '@/lib/ai-providers/shared/openai-images'
import {
  OPENAI_COMPATIBLE_PROVIDER_KEY,
  OPENAI_COMPATIBLE_TEST_LLM_MODEL_ID,
  resolveOpenAiCompatibleOptionSchema,
} from './models'

const failure = createAiProviderFailureAdapter(OPENAI_COMPATIBLE_PROVIDER_KEY)

export const openAiCompatibleAdapter: AiProviderAdapter = {
  providerKey: OPENAI_COMPATIBLE_PROVIDER_KEY,
  failure,
  assistantGateway: createBearerResponsesAssistantGateway(OPENAI_COMPATIBLE_PROVIDER_KEY),
  languageModel: {
    create: (input) => createOpenAiStyleLanguageModel(input),
  },
  image: {
    describe: (selection) => describeMediaVariantBase({
      modality: 'image',
      selection,
      executionMode: 'sync',
      optionSchema: resolveOpenAiCompatibleOptionSchema('image', selection.modelId),
    }),
    execute: (input) => executeOpenAiImagesApiGeneration(OPENAI_COMPATIBLE_PROVIDER_KEY, input),
  },
  connectionTest: createAiSdkConnectionTester({
    providerKey: OPENAI_COMPATIBLE_PROVIDER_KEY,
    failure,
    displayName: 'OpenAI-compatible',
    defaultBaseUrl: '',
    defaultTestModel: OPENAI_COMPATIBLE_TEST_LLM_MODEL_ID,
    protocol: 'openai-compatible-chat',
    createLanguageModel: (input) => createOpenAiStyleLanguageModel(input),
  }),
}
