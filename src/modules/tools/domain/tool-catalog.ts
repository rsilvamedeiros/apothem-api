import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ModelToolDefinition } from '../../models/application/model-gateway.port.js';
import type { ToolRisk } from './tool-policy.js';

/**
 * The catalog of tools an agent may be given. A tool is an application
 * capability with a typed contract (ADR-013): the model can only name one of
 * these and its arguments are validated against the schema below before
 * anything runs. Handlers live in the application layer; this file is data.
 */
export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly risk: ToolRisk;
  readonly argumentsSchema: z.ZodType<Record<string, unknown>>;
}

export const NOTE_TITLE_MAX = 200;
export const NOTE_BODY_MAX = 5000;

const getCurrentTime: ToolDefinition = {
  name: 'get_current_time',
  description: 'Returns the current date and time in UTC as an ISO 8601 string.',
  risk: 'read_only',
  argumentsSchema: z.object({}).strict(),
};

const createNote: ToolDefinition = {
  name: 'create_note',
  description: 'Saves a short note in the workspace so a person can follow up later. The note can be deleted afterwards.',
  risk: 'reversible_write',
  argumentsSchema: z
    .object({
      title: z.string().min(1).max(NOTE_TITLE_MAX),
      body: z.string().min(1).max(NOTE_BODY_MAX),
    })
    .strict(),
};

export const TOOL_CATALOG: Readonly<Record<string, ToolDefinition>> = {
  [getCurrentTime.name]: getCurrentTime,
  [createNote.name]: createNote,
};

export function listToolNames(): string[] {
  return Object.keys(TOOL_CATALOG);
}

export function getToolDefinition(name: string): ToolDefinition | undefined {
  // hasOwn guards against inherited keys such as "toString" or "__proto__".
  return Object.hasOwn(TOOL_CATALOG, name) ? TOOL_CATALOG[name] : undefined;
}

/** The provider-facing description of a tool: name, purpose and JSON schema, nothing about policy. */
export function toModelTool(definition: ToolDefinition): ModelToolDefinition {
  const { $schema: _schema, ...schema } = zodToJsonSchema(definition.argumentsSchema, { target: 'jsonSchema7' }) as Record<string, unknown>;
  return { name: definition.name, description: definition.description, parameters: schema };
}
