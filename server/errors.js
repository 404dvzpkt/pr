'use strict';

class ApiError extends Error {
  constructor(status, message, options = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.field = options.field || '';
    this.code = options.code || 'request_failed';
    this.details = options.details || null;
    this.headers = options.headers || null;
  }
}

class ValidationError extends ApiError {
  constructor(message, field = '') {
    super(422, message, { field });
    this.name = 'ValidationError';
  }
}

module.exports = { ApiError, ValidationError };
