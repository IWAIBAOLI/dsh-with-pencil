#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const tag = process.env.npm_config_tag || 'latest'

if (!pkg.version.includes('-')) {
  console.error(`Refusing to publish ${pkg.version}: the first public release must remain a prerelease.`)
  process.exit(1)
}
if (tag !== 'beta') {
  console.error(`Refusing to publish ${pkg.version} with dist-tag ${tag}. Use: npm publish --tag beta`)
  process.exit(1)
}

console.log(`Publish guard passed: ${pkg.name}@${pkg.version} -> ${tag}`)
