import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../../common/errors.js';

/**
 * Normalized error shape from apothem-ai/docs/10-api/auth-versioning-pagination-errors.md.
 * Never forwards a raw stack trace/message from an unclassified (500) error
 * to the client — only the request id, so it can be correlated with server
 * logs, which do get the full error via request.log.
 */
interface NormalizedErrorBody {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: Record<string, unknown>;
  };
}

const APP_ERROR_STATUS: Record<AppError['kind'], number> = {
  invalid_input: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
};

const APP_ERROR_CODE: Record<AppError['kind'], string> = {
  invalid_input: 'INVALID_INPUT',
  unauthenticated: 'UNAUTHENTICATED',
  forbidden: 'FORBIDDEN',
  not_found: 'NOT_FOUND',
  conflict: 'CONFLICT',
};

export function errorHandler(
  error: FastifyError | AppError | ZodError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  const requestId = request.id;

  if (error instanceof AppError) {
    const body: NormalizedErrorBody = {
      error: { code: APP_ERROR_CODE[error.kind], message: error.message, requestId },
    };
    reply.status(APP_ERROR_STATUS[error.kind]).send(body);
    return;
  }

  if ('validation' in error && error.validation) {
    const body: NormalizedErrorBody = {
      error: {
        code: 'INVALID_INPUT',
        message: 'Request validation failed',
        requestId,
        details: { issues: error.validation },
      },
    };
    reply.status(400).send(body);
    return;
  }

  if (error instanceof ZodError) {
    const body: NormalizedErrorBody = {
      error: {
        code: 'INVALID_INPUT',
        message: 'Request validation failed',
        requestId,
        details: { issues: error.issues },
      },
    };
    reply.status(400).send(body);
    return;
  }

  request.log.error({ err: error, requestId }, 'Unhandled error');
  const body: NormalizedErrorBody = {
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', requestId },
  };
  reply.status(500).send(body);
}
