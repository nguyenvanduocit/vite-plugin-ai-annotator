const { spawn } = require('child_process')
const path = require('path')

const rootDir = path.join(__dirname, '..')

// Generate TypeScript declarations
async function generateTypes() {
  // Generate main types (excluding vite-plugin)
  await new Promise((resolve, reject) => {
    console.log('Generating main TypeScript declarations...')

    const tsc = spawn('bunx', ['tsc', '--emitDeclarationOnly', '--outDir', 'dist'], {
      cwd: rootDir,
      stdio: 'inherit'
    })

    tsc.on('close', (code) => {
      if (code === 0) {
        console.log('Main TypeScript declarations generated successfully')
        resolve()
      } else {
        reject(new Error(`TypeScript compilation failed with code ${code}`))
      }
    })

    tsc.on('error', (err) => {
      reject(new Error(`Failed to start TypeScript compiler: ${err.message}`))
    })
  })

  // Generate vite-plugin types with ESM-compatible config
  await new Promise((resolve, reject) => {
    console.log('Generating vite-plugin TypeScript declarations...')

    const tsc = spawn('bunx', ['tsc', '-p', 'tsconfig.vite-plugin.json'], {
      cwd: rootDir,
      stdio: 'inherit'
    })

    tsc.on('close', (code) => {
      if (code === 0) {
        console.log('Vite-plugin TypeScript declarations generated successfully')
        resolve()
      } else {
        reject(new Error(`Vite-plugin TypeScript compilation failed with code ${code}`))
      }
    })

    tsc.on('error', (err) => {
      reject(new Error(`Failed to start TypeScript compiler: ${err.message}`))
    })
  })
}

generateTypes().catch((err) => {
  console.error('Type generation failed:', err)
  process.exit(1)
})
