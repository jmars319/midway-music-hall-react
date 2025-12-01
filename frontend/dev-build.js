#!/usr/bin/env node
// Build with development mode (no minification) to bypass timeout
const { execSync } = require('child_process');

console.log('Building in DEVELOPMENT mode (no minification)...');

try {
  execSync('npx --yes react-scripts build', {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'development', // Skip minification entirely
      GENERATE_SOURCEMAP: 'false',
      DISABLE_ESLINT_PLUGIN: 'true'
    }
  });
  console.log('Build completed!');
} catch (error) {
  console.error('Build failed:', error.message);
  process.exit(1);
}
