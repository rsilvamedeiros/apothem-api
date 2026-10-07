import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { AnthropicModelAdapter } from './anthropic-model.adapter.js';
import { ModelProviderError, type ModelErrorClass } from '../../modules/models/domain/model-error.js';
import type { GenerateRequest } from '../../modules/models/application/model-gateway.port.js';

type CreateParams = Parameters<Anthropic['messages']['create']>[0];

function adapterWith(create: (params: CreateParams) => Promise<unknown>) {
  const calls: CreateParams[] = [];
  const fakeClient = {
    messages: {
      create: async (params: CreateParams) => {
        calls.push(params);
        return create(params);
      },
    },
  } as unknown as Anthropic;
  return { adapter: new AnthropicModelAdapter('sk-test-unused', fakeClient), calls };
}

function message(overrides: Record<string, unknown>) {
  return {
    model: 'claude-test',
    content: [{ type: 'text', text: 'hello' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 5 },
    ...overrides,
  };
}

const REQUEST: GenerateRequest = {
  systemInstructions: 'Be brief.',
  messages: [
    { role: 'system', content: 'ignored system message' },
    { role: 'user', content: 'Hi' },
    { role: 'assistant', content: 'Hello' },
    { role: 'user', content: 'Again' },
  ],
};

describe('AnthropicModelAdapter (no network)', () => {
  it('maps the request: system prompt separate, system-role messages dropped, default output cap', async () => {
    const { adapter, calls } = adapterWith(async () => message({}));
    await adapter.generate('claude-test', REQUEST);

    expect(calls[0]).toMatchObject({ model: 'claude-test', system: 'Be brief.', max_tokens: 1024 });
    expect(calls[0]?.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(calls[0]).not.toHaveProperty('temperature');
    expect(calls[0]).not.toHaveProperty('tools');
  });

  it('forwards temperature, output cap and tool definitions when provided', async () => {
    const { adapter, calls } = adapterWith(async () => message({}));
    await adapter.generate('claude-test', {
      ...REQUEST,
      temperature: 0.2,
      maxOutputTokens: 50,
      tools: [{ name: 'lookup', description: 'Find', parameters: { properties: { q: { type: 'string' } } } }],
    });
    expect(calls[0]).toMatchObject({
      temperature: 0.2,
      max_tokens: 50,
      tools: [{ name: 'lookup', description: 'Find', input_schema: { type: 'object', properties: { q: { type: 'string' } } } }],
    });
  });

  it('returns normalized text output with usage and the provider-reported model', async () => {
    const { adapter } = adapterWith(async () =>
      message({ content: [{ type: 'text', text: 'foo' }, { type: 'text', text: 'bar' }] }),
    );
    const result = await adapter.generate('requested-model', REQUEST);
    expect(result).toEqual({
      provider: 'anthropic',
      model: 'claude-test',
      output: { type: 'text', text: 'foobar' },
      usage: { inputTokens: 10, outputTokens: 5 },
      finishReason: 'stop',
    });
  });

  it('returns a tool_call (never executing it) when the model requests a tool', async () => {
    const { adapter } = adapterWith(async () =>
      message({
        content: [
          { type: 'text', text: 'thinking' },
          { type: 'tool_use', id: 't1', name: 'lookup', input: { q: 'x' } },
        ],
        stop_reason: 'tool_use',
      }),
    );
    const result = await adapter.generate('m', REQUEST);
    expect(result.output).toEqual({ type: 'tool_call', toolName: 'lookup', arguments: { q: 'x' } });
    expect(result.finishReason).toBe('tool_call');
  });

  it.each([
    ['end_turn', 'stop'],
    ['stop_sequence', 'stop'],
    ['pause_turn', 'stop'],
    ['max_tokens', 'length'],
    ['model_context_window_exceeded', 'length'],
    ['refusal', 'content_filter'],
    ['tool_use', 'tool_call'],
    [null, 'stop'],
  ])('maps stop_reason %s to finishReason %s', async (stopReason, expected) => {
    const { adapter } = adapterWith(async () => message({ stop_reason: stopReason }));
    expect((await adapter.generate('m', REQUEST)).finishReason).toBe(expected);
  });

  it.each<[number, ModelErrorClass]>([
    [401, 'auth'],
    [403, 'auth'],
    [429, 'rate_limit'],
    [400, 'invalid_request'],
    [422, 'invalid_request'],
    [500, 'unavailable'],
  ])('classifies an HTTP %i API error as %s', async (status, expected) => {
    const { adapter } = adapterWith(async () => {
      throw Anthropic.APIError.generate(status, { type: 'error', error: { type: 'x', message: 'nope' } }, 'nope', new Headers());
    });
    const error = await adapter.generate('m', REQUEST).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ModelProviderError);
    expect(error).toMatchObject({ errorClass: expected, provider: 'anthropic' });
  });

  it('classifies a connection failure as unavailable', async () => {
    const { adapter } = adapterWith(async () => {
      throw new Anthropic.APIConnectionError({ message: 'socket hang up' });
    });
    await expect(adapter.generate('m', REQUEST)).rejects.toMatchObject({ errorClass: 'unavailable' });
  });

  it('classifies an unknown failure as transient and keeps the cause', async () => {
    const cause = new Error('weird');
    const { adapter } = adapterWith(async () => {
      throw cause;
    });
    const error = (await adapter.generate('m', REQUEST).catch((e: unknown) => e)) as ModelProviderError;
    expect(error.errorClass).toBe('transient');
    expect(error.cause).toBe(cause);
  });

  it('never includes the API key in a surfaced error', async () => {
    const { adapter } = adapterWith(async () => {
      throw new Error('boom');
    });
    const error = (await adapter.generate('m', REQUEST).catch((e: unknown) => e)) as Error;
    expect(error.message).not.toContain('sk-test-unused');
  });
});
