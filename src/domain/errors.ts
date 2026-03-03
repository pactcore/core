export class IllegalStateTransitionError extends Error {
  constructor(
    public readonly from: string,
    public readonly to: string,
  ) {
    super(`Illegal task state transition: ${from} -> ${to}`);
    this.name = "IllegalStateTransitionError";
  }
}

export class NotFoundError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} not found: ${id}`);
    this.name = "NotFoundError";
  }
}

export class ValidationFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationFailedError";
  }
}

export class ConstraintViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConstraintViolationError";
  }
}
