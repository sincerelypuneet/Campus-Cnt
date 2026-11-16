const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');

module.exports = {
  port: Number(process.env.PORT) || 3000,
  frontendDirectory: path.join(projectRoot, 'frontend'),
  dataDirectory: path.join(__dirname, '..', 'database', 'data'),
};
