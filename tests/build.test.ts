// The build: the committed app.js is what ts/app.ts compiles to, and the only JavaScript in the
// repository is that compiled output, the generator output cities.js and gate.js, and the vendored
// SunCalc 1.8.0 (suncalc.js), each marked for GitHub's language bar (Marcos, 2026-10-17: no
// hand-written JavaScript). The generator output (cities.js, gate.js and gate.css) is held byte for
// byte: it is written by SunApp's update_cities.py and by build-gates.py at the root of the GitHub
// folder, never edited here. When one of them writes a new version, update its hash below in the
// same commit. suncalc.js is held to SunCalc 1.8.0 byte for byte.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const COMPILED = ['app.js'];
/** The generator output, by sha256, as at f16b7b9 (cities.js is also SunApp's, byte for byte). */
const GENERATED: Record<string, string> = {
  'cities.js': '2f08782c7f41df5eb95c15a4a668a389505bd4bfba059040d048cbc1324afce2',
  'gate.js': '3b484d2ade83fd30f4211caec8a80c379aaab16d58245383e235483a649c3f9c',
  'gate.css': 'dcb9320550e2612145f37436a9048e2c456a37d7fea75abb021bb81ea1db7e9b',
};
const GENERATED_JS = Object.keys(GENERATED).filter((f) => f.endsWith('.js'));
const VENDORED = ['suncalc.js'];
/** SunCalc 1.8.0 exactly as vendored in SunApp and the other Labs repositories (sha256 of suncalc.js). */
const SUNCALC_SHA256 = 'e17fa013a5ab354c22844f3cebecd4a2b866518e5b63d132d537ea6578cb217b';

const sha256 = (file: string): string => createHash('sha256').update(readFileSync(`${root}${file}`)).digest('hex');

test('tools/build-ts.sh --check passes: app.js equals a fresh compile', () => {
  const out = execFileSync(`${root}tools/build-ts.sh`, ['--check'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.match(out, /^build-ts: app\.js matches ts\/app\.ts$/m);
  assert.match(out, /^build-ts: check passed$/m);
});

test('the generator output (cities.js, gate.js, gate.css) is unchanged, byte for byte', () => {
  for (const [f, sha] of Object.entries(GENERATED)) assert.equal(sha256(f), sha, f);
  assert.match(readFileSync(`${root}cities.js`, 'utf8'), /^\/\/ Stormberry Labs shared city catalogue\.\n\/\/ GENERATED FILE, DO NOT EDIT BY HAND\.\n/);
  assert.match(readFileSync(`${root}gate.js`, 'utf8'), /GENERATED FILE\. Do not edit this copy/);
});

test('the vendored SunCalc is 1.8.0, byte for byte', () => {
  assert.equal(sha256('suncalc.js'), SUNCALC_SHA256);
});

test('the only JavaScript is compiled, generated or vendored, each file marked so', (t) => {
  const git = (...args: string[]): string => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  let inGit = false;
  try { inGit = git('rev-parse', '--is-inside-work-tree').trim() === 'true'; } catch { inGit = false; }
  if (!inGit) { t.skip('not a git checkout'); return; }
  const js = git('ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '*.js', '*.mjs', '*.cjs').split('\0').filter(Boolean);
  assert.deepEqual([...new Set(js)].sort(), [...COMPILED, ...GENERATED_JS, ...VENDORED].sort());
  for (const f of [...COMPILED, ...GENERATED_JS]) assert.equal(git('check-attr', 'linguist-generated', '--', f).trim(), `${f}: linguist-generated: true`);
  for (const f of VENDORED) assert.equal(git('check-attr', 'linguist-vendored', '--', f).trim(), `${f}: linguist-vendored: true`);
});
