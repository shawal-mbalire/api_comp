'use strict';

// ─── Domain errors: business-rule failures the web adapter maps to HTTP codes ─

/** Invalid id / missing content → adapter returns 400. */
class BadRequestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BadRequestError';
    this.code = 'BAD_REQUEST';
  }
}

/** Unknown resource → adapter returns 404. */
class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotFoundError';
    this.code = 'NOT_FOUND';
  }
}

module.exports = { BadRequestError, NotFoundError };