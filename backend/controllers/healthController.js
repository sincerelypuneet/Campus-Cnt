exports.getHealth = function getHealth(request, response) {
  response.json({
    status: 'ok',
    service: 'CampusSpace API',
  });
};
