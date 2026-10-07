import type {
  GenerateRequest,
  GenerateResult,
  ModelAdapter,
} from '../../modules/models/application/model-gateway.port.js';
import type { ModelCapability, QualityTier } from '../../modules/models/domain/model-policy.js';
import { MODEL_CAPABILITIES } from '../../modules/models/domain/model-policy.js';

const MOCK_TOOL_TRIGGER = '__mock_tool_call__';

/**
 * Deterministic in-process adapter for tests/CI — see
 * apothem-ai/CLAUDE.md ("Use the mock Model Gateway adapter in tests/CI").
 * Makes no network call and costs nothing. Supports every capability so
 * policy-matching tests aren't constrained by what the mock can do.
 */
export class MockModelAdapter implements ModelAdapter {
  readonly provider = 'mock';
  readonly qualityTier: QualityTier = 'standard';
  readonly capabilities: ReadonlySet<ModelCapability> = new Set(MODEL_CAPABILITIES);

  async generate(model: string, request: GenerateRequest): Promise<GenerateResult> {
    const lastUserMessage = [...request.messages].reverse().find((message) => message.role === 'user');
    const inputTokens = estimateTokens(request.systemInstructions + (lastUserMessage?.content ?? ''));

    if (lastUserMessage?.content.includes(MOCK_TOOL_TRIGGER) && request.tools?.length) {
      const tool = request.tools[0];
      if (!tool) {
        throw new Error('MOCK_TOOL_TRIGGER present but request.tools is empty');
      }
      const requested = parseRequestedCall(lastUserMessage.content);
      return {
        provider: this.provider,
        model,
        output: {
          type: 'tool_call',
          toolName: requested?.toolName ?? tool.name,
          arguments: requested ? requested.arguments : {},
        },
        usage: { inputTokens, outputTokens: 1 },
        finishReason: 'tool_call',
      };
    }

    const text = `Mock response to: ${lastUserMessage?.content ?? '(no user message)'}`;
    return {
      provider: this.provider,
      model,
      output: { type: 'text', text },
      usage: { inputTokens, outputTokens: estimateTokens(text) },
      finishReason: 'stop',
    };
  }
}

/** Rough, deterministic token estimate — good enough for mock usage accounting, never for billing. */
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/**
 * Test hook: "__mock_tool_call__ <tool_name> <json>" makes the mock request
 * that exact tool and arguments, even a tool that is not bound, so the
 * runtime's refusal paths can be exercised. Malformed JSON is passed through
 * as a string for the runtime to reject. Plain text after the trigger keeps
 * the original behavior: the first bound tool with empty arguments.
 */
function parseRequestedCall(content: string): { toolName: string; arguments: unknown } | undefined {
  const rest = content.slice(content.indexOf(MOCK_TOOL_TRIGGER) + MOCK_TOOL_TRIGGER.length).trim();
  const match = /^([a-z][a-z0-9_]*)(?:\s+(.*))?$/s.exec(rest);
  if (!match || match[2] === undefined) {
    return undefined;
  }
  const [, toolName, rawArguments] = match;
  if (!toolName || !rawArguments?.trimStart().startsWith('{')) {
    return undefined;
  }
  try {
    return { toolName, arguments: JSON.parse(rawArguments) as unknown };
  } catch {
    return { toolName, arguments: rawArguments };
  }
}
