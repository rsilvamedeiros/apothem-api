/**
 * Cross-module error taxonomy so HTTP wiring can map failures to status
 * codes without embedding business meaning — see architecture-overview.md
 * "Failure model" (classification determines response, not a blanket 500).
 */
export abstract class AppError extends Error {
  abstract readonly kind:
    | 'invalid_input'
    | 'unauthenticated'
    | 'forbidden'
    | 'not_found'
    | 'conflict';

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class UnauthenticatedError extends AppError {
  readonly kind = 'unauthenticated' as const;
}

export class ForbiddenError extends AppError {
  readonly kind = 'forbidden' as const;
}

export class NotFoundError extends AppError {
  readonly kind = 'not_found' as const;
}

export class ConflictError extends AppError {
  readonly kind = 'conflict' as const;
}
