/** Exercise the shipped module-loader bundle, not Vite's test transform. */
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { createRequire } from 'node:module'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const require = createRequire(import.meta.url)
let loaded
runInNewContext(await readFile('lib/client.js', 'utf8'), {
  document: { createElement: () => ({ textContent: '', remove() {} }), head: { append() {} } },
  window: { __ModuleLoader__: { load: entry => { loaded = entry.factory(specifier => {
    if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return {
      Button: ({ children, variant: _variant, ...props }) => createElement('button', props, children),
      StateDot: () => createElement('span'),
    }
    if (specifier !== 'react' && specifier !== 'react/jsx-runtime') throw new Error('Unexpected browser external: ' + specifier)
    return require(specifier)
  }) } } },
})
let card
let dictionaries
const disposers = []
try {
  loaded.apply({
    effect: callback => { disposers.push(callback()) },
    locale: { register: (_ns, value) => { dictionaries = value; return () => {} } },
    get: () => ({ rpc: { call: async () => ({ ok: true, value: {} }) } }),
    slots: { inject: (_name, callback) => callback(), register: (options, component) => { card = { options, component } } },
  })
  const html = renderToStaticMarkup(createElement(card.component, { ...card.options.inject(), t: key => dictionaries.zh[key] }))
  if (!html.includes('data-codex-login-card') || !html.includes('Codex Bridge')) throw new Error('Browser card did not render')
  console.log(JSON.stringify({ ok: true, shipped_bundle_rendered: true, slot: card.options.name }))
} finally {
  for (const dispose of disposers.reverse()) dispose()
}
