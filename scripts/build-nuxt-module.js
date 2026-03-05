const esbuild = require('esbuild')
const path = require('path')

const rootDir = path.join(__dirname, '..')

esbuild.build({
  entryPoints: [path.join(rootDir, 'src/nuxt-module.ts')],
  bundle: true,
  outfile: path.join(rootDir, 'dist/nuxt-module.js'),
  platform: 'node',
  target: 'node18',
  format: 'esm',
  minify: false,
  sourcemap: true,
  external: [
    '@nuxt/kit',
    'node:child_process',
    'node:path',
    'node:fs',
    'node:url'
  ],
}).then(() => {
  console.log('Nuxt module build completed successfully')
}).catch((err) => {
  console.error('Nuxt module build failed:', err)
  process.exit(1)
})
