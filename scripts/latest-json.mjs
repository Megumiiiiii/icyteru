#!/usr/bin/env node
/**
 * Build the Tauri updater manifest from downloaded release assets.
 *
 *   node scripts/latest-json.mjs <version> <assetsDir> <repo> <outFile>
 *
 * Each platform entry needs the asset URL and the signature Tauri wrote next to
 * it (`<asset>.sig`). Anything without a signature is skipped, so a half-signed
 * release cannot advertise an unverified download.
 */
import fs from 'node:fs'
import path from 'node:path'

const [version, dir, repo, outFile = 'latest.json'] = process.argv.slice(2)
if (!version || !dir || !repo) {
  console.error('usage: latest-json.mjs <version> <assetsDir> <owner/repo> [outFile]')
  process.exit(2)
}

const files = fs.readdirSync(dir)
const signatureFor = name => {
  const candidate = path.join(dir, `${name}.sig`)
  return fs.existsSync(candidate) ? fs.readFileSync(candidate, 'utf8').trim() : ''
}

const pick = matcher => files.find(name => matcher.test(name) && !name.endsWith('.sig'))

const platforms = {}
const add = (key, matcher) => {
  const name = pick(matcher)
  if (!name) return
  const signature = signatureFor(name)
  if (!signature) {
    console.warn(`skip ${key}: ${name} has no .sig`)
    return
  }
  platforms[key] = {
    signature,
    url: `https://github.com/${repo}/releases/download/v${version}/${encodeURIComponent(name)}`
  }
}

add('windows-x86_64', /_x64-setup\.exe$/i)
add('darwin-aarch64', /aarch64.*\.app\.tar\.gz$|aarch64.*\.tar\.gz$/i)
add('darwin-x86_64', /x64.*\.app\.tar\.gz$|_x64.*\.tar\.gz$/i)
add('linux-x86_64', /amd64\.AppImage$/i)

if (!Object.keys(platforms).length) {
  console.error('No signed assets found; refusing to write an empty manifest.')
  process.exit(1)
}

const manifest = {
  version,
  pub_date: new Date().toISOString(),
  notes: `Icyteru ${version}`,
  platforms
}
fs.writeFileSync(outFile, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`wrote ${outFile} for ${Object.keys(platforms).join(', ')}`)
