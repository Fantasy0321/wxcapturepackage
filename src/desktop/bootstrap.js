// Electron bootstrap - registers ts-node for TypeScript main process
const path = require('path');

// Use absolute path to avoid directory confusion
const tsconfigPath = path.join(__dirname, 'tsconfig.desktop.json');

require('ts-node').register({
  project: tsconfigPath,
  transpileOnly: true,
});

require(path.join(__dirname, 'main.ts'));
