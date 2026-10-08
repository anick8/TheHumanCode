import test from 'node:test'
import assert from 'node:assert/strict'
import { wheelPalette, toneIndex, contrast } from './wheelPalette.js'
import { COLOR_PRESETS } from './theme.js'

test('every tone ink reads at 4.5:1 on its fill, for default and every preset', () => {
  for (const theme of [null, ...COLOR_PRESETS]) {
    for (const { fill, ink } of wheelPalette(theme).tones) {
      assert.ok(contrast(fill, ink) >= 4.5, `${fill} vs ${ink}`)
    }
  }
})

test('tones are distinct from each other', () => {
  for (const theme of [null, ...COLOR_PRESETS]) {
    const fills = wheelPalette(theme).tones.map((t) => t.fill)
    assert.equal(new Set(fills).size, fills.length)
  }
})

test('neighbouring wedges never share a tone, including across the wrap', () => {
  for (let n = 2; n <= 50; n++) {
    for (let i = 0; i < n; i++) {
      const a = toneIndex(i, n)
      const b = toneIndex((i + 1) % n, n)
      assert.notEqual(a, b, `n=${n} i=${i}`)
    }
  }
})
