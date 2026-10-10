/** Compile the browser half using the Host module-loader handoff. */
import { build } from 'esbuild'
import { readFile, writeFile } from 'node:fs/promises'

const { name: packageName } = JSON.parse(await readFile('package.json', 'utf8'))

const result = await build({
  entryPoints: ['src/client/index.ts'], bundle: true, format: 'cjs', platform: 'browser', target: 'es2024',
  outfile: 'lib/client.js', write: false, minify: true, jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'],
  define: { 'process.env.NODE_ENV': '"production"' },
})
const javascript = result.outputFiles.find(file => file.path.endsWith('.js'))?.text
const css = result.outputFiles.find(file => file.path.endsWith('.css'))?.text
if (!javascript || !css) throw new Error('Missing browser bundle or card stylesheet')
await writeFile('lib/client.js', `window.__ModuleLoader__.load({id:${JSON.stringify(packageName)},factory:(require)=>{var module={exports:{}};var exports=module.exports;const __CODEX_STYLE__=${JSON.stringify(css)};\n${javascript}\nreturn module.exports;}});\n`)
