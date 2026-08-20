#!/usr/bin/env node
'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { pathToFileURL } = require('node:url')

const root = path.resolve(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

function usage() {
  console.log(`Usage: node scripts/dev-install.cjs [options]

Build and install a cache-safe local DSH plugin snapshot.

Options:
  --profile <name>      DSH profile to update (default: web)
  --output-dir <path>   Artifact directory (default: .dev-builds)
  --skip-tests          Skip npm test before packing
  --pack-only           Build the unique tarball without installing it
  --help                Show this help`)
}

function parseArgs(argv) {
  const options = {
    profile: 'web',
    outputDir: path.join(root, '.dev-builds'),
    skipTests: false,
    packOnly: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help') { usage(); process.exit(0) }
    if (arg === '--skip-tests') { options.skipTests = true; continue }
    if (arg === '--pack-only') { options.packOnly = true; continue }
    if (arg === '--profile' || arg === '--output-dir') {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) throw new Error(arg + ' requires a value')
      index += 1
      if (arg === '--profile') options.profile = value
      else options.outputDir = path.resolve(root, value)
      continue
    }
    throw new Error('unknown argument: ' + arg)
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(options.profile)) throw new Error('invalid DSH profile name: ' + options.profile)
  return options
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd || root,
    encoding: options.encoding,
    stdio: options.stdio || 'inherit',
    env: { ...process.env, ...options.env },
  })
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function sameFile(left, right) {
  if (!fs.existsSync(left) || !fs.existsSync(right)) return false
  return fs.readFileSync(left).equals(fs.readFileSync(right))
}

function verifyInstalled(profileDir, packedFiles) {
  const installed = path.join(profileDir, 'node_modules', pkg.name)
  const stat = fs.lstatSync(installed)
  if (stat.isSymbolicLink()) throw new Error('installed plugin is still a symlink; remove the link override and retry')
  const mismatches = packedFiles
    .map((item) => item.path)
    .filter((relative) => !sameFile(path.join(root, relative), path.join(installed, relative)))
  if (mismatches.length) throw new Error('installed snapshot differs from the packed source: ' + mismatches.slice(0, 8).join(', '))
  console.log('Verified installed snapshot: ' + installed)
}

function removeLinkOverride(profileDir) {
  const manifestPath = path.join(profileDir, 'package.json')
  if (!fs.existsSync(manifestPath)) return
  const manifest = readJson(manifestPath)
  const override = manifest.pnpm && manifest.pnpm.overrides && manifest.pnpm.overrides[pkg.name]
  const installed = path.join(profileDir, 'node_modules', pkg.name)
  const linked = fs.existsSync(installed) && fs.lstatSync(installed).isSymbolicLink()
  if (!linked && !(typeof override === 'string' && override.startsWith('link:'))) return
  console.log('Removing previous development link before snapshot install...')
  run('pnpm', ['unlink', pkg.name], { cwd: profileDir })
  const after = readJson(manifestPath)
  if (after.pnpm && after.pnpm.overrides && after.pnpm.overrides[pkg.name]) {
    throw new Error('pnpm unlink left a ' + pkg.name + ' override in ' + manifestPath)
  }
}

function buildSnapshot(outputDir) {
  fs.mkdirSync(outputDir, { recursive: true })
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-with-pencil-pack-'))
  try {
    const json = run('npm', ['pack', '--json', '--pack-destination', staging], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
      env: { npm_config_cache: path.join(os.tmpdir(), 'dsh-with-pencil-npm-pack-cache') },
    })
    const metadata = JSON.parse(json)[0]
    if (!metadata || !metadata.filename || !Array.isArray(metadata.files)) throw new Error('npm pack returned incomplete metadata')
    const source = path.join(staging, metadata.filename)
    const bytes = fs.readFileSync(source)
    const digest = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 12)
    const baseName = pkg.name.replace(/^@/, '').replace(/\//g, '-')
    const artifact = path.join(outputDir, baseName + '-' + pkg.version + '-' + digest + '.tgz')
    if (!fs.existsSync(artifact)) {
      const temporary = artifact + '.tmp-' + process.pid
      fs.writeFileSync(temporary, bytes, { flag: 'wx' })
      fs.renameSync(temporary, artifact)
    }
    return { artifact, metadata }
  } finally {
    fs.rmSync(staging, { recursive: true, force: true })
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (!options.skipTests) run('npm', ['test'])
  const snapshot = buildSnapshot(options.outputDir)
  console.log('Built cache-safe snapshot: ' + snapshot.artifact)
  if (options.packOnly) return

  const dshHome = path.resolve(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'))
  const profileDir = path.join(dshHome, 'profiles', options.profile)
  removeLinkOverride(profileDir)
  run('npx', [
    '--yes', '@deepseek-ai/dsh', 'plugin', '--profile', options.profile,
    'add', pathToFileURL(snapshot.artifact).href,
  ])
  verifyInstalled(profileDir, snapshot.metadata.files)
  console.log('Restart required: stop the current DSH process, then run `npx @deepseek-ai/dsh web`.')
}

try {
  main()
} catch (error) {
  console.error('dev install failed: ' + (error && error.message ? error.message : String(error)))
  process.exit(1)
}
