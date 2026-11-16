module.exports = function notFound(request, response, next) {
  const error = new Error(`Not found: ${request.method} ${request.originalUrl}`);
  error.status = 404;
  next(error);
};
