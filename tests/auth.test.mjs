// Testa a validação do token do Cloudflare Access sem depender da rede.
import test from 'node:test';
import assert from 'node:assert/strict';
import { authorize } from '../functions/api/data.js';

const TEAM = 'equipe.cloudflareaccess.com', AUD = 'aud-certo';
const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };
const b64u = (buf) => Buffer.from(buf).toString('base64url');

const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const other = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'k1' };
globalThis.fetch = async () => new Response(JSON.stringify({ keys: [jwk] }));

async function token(claims = {}, { key = pair.privateKey, header = {} } = {}) {
  const h = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1', ...header }));
  const p = b64u(JSON.stringify({ aud: [AUD], iss: `https://${TEAM}`, exp: Date.now() / 1000 + 600, ...claims }));
  const s = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(h + '.' + p));
  return `${h}.${p}.${b64u(s)}`;
}
const req = (t, url = 'https://rumo.exemplo.com/api/data') => new Request(url, t ? { headers: { 'Cf-Access-Jwt-Assertion': t } } : {});
const status = async (r, e = env) => (await authorize(r, e))?.status ?? 'ok';

test('aceita token válido', async () => assert.equal(await status(req(await token())), 'ok'));
test('sem token: 401', async () => assert.equal(await status(req()), 401));
test('sem configuração: 503, mesmo com token', async () => assert.equal(await status(req(await token()), {}), 503));
test('audiência errada: 403', async () => assert.equal(await status(req(await token({ aud: ['outra'] }))), 403));
test('emissor errado: 403', async () => assert.equal(await status(req(await token({ iss: 'https://falso.com' }))), 403));
test('expirado: 403', async () => assert.equal(await status(req(await token({ exp: Date.now() / 1000 - 10 }))), 403));
test('assinado por outra chave: 403', async () => assert.equal(await status(req(await token({}, { key: other.privateKey }))), 403));
test('alg none: 403', async () => {
  const h = b64u(JSON.stringify({ alg: 'none', kid: 'k1' })), p = b64u(JSON.stringify({ aud: [AUD], iss: `https://${TEAM}`, exp: Date.now() / 1000 + 600 }));
  assert.equal(await status(req(`${h}.${p}.x`)), 403);
});
test('conteúdo alterado: 403', async () => {
  const [h, , s] = (await token()).split('.');
  const p = b64u(JSON.stringify({ aud: [AUD], iss: `https://${TEAM}`, exp: Date.now() / 1000 + 99999 }));
  assert.equal(await status(req(`${h}.${p}.${s}`)), 403);
});
test('lixo no token: 403', async () => assert.equal(await status(req('abc')), 403));
test('atalho de desenvolvimento só em localhost', async () => {
  const dev = { DEV_BYPASS_AUTH: '1' };
  assert.equal(await status(req(null, 'http://localhost:8788/api/data'), dev), 'ok');
  assert.equal(await status(req(null, 'https://rumo.exemplo.com/api/data'), dev), 503);
});
