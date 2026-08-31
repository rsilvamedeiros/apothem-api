import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ZodTypeAny } from 'zod';

/** Converts a zod schema into a JSON Schema fragment Fastify/ajv and @fastify/swagger can both consume. */
export function toJsonSchema(schema: ZodTypeAny): Record<string, unknown> {
  return zodToJsonSchema(schema, { target: 'openApi3', $refStrategy: 'none' }) as Record<string, unknown>;
}

export const errorResponseJsonSchema = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        requestId: { type: 'string' },
        details: { type: 'object' },
      },
      required: ['code', 'message', 'requestId'],
    },
  },
  required: ['error'],
} as const;
