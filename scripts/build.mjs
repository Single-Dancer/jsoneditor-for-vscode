import { rm } from 'node:fs/promises'
import * as esbuild from 'esbuild'

const production = process.argv.includes('--production')

await rm('dist', { recursive: true, force: true })

await Promise.all([
  esbuild.build({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    external: ['vscode'],
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    outfile: 'dist/extension.js',
    sourcemap: production ? false : 'inline',
    minify: production,
    logLevel: 'info'
  }),
  esbuild.build({
    entryPoints: ['src/webview/main.ts'],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    outfile: 'dist/webview.js',
    sourcemap: production ? false : 'inline',
    minify: production,
    loader: {
      '.svg': 'file',
      '.woff': 'file',
      '.woff2': 'file',
      '.ttf': 'file'
    },
    logOverride: {
      'invalid-source-mappings': 'silent'
    },
    logLevel: 'info'
  })
])
