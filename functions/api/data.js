// API do painel: lê e grava um único arquivo JSON no R2.
// GET  /api/data             devolve o JSON (com ETag)
// GET  /api/data?download=1  baixa o JSON como arquivo
// PUT  /api/data             substitui o JSON (exige If-Match ou If-None-Match: *)

const KEY = 'rumo.json';
const COLS = ['pessoas', 'objetivos', 'tarefas', 'semanas', 'acessos', 'projetos'];
const MAX_BYTES = 5 * 1024 * 1024;

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
  });

const unquote = (etag) => String(etag || '').replace(/^W\//, '').replace(/"/g, '');

/* ---------- autenticação: valida o token assinado pelo Cloudflare Access ---------- */
const b64urlBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
const b64urlJson = (s) => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));

let certCache = { team: '', keys: [], at: 0 };
async function accessKeys(team, force) {
  if (!force && certCache.team === team && Date.now() - certCache.at < 3600e3) return certCache.keys;
  const r = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!r.ok) throw new Error('certs ' + r.status);
  const { keys } = await r.json();
  certCache = { team, keys, at: Date.now() };
  return keys;
}

export async function authorize(request, env) {
  const host = new URL(request.url).hostname;
  // O atalho de desenvolvimento só vale em localhost: uma variável esquecida não abre a produção.
  if (env.DEV_BYPASS_AUTH === '1' && (host === 'localhost' || host === '127.0.0.1')) return null;

  const team = String(env.ACCESS_TEAM_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const aud = String(env.ACCESS_AUD || '');
  if (!team || !aud) return json({ erro: 'Cloudflare Access não configurado. Defina ACCESS_TEAM_DOMAIN e ACCESS_AUD.' }, 503);

  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return json({ erro: 'Login necessário.' }, 401);
  const denied = json({ erro: 'Token inválido.' }, 403);

  try {
    const [h, p, s] = token.split('.');
    if (!h || !p || !s) return denied;
    const header = b64urlJson(h), claims = b64urlJson(p);
    if (header.alg !== 'RS256') return denied;

    let keys = await accessKeys(team, false);
    let jwk = keys.find((k) => k.kid === header.kid);
    if (!jwk) { keys = await accessKeys(team, true); jwk = keys.find((k) => k.kid === header.kid); }
    if (!jwk) return denied;

    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(s), new TextEncoder().encode(h + '.' + p));
    if (!ok) return denied;

    const now = Date.now() / 1000;
    const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!auds.includes(aud) || claims.iss !== `https://${team}` || !(claims.exp > now) || (claims.nbf && claims.nbf > now + 60)) return denied;
    return null;
  } catch (e) {
    return denied;
  }
}

/* ---------- validação ---------- */
function clean(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const out = {};
  for (const c of COLS) {
    // Coleção ausente fica de fora: a gravação mantém a versão guardada (páginas antigas não conhecem coleções novas).
    if (body[c] === undefined) continue;
    const L = body[c];
    if (!Array.isArray(L)) return null;
    if (L.some((d) => !d || typeof d !== 'object' || typeof d.id !== 'string' || !d.id)) return null;
    out[c] = L;
  }
  return out;
}

/* ---------- rotas ---------- */
async function handleGet(request, env) {
  const url = new URL(request.url);
  const obj = await env.DATA.get(KEY);
  if (!obj) return json(Object.fromEntries(COLS.map((c) => [c, []])));
  if (url.searchParams.has('download')) {
    return new Response(obj.body, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="rumo-dados-${new Date().toISOString().slice(0, 10)}.json"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }
  if (unquote(request.headers.get('If-None-Match')) === obj.etag) return new Response(null, { status: 304, headers: { ETag: obj.httpEtag, 'Cache-Control': 'no-store' } });
  return new Response(obj.body, {
    headers: { 'Content-Type': 'application/json; charset=utf-8', ETag: obj.httpEtag, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

async function handlePut(request, env) {
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return json({ erro: 'Origem não permitida.' }, 403);
  if (!(request.headers.get('Content-Type') || '').includes('application/json')) return json({ erro: 'Envie application/json.' }, 415);

  const ifMatch = request.headers.get('If-Match');
  const ifNone = request.headers.get('If-None-Match');
  if (!ifMatch && ifNone !== '*') return json({ erro: 'Envie If-Match com a versão lida.' }, 428);

  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BYTES) return json({ erro: 'Arquivo acima de 5 MB.' }, 413);
  let parsed;
  try { parsed = JSON.parse(text); } catch (e) { return json({ erro: 'JSON inválido.' }, 400); }
  const data = clean(parsed);
  if (!data) return json({ erro: 'Formato inesperado.' }, 422);

  // Guarda uma cópia por dia do arquivo anterior, já que cada gravação troca o arquivo inteiro.
  const current = await env.DATA.get(KEY);
  let stored = {};
  if (current) {
    if (ifMatch && unquote(ifMatch) !== current.etag) return json({ erro: 'O arquivo mudou. Recarregue.' }, 412);
    const currentText = await current.text();
    try { stored = JSON.parse(currentText) || {}; } catch (e) { stored = {}; }
    const backupKey = `backups/rumo-${new Date().toISOString().slice(0, 10)}.json`;
    if (!(await env.DATA.head(backupKey))) await env.DATA.put(backupKey, currentText);
  } else if (ifMatch) {
    return json({ erro: 'O arquivo mudou. Recarregue.' }, 412);
  }
  for (const c of COLS) if (!(c in data)) data[c] = Array.isArray(stored[c]) ? stored[c] : [];

  const onlyIf = ifMatch ? { etagMatches: unquote(ifMatch) } : { etagDoesNotMatch: '*' };
  const saved = await env.DATA.put(KEY, JSON.stringify(data, null, 2), { onlyIf, httpMetadata: { contentType: 'application/json' } });
  if (!saved) return json({ erro: 'O arquivo mudou. Recarregue.' }, 412);
  return json({ ok: true }, 200, { ETag: saved.httpEtag });
}

export async function onRequest({ request, env }) {
  const denied = await authorize(request, env);
  if (denied) return denied;
  if (!env.DATA) return json({ erro: 'Bucket R2 não ligado ao projeto (binding DATA).' }, 500);
  if (request.method === 'GET') return handleGet(request, env);
  if (request.method === 'PUT') return handlePut(request, env);
  return json({ erro: 'Método não permitido.' }, 405, { Allow: 'GET, PUT' });
}
