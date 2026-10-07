import AjvCompiler from '@fastify/ajv-compiler';
import type { FastifySchemaCompiler } from 'fastify';

/**
 * Same options as Fastify's defaults (strip unknown fields, apply defaults)
 * except for the body: a JSON body keeps its types. The default `coerceTypes`
 * would turn `{"input": 5}` into the string "5" and `{"flag": "true"}` into
 * a boolean, so a request could silently mean something other than what was
 * sent. Query and path values are text on the wire, so those still coerce.
 */
const buildCompiler = AjvCompiler();
const BASE_OPTIONS = { removeAdditional: true, useDefaults: true, allErrors: false } as const;

const strict = buildCompiler({}, { customOptions: { ...BASE_OPTIONS, coerceTypes: false } });
const coercing = buildCompiler({}, { customOptions: { ...BASE_OPTIONS, coerceTypes: 'array' } });

export const requestValidatorCompiler: FastifySchemaCompiler<unknown> = (options) =>
  (options.httpPart === 'body' ? strict : coercing)(options as never) as never;
