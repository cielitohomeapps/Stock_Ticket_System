const {logger} = require("../services/observability.service");

/**
 * Global error handler middleware for Express.
 * Must be registered AFTER all other routes and middleware.
 * Converts any unhandled error into a proper JSON response with valid HTTP status code.
 */
function errorHandler(err, req, res, next) {
  // Determine status code - ensure it's always a valid number
  let statusCode = 500;
  if (typeof err.statusCode === "number" && err.statusCode >= 400 && err.statusCode < 600) {
    statusCode = err.statusCode;
  } else if (typeof err.status === "number" && err.status >= 400 && err.status < 600) {
    statusCode = err.status;
  } else if (err.status === "fail") {
    // Convert invalid string status to proper code
    statusCode = 400;
  } else if (err.status === "error") {
    statusCode = 500;
  }

  // Never use non-numeric or invalid status codes
  if (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) {
    statusCode = 500;
  }

  // Build error response
  logger.error("Error no controlado en solicitud HTTP", {
    eventType: "UNHANDLED_HTTP_ERROR",
    module: "http",
    requestId: req.id,
    correlationId: req.correlationId,
    method: req.method,
    route: req.path,
    statusCode,
  }, err);

  const errorResponse = {
    error: statusCode >= 500 && process.env.NODE_ENV === "production"
      ? "Error interno del servidor"
      : err.message || "Internal Server Error",
    status: statusCode,
    code: err.code || "UNEXPECTED_ERROR",
  };

  // Include request ID for tracing if available
  if (req.id) {
    errorResponse.requestId = req.id;
  }

  // Return JSON response with valid status code
  return res.status(statusCode).json(errorResponse);
}

module.exports = errorHandler;
