import assert from 'node:assert/strict'
import test from 'node:test'

import { tokenizeMarkdownInline, type InlineToken } from './markdown-inline'

const text = (value: string): InlineToken => ({ kind: 'text', text: value })

/** Asserts the whole input survives as one literal token, byte-for-byte. */
function assertLiteral(input: string) {
  assert.deepEqual(tokenizeMarkdownInline(input), [text(input)], `expected literal: ${JSON.stringify(input)}`)
}

test('keeps intraword and standalone dunder identifiers literal', () => {
  assertLiteral('__init__')
  assertLiteral('__name__')
  assertLiteral('__main__')
  assertLiteral('foo__bar__baz')
  assertLiteral('a__b__c')
  assertLiteral('__init__ and __main__')
  assertLiteral('__penting__')
})

test('keeps single-underscore identifiers literal', () => {
  assertLiteral('pesan_kalo_pake_ini')
  assertLiteral('CONTOH_PESAN')
  assertLiteral('_catatan_2')
  assertLiteral('_a_b_')
  assertLiteral('layer_2_cache')
  assertLiteral('2_3')
  assertLiteral('café_nama_lain')
  assertLiteral('cafe\u0301_v2_')
  assertLiteral('nama_ñ')
  assertLiteral('名前_テスト')
  assertLiteral('nama‿bagian_nilai_akhir')
  assertLiteral('_')
  assertLiteral('a_b')
})

test('keeps space-flanked underscores literal', () => {
  assertLiteral('a _ b _ c')
  assertLiteral('snake _ case _ here')
  assertLiteral('_ leading and trailing _')
})

test('does not pair underscores from separate words', () => {
  const input = 'pesan_kalo tanpa format sampai kode CONTOH_PESAN tetap utuh'
  assertLiteral(input)
})

test('does not let emphasis span a newline', () => {
  assertLiteral('_a\nb_')
})

test('recognizes single-underscore emphasis only when delimited', () => {
  assert.deepEqual(tokenizeMarkdownInline('_satu_'), [{ kind: 'em', text: 'satu' }])
  assert.deepEqual(tokenizeMarkdownInline('sebelum _catatan kecil_ sesudah'), [
    text('sebelum '),
    { kind: 'em', text: 'catatan kecil' },
    text(' sesudah')
  ])
  assert.deepEqual(tokenizeMarkdownInline('_catatan kecil_.'), [
    { kind: 'em', text: 'catatan kecil' },
    text('.')
  ])
  assert.deepEqual(tokenizeMarkdownInline('_a_ _b_'), [
    { kind: 'em', text: 'a' },
    text(' '),
    { kind: 'em', text: 'b' }
  ])
})

test('recognizes asterisk emphasis, strong, strike and code', () => {
  assert.deepEqual(tokenizeMarkdownInline('*miring*'), [{ kind: 'em', text: 'miring' }])
  assert.deepEqual(tokenizeMarkdownInline('**tebal**'), [{ kind: 'strong', text: 'tebal' }])
  assert.deepEqual(tokenizeMarkdownInline('~~hapus~~'), [{ kind: 'del', text: 'hapus' }])
  assert.deepEqual(tokenizeMarkdownInline('`a_b_c`'), [{ kind: 'code', text: 'a_b_c' }])
  assert.deepEqual(tokenizeMarkdownInline('sebelum *miring* sesudah'), [
    text('sebelum '),
    { kind: 'em', text: 'miring' },
    text(' sesudah')
  ])
  // Inner Markdown stays raw on the token so the renderer can tokenize again.
  assert.deepEqual(tokenizeMarkdownInline('**tebal _miring_**'), [
    { kind: 'strong', text: 'tebal _miring_' }
  ])
})

test('recognizes links and bare URLs', () => {
  assert.deepEqual(tokenizeMarkdownInline('[dokumen](https://example.com/a_b)'), [
    { kind: 'link', text: 'dokumen', href: 'https://example.com/a_b' }
  ])
  assert.deepEqual(tokenizeMarkdownInline('buka https://example.com/a_b'), [
    text('buka '),
    { kind: 'url', text: 'https://example.com/a_b' }
  ])
  assert.deepEqual(tokenizeMarkdownInline('buka https://example.com/a_b.'), [
    text('buka '),
    { kind: 'url', text: 'https://example.com/a_b' },
    text('.')
  ])
  assert.deepEqual(tokenizeMarkdownInline('baca https://en.wikipedia.org/wiki/Foo_(bar)'), [
    text('baca '),
    { kind: 'url', text: 'https://en.wikipedia.org/wiki/Foo_(bar)' }
  ])
  assert.deepEqual(tokenizeMarkdownInline('(https://example.com/path)'), [
    text('('),
    { kind: 'url', text: 'https://example.com/path' },
    text(')')
  ])
})

test('never emits empty or merged tokens', () => {
  assert.deepEqual(tokenizeMarkdownInline(''), [])
  const tokens = tokenizeMarkdownInline('a **b** c')
  assert.deepEqual(tokens, [text('a '), { kind: 'strong', text: 'b' }, text(' c')])
  assert.ok(tokens.every(token => token.text !== ''))
})

test('mixed sentence from the markdown-identifiers fixture', () => {
  const line = 'Salin pesan_kalo_pake_ini lalu CONTOH_PESAN, __init__ dan _catatan kecil_ tetap.'
  assert.deepEqual(tokenizeMarkdownInline(line), [
    text('Salin pesan_kalo_pake_ini lalu CONTOH_PESAN, __init__ dan '),
    { kind: 'em', text: 'catatan kecil' },
    text(' tetap.')
  ])
})
