class AppError extends Error {
  constructor({ code, message, statusCode = 500, details = null, expose = statusCode < 500, cause }) {
    super(message, { cause });
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.expose = expose;
  }
}

module.exports = AppError;
