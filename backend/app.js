const express = require('express');
const path = require('node:path');
const config = require('./config');
const apiRoutes = require('./routes/apiRoutes');
const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');

const app = express();

app.use(express.json());
app.use('/api', apiRoutes);
app.use(express.static(config.frontendDirectory));

app.get('/', (request, response) => {
  response.sendFile(path.join(config.frontendDirectory, 'index.html'));
});

app.use(notFound);
app.use(errorHandler);

module.exports = app;
