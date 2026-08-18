#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const tag = process.env.npm_config_tag || 'latest'

const isPrerelease = pkg.version.includes('-')
const expectedTag = isPrerelease ? 'beta' : 'latest'
if (tag !== expectedTag) {
  console.error(`Refusing to publish ${pkg.version} with dist-tag ${tag}. Use: npm publish --tag ${expectedTag}`)
  process.exit(1)
}

console.log(`Publish guard passed: ${pkg.name}@${pkg.version} -> ${tag}`)
