import { describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { extractCredential } from './tenant-context.middleware.js';

const request = (headers: Record<string, string | string[] | undefined>) => ({ headers }) as unknown as FastifyRequest;

describe('extractCredential', () => {
  describe('x-principal-id source (dev only)', () => {
    it('reads the dev header', () => {
      expect(extractCredential(request({ 'x-principal-id': 'abc' }), 'x-principal-id')).toBe('abc');
    });

    it('ignores a bearer token', () => {
      expect(extractCredential(request({ authorization: 'Bearer abc' }), 'x-principal-id')).toBeUndefined();
    });

    it.each([undefined, '', ['a', 'b']])('treats %j as no credential', (value) => {
      expect(extractCredential(request({ 'x-principal-id': value }), 'x-principal-id')).toBeUndefined();
    });
  });

  describe('bearer source', () => {
    it('reads a bearer token', () => {
      expect(extractCredential(request({ authorization: 'Bearer abc.def.ghi' }), 'bearer')).toBe('abc.def.ghi');
    });

    it('accepts the scheme case-insensitively and trims', () => {
      expect(extractCredential(request({ authorization: 'bearer   token ' }), 'bearer')).toBe('token');
    });

    it('never falls back to the dev header, so production cannot be impersonated with a user id', () => {
      expect(extractCredential(request({ 'x-principal-id': 'victim-id' }), 'bearer')).toBeUndefined();
      expect(
        extractCredential(request({ 'x-principal-id': 'victim-id', authorization: 'Basic abc' }), 'bearer'),
      ).toBeUndefined();
    });

    it.each([
      undefined,
      '',
      'Bearer',
      'Bearer ',
      'Basic dXNlcjpwYXNz',
      'Token abc',
      'Bearerabc',
      'Bearer a b',
      ['Bearer a', 'Bearer b'],
    ])('rejects %j', (value) => {
      expect(extractCredential(request({ authorization: value }), 'bearer')).toBeUndefined();
    });
  });
});
