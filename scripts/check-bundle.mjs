#!/usr/bin/env node
/**
 * What goes out with the built page.
 *
 * Two questions, both of which are cheap to answer and embarrassing to get wrong. Does the bundle
 * contain anything that looks like a credential -- a key pasted into a file during development and
 * forgotten, a token in a fixture? And did the production build actually get the Content Security
 * Policy, or did a config change quietly drop it?
 *
 * Run after `pnpm build`; wired into CI straight after the build step.
 */

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

const DIST = 'dist'

/** Shapes that are credentials wherever they appear. Deliberately not a generic entropy check. */
const CREDENTIAL_PATTERNS = [
  { name: 'Anthropic key', pattern: /sk-ant-[A-Za-z0-9_-]{16,}/ },
  { name: 'OpenAI key', pattern: /sk-(proj-)?[A-Za-z0-9]{32,}/ },
  { name: 'xAI key', pattern: /xai-[A-Za-z0-9]{32,}/ },
  { name: 'Google key', pattern: /AIza[A-Za-z0-9_-]{30,}/ },
  { name: 'AWS access key', pattern: /AKIA[0-9A-Z]{16}/ },
  { name: 'GitHub token', pattern: /gh[pousr]_[A-Za-z0-9]{30,}/ },
  { name: 'private key block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
]

const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.css', '.html', '.json', '.map', '.txt'])

async function* walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) yield* walk(path)
    else yield path
  }
}

const failures = []
let scanned = 0

for await (const path of walk(DIST)) {
  const extension = path.slice(path.lastIndexOf('.'))
  if (!TEXT_EXTENSIONS.has(extension)) continue
  scanned += 1
  const contents = await readFile(path, 'utf8')
  for (const { name, pattern } of CREDENTIAL_PATTERNS) {
    const match = pattern.exec(contents)
    if (match) failures.push(`${path}: looks like a ${name} (${match[0].slice(0, 12)}…)`)
  }
}

const html = await readFile(join(DIST, 'index.html'), 'utf8')
if (!html.includes('http-equiv="Content-Security-Policy"')) {
  failures.push('dist/index.html: the production build has no Content Security Policy')
}
for (const directive of ["object-src 'none'", "default-src 'self'", "frame-ancestors 'none'"]) {
  if (!html.includes(directive)) {
    failures.push(`dist/index.html: the policy is missing "${directive}"`)
  }
}

if (failures.length > 0) {
  console.error(`Bundle check failed:\n${failures.map((line) => `  - ${line}`).join('\n')}`)
  process.exit(1)
}

console.log(`Bundle check passed: ${String(scanned)} text files scanned, policy present.`)
