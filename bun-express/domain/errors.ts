// ─── Domain errors: business-rule failures the web adapter maps to HTTP codes ─

/** Stable machine-readable code carried by every domain error. */
export type DomainErrorCode = 'BAD_REQUEST' | 'NOT_FOUND';

/** Invalid id / missing content → adapter returns 400. */
export class BadRequestError extends Error {
  readonly code: DomainErrorCode = 'BAD_REQUEST';

  constructor(message: string) {
    super(message);
    this.name = 'BadRequestError';
  }
}

/** Unknown resource → adapter returns 404. */
export class NotFoundError extends Error {
  readonly code: DomainErrorCode = 'NOT_FOUND';

  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}