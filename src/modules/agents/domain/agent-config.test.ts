import { describe, expect, it } from 'vitest';
import { parseGuardrails, parseModelPolicy, DEFAULT_RUN_LIMITS, RUN_LIMIT_CEILINGS } from './agent-config.js';

describe('parseModelPolicy', () => {
  it('accepts an empty policy (any approved route)', () => {
    expect(parseModelPolicy({})).toEqual({ ok: true, value: {} });
  });

  it('accepts every documented field', () => {
    const policy = {
      requiredCapabilities: ['tool_calling', 'vision'],
      qualityTier: 'standard',
      allowedProviders: ['anthropic'],
      disallowedProviders: ['mock'],
      maxCostPerRunUsd: 0.5,
      fallbackAllowed: false,
    };
    expect(parseModelPolicy(policy)).toEqual({ ok: true, value: policy });
  });

  it.each([
    ['unknown key', { vendor: 'x' }],
    ['unknown capability', { requiredCapabilities: ['telepathy'] }],
    ['unknown tier', { qualityTier: 'ultra' }],
    ['non-array providers', { allowedProviders: 'anthropic' }],
    ['empty provider name', { allowedProviders: [''] }],
    ['negative budget', { maxCostPerRunUsd: -1 }],
    ['non-finite budget', { maxCostPerRunUsd: Number.POSITIVE_INFINITY }],
    ['string budget', { maxCostPerRunUsd: '5' }],
    ['non-boolean fallback', { fallbackAllowed: 'yes' }],
    ['array instead of object', []],
    ['null', null],
    ['string', 'x'],
  ])('rejects %s', (_label, value) => {
    expect(parseModelPolicy(value).ok).toBe(false);
  });

  it('reports which field is wrong without echoing its value', () => {
    const result = parseModelPolicy({ qualityTier: 'ultra-secret-value' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.join(' ')).toContain('qualityTier');
      expect(result.issues.join(' ')).not.toContain('ultra-secret-value');
    }
  });
});

describe('parseGuardrails (run limits)', () => {
  it('applies defaults for an empty object', () => {
    expect(parseGuardrails({})).toEqual({ ok: true, value: DEFAULT_RUN_LIMITS });
  });

  it('accepts limits at or below the ceilings', () => {
    const limits = { maxOutputTokens: RUN_LIMIT_CEILINGS.maxOutputTokens, timeoutMs: RUN_LIMIT_CEILINGS.timeoutMs };
    expect(parseGuardrails(limits)).toEqual({ ok: true, value: limits });
  });

  it.each([
    ['above the token ceiling', { maxOutputTokens: RUN_LIMIT_CEILINGS.maxOutputTokens + 1 }],
    ['above the time ceiling', { timeoutMs: RUN_LIMIT_CEILINGS.timeoutMs + 1 }],
    ['zero tokens', { maxOutputTokens: 0 }],
    ['fractional tokens', { maxOutputTokens: 10.5 }],
    ['too small timeout', { timeoutMs: 10 }],
    ['unknown key (a typo must not silently disable a guardrail)', { maxOutputToken: 100 }],
    ['string value', { timeoutMs: '1000' }],
    ['array', []],
    ['null', null],
  ])('rejects %s', (_label, value) => {
    expect(parseGuardrails(value).ok).toBe(false);
  });

  it('fills only the missing field with its default', () => {
    expect(parseGuardrails({ timeoutMs: 5000 })).toEqual({
      ok: true,
      value: { maxOutputTokens: DEFAULT_RUN_LIMITS.maxOutputTokens, timeoutMs: 5000 },
    });
  });
});
