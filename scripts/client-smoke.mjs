/** Exercise the shipped module-loader bundle, not Vite's test transform. */
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { createRequire } from 'node:module'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import assert from 'node:assert/strict'

const require = createRequire(import.meta.url)
const { name: packageName } = JSON.parse(await readFile('package.json', 'utf8'))
let loaded
runInNewContext(await readFile('lib/client.js', 'utf8'), {
  document: { createElement: () => ({ textContent: '', remove() {} }), head: { append() {} } },
  window: { __ModuleLoader__: { load: entry => { assert.equal(entry.id, packageName); loaded = entry.factory(specifier => {
    if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return {
      Button: ({ children, variant: _variant, ...props }) => createElement('button', props, children),
      StateDot: () => createElement('span'),
    }
    if (specifier !== 'react' && specifier !== 'react/jsx-runtime') throw new Error('Unexpected browser external: ' + specifier)
    return require(specifier)
  }) } } },
})
for (const isLoopback of [true, false]) {
  let card
  let section
  let dictionaries
  const disposers = []
  try {
    loaded.apply({
      effect: callback => { disposers.push(callback()) },
      locale: {
        register: (_ns, value) => { dictionaries = value; return () => {} },
        bind: () => key => dictionaries.zh[key],
      },
      get: name => {
        assert.equal(name, 'connection', 'Login must not request host Settings services')
        return { isLoopback, rpc: { call: async () => ({ ok: true, value: {} }) } }
      },
      slots: {
        // The remote Models page may never render or publish its card seat.
        inject: (name, callback) => { if (name === 'settings.section' || isLoopback) callback() },
        register: (options, component) => {
          if (options.name === 'settings.section') section = { options, component }
          else card = { options, component }
          return () => {}
        },
      },
    })
    assert.equal(section.options.id, 'codex-login')
    assert.equal(section.options.label(), 'Codex 登录')
    assert.equal(section.options.inject().remote, !isLoopback)
    const page = renderToStaticMarkup(createElement(section.component, { ...section.options.inject(), t: key => dictionaries.zh[key] }))
    assert.ok(page.includes('data-codex-login-section'))
    assert.ok(page.includes('data-codex-login-card'))
    assert.ok(page.includes('<h2'))
    assert.equal(page.includes(dictionaries.zh.remoteHint), !isLoopback)
    if (isLoopback) {
      assert.equal(card.options.name, 'settings.models.provider-card')
      assert.equal(card.options.key, 'dsh-codex-bridge')
      const html = renderToStaticMarkup(createElement(card.component, { ...card.options.inject(), t: key => dictionaries.zh[key] }))
      assert.ok(!html.includes('<h3'), 'Provider header belongs to the host row')
      assert.ok(html.includes('data-codex-login-card'))
    } else assert.equal(card, undefined)
    console.log(JSON.stringify({ ok: true, shipped_bundle_rendered: true, standalone_login: true, isLoopback }))
  } finally {
    for (const dispose of disposers.reverse()) dispose()
  }
}
