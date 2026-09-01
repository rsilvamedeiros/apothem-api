import { describe, expect, it } from 'vitest';
import { MockModelAdapter } from './mock-model.adapter.js';
import type { GenerateRequest } from '../../modules/models/application/model-gateway.port.js';

describe('MockModelAdapter', () => {
  const adapter = new MockModelAdapter();

  it('deterministically echoes the last user message as text', async () => {
    const request: GenerateRequest = {
      systemInstructions: 'You are a test agent.',
      messages: [{ role: 'user', content: 'What is the status of order 42?' }],
    };
    const result = await adapter.generate('mock-1', request);
    expect(result.output).toEqual({
      type: 'text',
      text: 'Mock response to: What is the status of order 42?',
    });
    expect(result.finishReason).toBe('stop');
    expect(result.usage.inputTokens).toBeGreaterThan(0);
  });

  it('returns the same output for the same input across calls (determinism)', async () => {
    const request: GenerateRequest = {
      systemInstructions: 'sys',
      messages: [{ role: 'user', content: 'ping' }],
    };
    const first = await adapter.generate('mock-1', request);
    const second = await adapter.generate('mock-1', request);
    expect(first).toEqual(second);
  });

  it('returns a tool_call when the trigger phrase is present and a tool is bound', async () => {
    const request: GenerateRequest = {
      systemInstructions: 'sys',
      messages: [{ role: 'user', content: '__mock_tool_call__ please check inventory' }],
      tools: [{ name: 'check_inventory', description: 'Checks inventory', parameters: {} }],
    };
    const result = await adapter.generate('mock-1', request);
    expect(result.output).toEqual({ type: 'tool_call', toolName: 'check_inventory', arguments: {} });
    expect(result.finishReason).toBe('tool_call');
  });

  it('ignores the tool trigger when no tool is bound', async () => {
    const request: GenerateRequest = {
      systemInstructions: 'sys',
      messages: [{ role: 'user', content: '__mock_tool_call__ please check inventory' }],
    };
    const result = await adapter.generate('mock-1', request);
    expect(result.output.type).toBe('text');
  });
});
