#!/usr/bin/env node
'use strict';
// Fails when README.md or a walkthrough step names a command that is not in
// package.json's contributes.commands (FR-RCH-4) — the README once kept
// telling users to run "Daisy IDE: Open Wiring Editor" long after M21 removed it.
//
// Checked: `Daisy IDE: <title>` mentions and `(command:<id>)` links. Bare
// `ds-ide.<name>` in prose is deliberately ignored: the same prefix names
// settings and workspace-state keys.
const fs = require('fs');
const path = require('path');

function findStaleReferences(docs, commands) {
  const ids = new Set(commands.map((c) => c.command));
  const titles = new Set(commands.map((c) => `${c.category ?? 'Daisy IDE'}: ${c.title}`));
  const stale = [];
  for (const { file, text } of docs) {
    text.split('\n').forEach((lineText, i) => {
      for (const m of lineText.matchAll(/Daisy IDE: [A-Z][A-Za-z0-9 &]*[A-Za-z0-9]/g)) {
        // Longest-prefix match: prose may continue after the title ("... Build for Emulator compiles").
        const words = m[0].split(' ');
        let ok = false;
        for (let n = words.length; n >= 3 && !ok; n--) ok = titles.has(words.slice(0, n).join(' '));
        if (!ok) stale.push({ file, line: i + 1, ref: m[0] });
      }
      for (const m of lineText.matchAll(/\(command:([^)\s?]+)/g)) {
        if (!ids.has(m[1])) stale.push({ file, line: i + 1, ref: `command:${m[1]}` });
      }
    });
  }
  return stale;
}

module.exports = { findStaleReferences };

if (require.main === module) {
  const root = path.join(__dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const walkDir = path.join(root, 'media', 'walkthrough');
  const files = ['README.md', ...(fs.existsSync(walkDir) ? fs.readdirSync(walkDir).map((f) => `media/walkthrough/${f}`) : [])];
  const docs = files.map((file) => ({ file, text: fs.readFileSync(path.join(root, file), 'utf8') }));
  const stale = findStaleReferences(docs, pkg.contributes.commands);
  if (stale.length > 0) {
    console.error('error: docs reference commands that are not in package.json contributes.commands:');
    for (const s of stale) console.error(`  ${s.file}:${s.line}  ${s.ref}`);
    process.exit(1);
  }
}
