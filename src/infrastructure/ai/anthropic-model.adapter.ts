import Anthropic from '@anthropic-ai/sdk';
import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  type GenerateRequest,
  type GenerateResult,
  type ModelAdapter,
} from '../../modules/models/application/model-gateway.port.js';
import type { ModelCapability, QualityTier } from '../../modules/models/domain/model-policy.js';
import { ModelProviderError, type ModelErrorClass } from '../../modules/models/domain/model-error.js';

const CAPABILITIES: ReadonlySet<ModelCapability> = new Set([
  'tool_calling',
  'structured_output',
  'vision',
  'long_context',
]);

/**
 * The only file allowed to import `@anthropic-ai/sdk` — see
 * infrastructure/ai/README.md. Everything else depends on ModelAdapter /
 * ModelGatewayPort. Exercising this against the real API incurs token
 * cost; only the mock adapter runs in tests/CI (apothem-ai/CLAUDE.md).
 */
export class AnthropicModelAdapter implements ModelAdapter {
  readonly provider = 'anthropic';
  readonly qualityTier: QualityTier = 'premium';
  readonly capabilities = CAPABILITIES;

  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async generate(model: string, request: GenerateRequest): Promise<GenerateResult> {
    try {
      const response = await this.client.messages.create({
        model,
        max_tokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        system: request.systemInstructions,
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        messages: request.messages
          .filter((message) => message.role !== 'system')
          .map((message) => ({ role: message.role as 'user' | 'assistant', content: message.content })),
        ...(request.tools
          ? {
              tools: request.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                input_schema: { type: 'object' as const, ...tool.parameters },
              })),
            }
          : {}),
      });

      return {
        provider: this.provider,
        model: response.model,
        output: toGenerateOutput(response),
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
        finishReason: toFinishReason(response.stop_reason),
      };
    } catch (error) {
      throw new ModelProviderError(
        error instanceof Error ? error.message : 'Unknown Anthropic API error',
        classifyError(error),
        this.provider,
        { cause: error },
      );
    }
  }
}

function toGenerateOutput(response: Anthropic.Message): GenerateResult['output'] {
  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
  );
  if (toolUse) {
    return { type: 'tool_call', toolName: toolUse.name, arguments: toolUse.input };
  }
  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');
  return { type: 'text', text };
}

function toFinishReason(stopReason: Anthropic.Message['stop_reason']): GenerateResult['finishReason'] {
  switch (stopReason) {
    case 'tool_use':
      return 'tool_call';
    case 'max_tokens':
    case 'model_context_window_exceeded':
      return 'length';
    case 'refusal':
      return 'content_filter';
    case 'end_turn':
    case 'stop_sequence':
    case 'pause_turn':
    default:
      return 'stop';
  }
}

function classifyError(error: unknown): ModelErrorClass {
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return 'auth';
  }
  if (error instanceof Anthropic.RateLimitError) {
    return 'rate_limit';
  }
  if (error instanceof Anthropic.BadRequestError || error instanceof Anthropic.UnprocessableEntityError) {
    return 'invalid_request';
  }
  if (
    error instanceof Anthropic.InternalServerError ||
    error instanceof Anthropic.APIConnectionError ||
    error instanceof Anthropic.APIConnectionTimeoutError
  ) {
    return 'unavailable';
  }
  return 'transient';
}
