#!/usr/bin/env node
/**
 * Kapyiŋi submission hygiene check. No npm packages needed.
 * Run from the repository root: node test/qa/validate-submission.mjs
 * This is a static preflight, NOT a security audit and NOT a Sandbox integration test.
 */
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative, resolve } from 'node:path';

const root = process.cwd();
let failures = 0;
let warnings = 0;
const out = (kind, msg) => {
  process.stdout.write(`${kind}: ${msg}\n`);
  if (kind === 'FAIL') failures++;
  if (kind === 'WARN') warnings++;
};

const visibleLicense = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'LICENCE.md']
  .some((p) => existsSync(join(root, p)));
if (visibleLicense) out('PASS', 'License file found. Verify GitHub displays it.');
else out('FAIL', 'Missing public open-source license file.');

if (existsSync(join(root, 'README.md'))) out('PASS', 'README.md found.');
else out('FAIL', 'Missing README.md.');

const pkgPath = join(root, 'package.json');
if (existsSync(pkgPath)) {
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    if (pkg.scripts?.test) out('PASS', 'npm test script exists (must still be run).');
    else out('WARN', 'No npm test script declared.');
  } catch (error) {
    out('FAIL', `Cannot parse package.json: ${error.message}`);
  }
} else out('WARN', 'No package.json in current directory. Run this at repo root.');

const gitFiles = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
try {
  const tracked = gitFiles(['ls-files', '-z']).split('\0').filter(Boolean);
  const badEnv = tracked.filter((p) => /(^|\/)\.env($|\.)/.test(p) && !/(^|\/)\.env\.example$/.test(p));
  if (badEnv.length) out('FAIL', `Tracked environment files: ${badEnv.join(', ')}`);
  else out('PASS', 'No unexpected .env files among current tracked files.');

  const contactFiles = tracked.filter((p) => /(^|\/)data\/contacts\.json$/i.test(p));
  if (contactFiles.length) out('WARN', `Tracked contact file(s): ${contactFiles.join(', ')} — ensure dummy data only.`);
  else out('PASS', 'No data/contacts.json in current tracked files.');

  const secretNames = tracked.filter((p) => /(^|\/)(id_rsa|id_ed25519|service-account(?:\.json)?|credentials\.json|secrets\.json|\.npmrc)$/i.test(p));
  if (secretNames.length) out('WARN', `Potential sensitive filenames tracked: ${secretNames.join(', ')}`);
  else out('PASS', 'No known sensitive filenames among current tracked files.');

  // Scans historical filenames only, never prints secret values.
  const ever = gitFiles(['log', '--all', '--name-only', '--format=', '-z']).split('\0').map((x) => x.trim()).filter(Boolean);
  const everEnv = [...new Set(ever.filter((p) => /(^|\/)\.env($|\.)/.test(p) && !/(^|\/)\.env\.example$/.test(p)))];
  if (everEnv.length) out('WARN', `Environment filenames occur in Git history: ${everEnv.join(', ')}. Audit history for leaked values.`);
  else out('PASS', 'No obvious .env filenames seen in repository history.');
} catch (error) {
  out('WARN', `Git scan not available: ${error.message.split('\n')[0]}`);
}

out('WARN', 'Manual check required: public repo About/license badge, hosting URL, passkeys, real PayPal Sandbox, English, YouTube public video.');
process.stdout.write(`\nPreflight complete: ${failures} failure(s), ${warnings} warning(s).\n`);
process.exitCode = failures ? 1 : 0;
