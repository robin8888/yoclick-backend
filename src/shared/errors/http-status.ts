/** Estados HTTP con nombre, para no escribir números sueltos en el código. */
export const HTTP_STATUS = {
  badRequest: 400,
  unauthorized: 401,
  forbidden: 403,
  notFound: 404,
  conflict: 409,
  preconditionFailed: 412,
  payloadTooLarge: 413,
  unprocessableEntity: 422,
  preconditionRequired: 428,
  tooManyRequests: 429,
  internalServerError: 500,
} as const;
