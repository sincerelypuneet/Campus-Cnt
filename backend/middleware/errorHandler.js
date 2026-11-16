module.exports = function errorHandler(error, request, response, next) {
  if (response.headersSent) {
    return next(error);
  }

  const status = Number.isInteger(error.status) ? error.status : 500;
  if (status >= 500) {
    console.error(error);
  }

  response.status(status).json({
    error: status === 500 ? 'Internal server error' : error.message,
  });
};
