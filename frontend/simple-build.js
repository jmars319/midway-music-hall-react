#!/usr/bin/env node
// Simple build script that bypasses react-scripts optimization issues
const { execSync } = require('child_process');

process.env.GENERATE_SOURCEMAP = 'false';
process.env.DISABLE_ESLINT_PLUGIN = 'true';
process.env.NODE_OPTIONS = '--max-old-space-size=4096';

console.log('Starting simple build...');

try {
  execSync('npx --yes react-scripts build', {
    stdio: 'inherit',
    env: {
      ...process.env,
      GENERATE_SOURCEMAP: 'false',
      DISABLE_ESLINT_PLUGIN: 'true'
    },
    timeout: 120000 // 2 minute timeout
  });
  console.log('Build completed successfully!');
} catch (error) {
  console.error('Build failed:', error.message);
  process.exit(1);
}
