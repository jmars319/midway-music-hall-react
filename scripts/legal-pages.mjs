#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const contentPath = path.join(rootDir, 'frontend', 'src', 'content', 'legalContent.json');
const privacyOutputPath = path.join(rootDir, 'frontend', 'public', 'privacy', 'index.html');
const termsOutputPath = path.join(rootDir, 'frontend', 'public', 'terms', 'index.html');

const mode = (process.argv[2] || 'generate').toLowerCase();
const legalContent = JSON.parse(fs.readFileSync(contentPath, 'utf8'));

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderSections(sections) {
  return sections.map((section) => {
    const paragraphs = (section.paragraphs || [])
      .map((paragraph) => `        <p>${escapeHtml(paragraph)}</p>`)
      .join('\n');
    const bullets = Array.isArray(section.bullets) && section.bullets.length > 0
      ? [
          '        <ul>',
          ...section.bullets.map((bullet) => `          <li>${escapeHtml(bullet)}</li>`),
          '        </ul>',
        ].join('\n')
      : '';
    const followupParagraphs = (section.followupParagraphs || [])
      .map((paragraph) => `        <p>${escapeHtml(paragraph)}</p>`)
      .join('\n');
    return [
      `        <h2>${escapeHtml(section.heading)}</h2>`,
      paragraphs,
      bullets,
      followupParagraphs,
    ].filter(Boolean).join('\n');
  }).join('\n\n');
}

function renderLegalHtml(documentKey, config) {
  const alternatePath = documentKey === 'privacy' ? '/terms' : '/privacy';
  const alternateLabel = documentKey === 'privacy' ? 'Terms of Service' : 'Privacy Policy';
  const contentHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(config))
    .digest('hex')
    .slice(0, 12);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(config.title)} | Midway Music Hall</title>
    <meta name="description" content="${escapeHtml(config.metaDescription)}" />
    <link rel="canonical" href="https://midwaymusichall.net/${documentKey}" />
    <meta name="robots" content="index,follow" />
    <style>
      body {
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #0b0b0d;
        color: #e6edf3;
      }
      .skip-link {
        position: absolute;
        top: -40px;
        left: 0;
        background: #7e22ce;
        color: #fff;
        padding: 8px 16px;
        text-decoration: none;
        z-index: 100;
        border-radius: 0 0 4px 0;
        font-weight: 600;
      }
      .skip-link:focus {
        top: 0;
      }
      .shell {
        max-width: 960px;
        margin: 0 auto;
        padding: 32px 16px 48px;
      }
      .nav {
        display: flex;
        gap: 16px;
        justify-content: space-between;
        flex-wrap: wrap;
        margin-bottom: 24px;
      }
      .nav a {
        color: #c084fc;
        text-decoration: none;
        font-weight: 600;
      }
      .card {
        background: #111827;
        border: 1px solid rgba(192, 132, 252, 0.2);
        border-radius: 18px;
        padding: 28px;
        box-shadow: 0 18px 60px rgba(0, 0, 0, 0.35);
      }
      h1 {
        margin-top: 0;
        margin-bottom: 24px;
        font-size: 2.25rem;
      }
      h2 {
        margin-top: 32px;
        margin-bottom: 12px;
        font-size: 1.35rem;
        color: #fff;
      }
      p,
      li {
        color: #d1d5db;
        line-height: 1.7;
      }
      ul {
        margin: 12px 0 0 20px;
        padding: 0;
      }
      .meta {
        margin-top: 28px;
        font-size: 14px;
        color: #d1d5db;
      }
    </style>
  </head>
  <body>
    <!-- Generated from frontend/src/content/legalContent.json. Content hash: ${contentHash} -->
    <a href="#main" class="skip-link">Skip to content</a>
    <div class="shell">
      <div class="nav">
        <a href="/">Midway Music Hall</a>
        <a href="${alternatePath}">${alternateLabel}</a>
      </div>
      <main id="main" tabindex="-1" class="card">
        <h1>${escapeHtml(config.title)}</h1>
${renderSections(config.sections)}

        <p class="meta">Last updated: ${escapeHtml(config.lastUpdated)}</p>
      </main>
    </div>
  </body>
</html>
`;
}

const outputs = [
  { key: 'privacy', path: privacyOutputPath },
  { key: 'terms', path: termsOutputPath },
];

let hasFailure = false;
for (const output of outputs) {
  const config = legalContent[output.key];
  if (!config) {
    console.error(`[legal-pages] missing content for ${output.key}`);
    hasFailure = true;
    continue;
  }
  const rendered = renderLegalHtml(output.key, config);
  if (mode === 'verify') {
    const current = fs.existsSync(output.path) ? fs.readFileSync(output.path, 'utf8') : '';
    if (current !== rendered) {
      console.error(`[legal-pages] ${path.relative(rootDir, output.path)} is out of sync with frontend/src/content/legalContent.json`);
      hasFailure = true;
    }
    continue;
  }
  fs.mkdirSync(path.dirname(output.path), { recursive: true });
  fs.writeFileSync(output.path, rendered);
  console.log(`[legal-pages] wrote ${path.relative(rootDir, output.path)}`);
}

if (hasFailure) {
  process.exit(1);
}
