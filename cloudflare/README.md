# Plataforma de Prospecção Starlink — Cloudflare Worker + D1

Porta da plataforma Flask (`../app/`) para rodar **na nuvem da Cloudflare**:

- **Cloudflare Workers** (Hono + TypeScript) — a API JSON, portada de `app/server.py`.
- **Cloudflare D1** (SQLite gerenciado) — o banco, migrado de `app/db.py`.
- **Static Assets** — a mesma SPA (`index.html`, `app.js`, `styles.css`) servida pelo Worker.

O front-end é o mesmo da versão local: ele fala com `/api/*`, então o comportamento é idêntico.

---

## Estrutura

```
cloudflare/
  wrangler.jsonc          configuração do Worker (binding D1, assets, account)
  package.json            dependências (hono, xlsx/SheetJS, wrangler)
  tsconfig.json
  migrations/
    0001_init.sql         schema do D1 (empresas, filiais, contatos, territorios, meta)
  seed.sql                dados iniciais (gerado de data/prospeccao.db) — NÃO é migration
  public/                 SPA servida como assets estáticos
    index.html
    static/app.js
    static/styles.css
  src/
    index.ts              app Hono + todas as rotas /api/*
    listas.ts             enums e regras de classificação (porta de listas.py)
    geo.ts                lookups geográficos + centroides (porta de geo.py)
    geo.json              geometria do mapa (empacotada no bundle)
```

---

## Desenvolvimento local

```bash
cd cloudflare
npm install

# cria o banco D1 local e carrega schema + dados
npm run db:migrate:local
npm run db:seed:local

npm run dev        # http://127.0.0.1:8787
```

---

## Deploy (manual)

Pré-requisito: `npx wrangler login` (ou `CLOUDFLARE_API_TOKEN`).

```bash
cd cloudflare
npm run db:migrate:remote   # aplica o schema no D1 da nuvem (idempotente)
npm run db:seed:remote      # (apenas na 1ª vez) carrega os dados iniciais
npm run deploy              # publica o Worker
```

O banco D1 remoto já foi criado (`prospeccao-starlink`,
id `15f81b0c-03fb-4e1d-96a5-2d934ff306d8`) na conta `marketing.bradel@gmail.com`.

---

## Deploy automático (GitHub Actions)

`.github/workflows/deploy.yml` faz deploy a cada push na `main` que toque em `cloudflare/**`.

Configure **1 secret** no repositório (Settings → Secrets and variables → Actions):

- `CLOUDFLARE_API_TOKEN` — um API Token da Cloudflare com permissão
  *Account · Workers Scripts · Edit* e *Account · D1 · Edit*.
  Crie em https://dash.cloudflare.com/profile/api-tokens (modelo "Edit Cloudflare Workers").

O `account_id` já está em `wrangler.jsonc`, não precisa de secret.

---

## 🔒 Autenticação / acesso

A aplicação é protegida por **login (HTTP Basic)** em todas as rotas — API e páginas.
As credenciais ficam em **secrets** do Worker (nunca no código/git):

- `APP_USER` — usuário (padrão `bradel`)
- `APP_PASSWORD` — senha

Definir/trocar a senha:

```bash
cd cloudflare
printf 'NOVA_SENHA' | npx wrangler secret put APP_PASSWORD
printf 'usuario'    | npx wrangler secret put APP_USER   # opcional
```

Para dev local, crie `cloudflare/.dev.vars` (já no .gitignore):

```
APP_USER = "bradel"
APP_PASSWORD = "sua-senha-local"
```

> Produção: **https://prospeccao-starlink.bradel.workers.dev**
> Se mais tarde quiser login por e-mail corporativo (SSO) em vez de senha única,
> dá para trocar por **Cloudflare Access** (Zero Trust) sem mexer no código.
