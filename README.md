# IA e Inovações

Painel da equipe: objetivos, tarefas, carga de cada pessoa, projetos com documentação, evolução e catálogo de acessos.
Roda em um Cloudflare Worker com arquivos estáticos e guarda tudo em um único arquivo JSON no R2.

```
src/worker.js            ponto de entrada do Worker: direciona para a API ou para os arquivos de public/
public/index.html        o painel
functions/api/data.js    API que lê e grava o JSON e valida o login
data/rumo.inicial.json   conteúdo inicial com a equipe (fora do Git; só neste computador)
tests/                   testes da validação de login e da gravação do JSON
```

## Aba Projetos

Cada projeto tem fase (ideia, em desenvolvimento, piloto, em produção, pausado ou descontinuado), o que faz, responsável, quem trabalha nele, quem usa, objetivo que apoia, tecnologias, onde roda, repositório, funcionalidades (uma por linha) e documentação.

- A lista mostra os projetos em colunas por fase e uma tabela de quais sistemas da aba Acessos cada projeto usa.
- Cada projeto tem uma página própria em `#projetos/<id>`, com a documentação formatada.
- A documentação aceita `## título`, listas com `-` ou `1.`, `**negrito**`, `` `código` ``, blocos entre ```` ``` ```` e links `https://`. O texto é escapado antes, então HTML digitado aparece como texto.

## Como os dados funcionam

- O arquivo fica no bucket `rumo-dados`, com o nome `rumo.json`.
- Cada gravação troca o arquivo inteiro. Se duas pessoas salvarem ao mesmo tempo, a API detecta e o painel reaplica a alteração sobre a versão mais nova.
- O painel busca alterações de outras pessoas a cada 30 segundos.
- Antes da primeira gravação de cada dia (UTC), a versão anterior é copiada para `backups/rumo-AAAA-MM-DD.json`. Essas cópias não são apagadas sozinhas.
- O JSON tem as listas `pessoas`, `objetivos`, `tarefas`, `semanas`, `acessos` e `projetos`. Se uma gravação chegar sem alguma delas (por exemplo, de uma aba aberta antes de a lista existir), a API mantém a versão guardada em vez de apagar. Para esvaziar uma lista, é preciso enviá-la vazia.
- O botão **Baixar JSON** no topo do painel baixa o arquivo atual.

**Não guarde senhas, tokens ou chaves neste arquivo.** Todos com acesso ao painel conseguem ler o conteúdo.

## Rodar no computador

```
npm install
npm run dev
```

Abra http://localhost:8787. Os dados ficam só na pasta `.wrangler`. O arquivo `.dev.vars` dispensa o login apenas em localhost.

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
   O Wrangler publica o Worker `painel---dados` e mostra o endereço `*.workers.dev`. Com o repositório ligado ao Workers Builds, cada push na `main` também publica.
4. Configure o login em **Zero Trust > Access > Applications > Add an application > Self-hosted**:
   - Cubra o endereço do painel: o `*.workers.dev` mostrado no passo 3 e o domínio próprio, se houver.
   - Crie uma política **Allow** com os e-mails da equipe.
   - Copie o **Application Audience (AUD) Tag** e o domínio da equipe (`<equipe>.cloudflareaccess.com`).
5. Preencha `ACCESS_TEAM_DOMAIN` e `ACCESS_AUD` no `wrangler.toml` e publique de novo com `npm run deploy`.

Até o passo 5, a API responde 503 e nenhum dado é entregue. Os valores do passo 4 não são secretos.
