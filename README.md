# Rumo da Equipe de Dados

Painel da equipe: objetivos, tarefas, carga de cada pessoa, evolução e catálogo de acessos.
Roda no Cloudflare Pages e guarda tudo em um único arquivo JSON no R2.

```
public/index.html        o painel
functions/api/data.js    API que lê e grava o JSON e valida o login
data/rumo.inicial.json   conteúdo inicial com a equipe (fora do Git; só neste computador)
tests/                   testes da validação de login
```

## Como os dados funcionam

- O arquivo fica no bucket `rumo-dados`, com o nome `rumo.json`.
- Cada gravação troca o arquivo inteiro. Se duas pessoas salvarem ao mesmo tempo, a API detecta e o painel reaplica a alteração sobre a versão mais nova.
- O painel busca alterações de outras pessoas a cada 30 segundos.
- Antes da primeira gravação de cada dia (UTC), a versão anterior é copiada para `backups/rumo-AAAA-MM-DD.json`. Essas cópias não são apagadas sozinhas.
- O botão **Baixar JSON** no topo do painel baixa o arquivo atual.

**Não guarde senhas, tokens ou chaves neste arquivo.** Todos com acesso ao painel conseguem ler o conteúdo.

## Rodar no computador

```
npm install
npm run dev
```

Abra http://localhost:8788. Os dados ficam só na pasta `.wrangler`. O arquivo `.dev.vars` dispensa o login apenas em localhost.

Testes: `npm test`

## Publicar na Cloudflare

1. Entre na conta:
   ```
   npx wrangler login
   ```
2. Crie o bucket e carregue os dados iniciais:
   ```
   npx wrangler r2 bucket create rumo-dados
   npm run seed
   ```
   O R2 precisa estar ativado na conta. A Cloudflare pode pedir um cartão, mesmo dentro da faixa gratuita.
3. Publique o site:
   ```
   npm run deploy
   ```
   Na primeira vez, o Wrangler cria o projeto `rumo-dados` e mostra o endereço `*.pages.dev`.
4. Configure o login em **Zero Trust > Access > Applications > Add an application > Self-hosted**:
   - Cubra o endereço do painel, incluindo `rumo-dados.pages.dev` e `*.rumo-dados.pages.dev`.
   - Crie uma política **Allow** com os e-mails da equipe.
   - Copie o **Application Audience (AUD) Tag** e o domínio da equipe (`<equipe>.cloudflareaccess.com`).
5. Preencha `ACCESS_TEAM_DOMAIN` e `ACCESS_AUD` no `wrangler.toml` e publique de novo com `npm run deploy`.

Até o passo 5, a API responde 503 e nenhum dado é entregue. Os valores do passo 4 não são secretos.
