#!/usr/bin/env node
/* SPDX-License-Identifier: Apache-2.0 */
/** Structural editing regressions, with no external models or extra dependencies. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const tests = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mirrored = path.join(tests, 'public_html/assets/apps/bimcraft/dev');
const app = fs.existsSync(mirrored) ? mirrored : path.resolve(tests, '../app');
const cases = path.join(tests, 'tools/bimcraft-test/structural');
let passed = 0, failed = 0;
for (const name of fs.readdirSync(cases).filter((file) => file.endsWith('.mjs')).sort()) {
  const result = spawnSync(process.execPath, [path.join(cases, name)], {
    env: { ...process.env, BIMCRAFT_TEST_APP: app }, encoding: 'utf8',
  });
  const ok = result.status === 0;
  console.log(`${ok ? 'pass' : 'FAIL'} ${name}`);
  if (ok) passed++;
  else {
    failed++;
    process.stderr.write(result.stderr || result.error?.message || `Exited ${result.status}\n`);
    if (result.stdout) process.stdout.write(result.stdout);
  }
}
console.log(`${passed} structural editing cases passed; ${failed} failed.`);
process.exitCode = failed ? 1 : 0;
