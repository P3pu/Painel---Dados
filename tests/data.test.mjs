// Testa a gravação do JSON com um bucket R2 de mentira, sem rede.
import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/data.js';

function fakeBucket(initial) {
  const store = new Map();
  let n = 0;
  const put = (k, text) => { const etag = 'e' + ++n; store.set(k, { text, etag }); return { etag, httpEtag: `"${etag}"` }; };
  if (initial) put('rumo.json', JSON.stringify(initial));
  const obj = (o) => o && { etag: o.etag, httpEtag: `"${o.etag}"`, body: o.text, text: async () => o.text };
  return {
    store,
    get: async (k) => obj(store.get(k)),
    head: async (k) => obj(store.get(k)),
    put: async (k, text, opt = {}) => {
      const cur = store.get(k);
      if (opt.onlyIf?.etagMatches && cur?.etag !== opt.onlyIf.etagMatches) return null;
      return put(k, text);
    },
  };
}
const URL_ = 'http://localhost:8787/api/data';
const env = (DATA) => ({ DEV_BYPASS_AUTH: '1', DATA });
const put = (body, etag) => new Request(URL_, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': etag }, body: JSON.stringify(body) });

test('grava a coleção projetos', async () => {
  const DATA = fakeBucket({ pessoas: [], projetos: [] });
  const r = await onRequest({ request: put({ pessoas: [], projetos: [{ id: 'p1', nome: 'X' }] }, '"e1"'), env: env(DATA) });
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(DATA.store.get('rumo.json').text).projetos, [{ id: 'p1', nome: 'X' }]);
});

test('página antiga sem projetos não apaga os projetos guardados', async () => {
  const DATA = fakeBucket({ pessoas: [], tarefas: [], projetos: [{ id: 'p1', nome: 'X' }] });
  const r = await onRequest({ request: put({ pessoas: [{ id: 'a', nome: 'Ana' }], tarefas: [] }, '"e1"'), env: env(DATA) });
  assert.equal(r.status, 200);
  const saved = JSON.parse(DATA.store.get('rumo.json').text);
  assert.deepEqual(saved.projetos, [{ id: 'p1', nome: 'X' }]);
  assert.equal(saved.pessoas.length, 1);
});

test('lista vazia enviada apaga de propósito', async () => {
  const DATA = fakeBucket({ projetos: [{ id: 'p1', nome: 'X' }] });
  await onRequest({ request: put({ projetos: [] }, '"e1"'), env: env(DATA) });
  assert.deepEqual(JSON.parse(DATA.store.get('rumo.json').text).projetos, []);
});

test('versão desatualizada: 412', async () => {
  const DATA = fakeBucket({ projetos: [] });
  const r = await onRequest({ request: put({ projetos: [] }, '"velha"'), env: env(DATA) });
  assert.equal(r.status, 412);
});
