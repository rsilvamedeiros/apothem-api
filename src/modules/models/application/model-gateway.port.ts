import type { ModelCapability, ModelPolicy, QualityTier } from '../domain/model-policy.js';

export type ModelMessageRole = 'system' | 'user' | 'assistant';

export interface ModelMessage {
  readonly role: ModelMessageRole;
  readonly content: string;
}

export interface ModelToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}

export interface GenerateRequest {
  readonly systemInstructions: string;
  readonly messages: readonly ModelMessage[];
  readonly tools?: readonly ModelToolDefinition[];
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
}

export type GenerateOutput =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'tool_call'; readonly toolName: string; readonly arguments: unknown };

export interface GenerateResult {
  readonly provider: string;
  readonly model: string;
  readonly output: GenerateOutput;
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
  readonly finishReason: 'stop' | 'tool_call' | 'length' | 'content_filter';
}

/**
 * One adapter per provider. Only src/infrastructure/ai may implement this —
 * see its README ("the only place in the codebase allowed to import a
 * provider SDK"). `capabilities`/`qualityTier` are static per-adapter
 * metadata the router matches against a policy; they do not reflect live
 * provider availability/rate limits (that is a future routing concern).
 */
export interface ModelAdapter {
  readonly provider: string;
  readonly qualityTier: QualityTier;
  readonly capabilities: ReadonlySet<ModelCapability>;
  generate(model: string, request: GenerateRequest): Promise<GenerateResult>;
}

/**
 * The normalized interface the rest of the codebase depends on — modules
 * never call a ModelAdapter directly, only this gateway, so routing/policy
 * enforcement can never be bypassed.
 */
export interface ModelGatewayPort {
  generate(policy: ModelPolicy, request: GenerateRequest): Promise<GenerateResult>;
}
