// Ponto de entrada do Worker: a API em /api/data e o resto vem dos arquivos de public/.
import { onRequest } from '../functions/api/data.js';

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/data') return onRequest({ request, env, waitUntil: (p) => ctx.waitUntil(p) });
    if (pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ erro: 'Não encontrado.' }), { status: 404, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
    }
    return env.ASSETS.fetch(request);
  },
};
