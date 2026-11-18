#!/usr/bin/env node
'use strict';
// Pre-publish check (FR-MKT-3): requests, anonymously, every URL the published
// package page will contain, and fails if any does not answer 200 after
// redirects. Run it before `vsce publish` (and again after the repository is
// made public): while the repo is private, the README's screenshots and links
// resolve to 404 for everyone but the owner.
//
// vsce rewrites the README's relative images to `<repo>/raw/HEAD/<path>` and
// its relative links to `<repo>/blob/HEAD/<path>`; those rewritten URLs are
// what is checked. Needs network; deliberately not part of `npm test`.
const fs = require('fs');
const path = require('path');

const ABSOLUTE_URL = /https?:\/\/[^\s)<>\]"'`]+/g;
const MD_LINK = /(!?)\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

function repoBase(pkg) {
  const url = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url ?? '';
  return url.replace(/^git\+/, '').replace(/\.git$/, '').replace(/\/$/, '');
}

function isIgnored(url) {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(url);
}

function collectUrls(readme, pkg) {
  const base = repoBase(pkg);
  const urls = new Set();
  for (const u of [base, pkg.bugs?.url ?? pkg.bugs, pkg.homepage]) {
    if (typeof u === 'string' && u) urls.add(u);
  }
  for (const m of readme.matchAll(ABSOLUTE_URL)) {
    const url = m[0].replace(/[.,;:!?]+$/, '');
    if (!isIgnored(url)) urls.add(url);
  }
  for (const m of readme.matchAll(MD_LINK)) {
    const [, bang, target] = m;
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) continue; // absolute, command:, mailto:, anchors
    const rel = target.replace(/^\.\//, '').replace(/#.*$/, '');
    if (rel) urls.add(`${base}/${bang ? 'raw' : 'blob'}/HEAD/${rel}`);
  }
  return [...urls];
}

async function findBrokenUrls(urls, fetchStatus) {
  const results = await Promise.all(urls.map(async (url) => {
    try {
      const status = await fetchStatus(url);
      return status === 200 ? undefined : { url, status };
    } catch (err) {
      return { url, status: err instanceof Error ? err.message : String(err) };
    }
  }));
  return results.filter(Boolean);
}

// Anonymous GET (no credentials), following redirects.
async function fetchStatus(url) {
  const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'ds-ide-link-check' } });
  await res.body?.cancel();
  return res.status;
}

module.exports = { collectUrls, findBrokenUrls };

if (require.main === module) {
  const root = path.join(__dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const urls = collectUrls(readme, pkg);
  console.log(`Checking ${urls.length} URLs anonymously…`);
  findBrokenUrls(urls, fetchStatus).then((broken) => {
    if (broken.length > 0) {
      console.error('error: these URLs do not answer 200:');
      for (const b of broken) console.error(`  ${b.status}  ${b.url}`);
      process.exit(1);
    }
    console.log('All URLs answer 200.');
  });
}
