import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read the main package.json
const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

// Create a simplified package.json for the dist folder
const distPackageJson = {
  name: packageJson.name,
  version: packageJson.version,
  description: packageJson.description,
  main: 'index.js', // relative to dist
  types: 'index.d.ts', // relative to dist
  author: packageJson.author,
  license: packageJson.license,
  repository: packageJson.repository,
  type: packageJson.type, // preserve the "type": "module"
  dependencies: packageJson.dependencies // include dependencies
};

// Write the dist package.json
fs.writeFileSync(
  path.join(__dirname, '..', 'dist', 'package.json'),
  JSON.stringify(distPackageJson, null, 2)
);

console.log('dist/package.json has been created.');

// Copy README.md and LICENSE to dist folder
['README.md', 'LICENSE'].forEach(file => {
  fs.copyFileSync(
    path.join(__dirname, '..', file),
    path.join(__dirname, '..', 'dist', file)
  );
  console.log(`${file} has been copied to dist folder.`);
});
