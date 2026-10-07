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

  it('can be told which bound tool to call and with which JSON arguments', async () => {
    const request: GenerateRequest = {
      systemInstructions: 'sys',
      messages: [{ role: 'user', content: '__mock_tool_call__ create_note {"title":"T","body":"B"}' }],
      tools: [
        { name: 'get_current_time', description: 'time', parameters: {} },
        { name: 'create_note', description: 'note', parameters: {} },
      ],
    };
    const result = await adapter.generate('mock-1', request);
    expect(result.output).toEqual({ type: 'tool_call', toolName: 'create_note', arguments: { title: 'T', body: 'B' } });
  });

  it('can request a tool that is not bound, so the runtime refusal path can be exercised', async () => {
    const request: GenerateRequest = {
      systemInstructions: 'sys',
      messages: [{ role: 'user', content: '__mock_tool_call__ drop_database {}' }],
      tools: [{ name: 'get_current_time', description: 'time', parameters: {} }],
    };
    const result = await adapter.generate('mock-1', request);
    expect(result.output).toEqual({ type: 'tool_call', toolName: 'drop_database', arguments: {} });
  });

  it('passes malformed JSON arguments through as a string so validation can reject them', async () => {
    const request: GenerateRequest = {
      systemInstructions: 'sys',
      messages: [{ role: 'user', content: '__mock_tool_call__ create_note {not json' }],
      tools: [{ name: 'create_note', description: 'note', parameters: {} }],
    };
    const result = await adapter.generate('mock-1', request);
    expect(result.output).toEqual({ type: 'tool_call', toolName: 'create_note', arguments: '{not json' });
  });

  it('answers with text once a tool result is part of the conversation', async () => {
    const request: GenerateRequest = {
      systemInstructions: 'sys',
      messages: [
        { role: 'user', content: '__mock_tool_call__ get_current_time {}' },
        { role: 'assistant', content: 'Calling get_current_time' },
        { role: 'user', content: 'TOOL RESULT for get_current_time: {"now":"x"}' },
      ],
      tools: [{ name: 'get_current_time', description: 'time', parameters: {} }],
    };
    const result = await adapter.generate('mock-1', request);
    expect(result.output.type).toBe('text');
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
