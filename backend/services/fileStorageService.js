const fs = require('node:fs/promises');
const path = require('node:path');
const config = require('../config');

function getFilePath(fileName) {
  if (typeof fileName !== 'string' || !/^[a-zA-Z0-9_-]+\.json$/.test(fileName)) {
    throw new TypeError('Storage file name must be a simple JSON file name.');
  }

  return path.join(config.dataDirectory, fileName);
}

async function readJson(fileName, defaultValue = null) {
  const filePath = getFilePath(fileName);

  try {
    const contents = await fs.readFile(filePath, 'utf8');
    return JSON.parse(contents);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return defaultValue;
    }

    throw error;
  }
}

async function writeJson(fileName, value) {
  const filePath = getFilePath(fileName);
  await fs.mkdir(config.dataDirectory, { recursive: true });

  const temporaryPath = `${filePath}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(temporaryPath, filePath);
}

module.exports = { readJson, writeJson };
