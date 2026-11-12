// Plataforma de Prospeccao Starlink (Bradel) — Cloudflare Worker + D1.
// Porta a API Flask de app/server.py para Hono. Serve a SPA (public/) via assets
// e expoe a API JSON: CRUD de empresas/filiais/contatos, mapa, dashboard,
// filtros, pesquisa e import/export Excel.
import { Hono } from "hono";
import * as XLSX from "xlsx";
import * as geo from "./geo";
import * as L from "./listas";

interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_USER?: string;   // usuario do login (padrao "bradel")
  APP_PASSWORD?: string; // senha — definida como secret (wrangler secret put APP_PASSWORD)
  PLACES_API_KEY?: string; // chave do Google Places API (wrangler secret put PLACES_API_KEY)
  SERPER_API_KEY?: string;  // chave do Serper.dev (wrangler secret put SERPER_API_KEY) — tem precedencia
}

// Colunas da empresa (ordem = modelo), portado de db.EMPRESA_CAMPOS.
const EMPRESA_CAMPOS = [
  "codigo", "razao_social", "nome_fantasia", "cnpj", "inscricao_estadual",
  "telefone_comercial", "whatsapp", "email_comercial", "site_instagram",
  "endereco", "cep", "cidade", "uf", "microrregiao", "latitude", "longitude",
  "resp_nome", "resp_cargo", "resp_telefone", "resp_whatsapp", "resp_email",
  "segmento", "produtos", "trabalha_telecom", "ja_starlink", "exp_antenas",
  "equipe_tecnica", "loja_fisica", "qtd_filiais", "capacidade_vendas_mes",
  "interesse_parceiro", "origem_contato",
  "canal", "responsavel", "prioridade", "status", "status_vivensis", "etapa",
  "motivo_perda", "observacoes",
  "data_lead", "data_primeiro_contato", "data_apresentacao", "data_interesse",
  "data_cadastro", "data_inicio_cred", "data_cred", "data_primeira_venda",
  "data_ultima_venda", "data_ultimo_contato", "proxima_acao", "proxima_acao_data",
  "ativacoes_mes", "ativacoes_acum",
];

const CAMPOS_TEXTO = new Set([
  "codigo", "razao_social", "nome_fantasia", "cnpj", "inscricao_estadual",
  "telefone_comercial", "whatsapp", "email_comercial", "site_instagram",
  "endereco", "cep", "cidade", "uf", "microrregiao",
  "resp_nome", "resp_cargo", "resp_telefone", "resp_whatsapp", "resp_email",
  "segmento", "produtos", "capacidade_vendas_mes", "interesse_parceiro",
  "origem_contato", "canal", "responsavel", "prioridade", "status",
  "status_vivensis", "motivo_perda", "observacoes",
  "proxima_acao", "proxima_acao_data", "data_ultimo_contato",
]);
const CAMPOS_BOOL = new Set(["trabalha_telecom", "ja_starlink", "exp_antenas", "equipe_tecnica", "loja_fisica"]);
const CAMPOS_INT = new Set(["qtd_filiais", "ativacoes_mes", "ativacoes_acum"]);
const CAMPOS_FLOAT = new Set(["latitude", "longitude"]);

type Row = Record<string, any>;

// --------------------------------------------------------------------------
// Utilitarios
// --------------------------------------------------------------------------
function agora(): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(new Date());
}

function hoje(): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function soDigitos(s: any): string {
  return String(s ?? "").replace(/\D/g, "");
}

function toBoolInt(v: any): number {
  if (typeof v === "boolean") return v ? 1 : 0;
  if ([1, "1", "sim", "Sim", "SIM", "true", "True", true].includes(v)) return 1;
  return 0;
}

function toInt(v: any, def = 0): number {
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

function toFloat(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function limpar(v: any): any {
  return typeof v === "string" ? v.trim() : v;
}

// --------------------------------------------------------------------------
// Montagem/normalizacao de empresa a partir do payload
// --------------------------------------------------------------------------
function montarEmpresa(data: Row, novo = true): Row {
  const e: Row = {};
  for (const k of CAMPOS_TEXTO) if (k in data) e[k] = limpar(data[k]) || "";
  for (const k of CAMPOS_BOOL) if (k in data) e[k] = toBoolInt(data[k]);
  for (const k of CAMPOS_INT) if (k in data) e[k] = toInt(data[k]);
  for (const k of CAMPOS_FLOAT) if (k in data) e[k] = toFloat(data[k]);

  // Microrregiao automatica a partir do municipio + UF
  const muni = e.cidade ?? data.cidade;
  let uf = String(e.uf ?? data.uf ?? "").toUpperCase();
  if (uf) e.uf = uf;
  if (!e.microrregiao && muni) {
    const mr = geo.microrregiaoDe(muni, uf || null);
    if (mr) {
      e.microrregiao = mr;
      if (!uf) {
        const v = geo.lookupMunicipio(muni);
        if (v) e.uf = v.uf;
      }
    }
  }

  if ("cnpj" in e) e.cnpj_norm = soDigitos(e.cnpj);

  if (novo) {
    if (!e.status) e.status = "Prospectado";
    if (!e.canal) e.canal = "Telecom";
    if (!e.status_vivensis) e.status_vivensis = "Sem credenciamento";
    e.criado_em = agora();
    if (!e.data_lead) e.data_lead = hoje();
  }
  e.atualizado_em = agora();
  return e;
}

async function empresaDupCnpj(db: D1Database, cnpjNorm: string, excluirId?: number): Promise<number | null> {
  if (!cnpjNorm) return null;
  let row: Row | null;
  if (excluirId) {
    row = await db.prepare("SELECT id FROM empresas WHERE cnpj_norm=? AND id<>?").bind(cnpjNorm, excluirId).first();
  } else {
    row = await db.prepare("SELECT id FROM empresas WHERE cnpj_norm=?").bind(cnpjNorm).first();
  }
  return row ? (row.id as number) : null;
}

async function proximoCodigo(db: D1Database): Promise<string> {
  const row = await db
    .prepare("SELECT codigo FROM empresas WHERE codigo LIKE 'REV-%' ORDER BY id DESC LIMIT 1")
    .first<Row>();
  let n = 0;
  if (row && row.codigo) {
    const m = String(row.codigo).match(/(\d+)/);
    if (m) n = parseInt(m[1], 10);
  }
  return `REV-${String(n + 1).padStart(3, "0")}`;
}

async function inserirEmpresa(db: D1Database, e: Row): Promise<number> {
  const cols = [
    ...EMPRESA_CAMPOS.filter((c) => c in e),
    ...["cnpj_norm", "criado_em", "atualizado_em"].filter((c) => c in e),
  ];
  const placeholders = cols.map(() => "?").join(",");
  const sql = `INSERT INTO empresas (${cols.join(",")}) VALUES (${placeholders})`;
  const vals = cols.map((c) => (e[c] === undefined ? null : e[c]));
  const res = await db.prepare(sql).bind(...vals).run();
  return res.meta.last_row_id as number;
}

async function atualizarEmpresa(db: D1Database, eid: number, e: Row): Promise<void> {
  const cols = Object.keys(e).filter((c) => c !== "id");
  const sets = cols.map((c) => `${c}=?`).join(",");
  const vals = cols.map((c) => (e[c] === undefined ? null : e[c]));
  await db.prepare(`UPDATE empresas SET ${sets} WHERE id=?`).bind(...vals, eid).run();
}

function empresaDict(row: Row | null): Row | null {
  if (!row) return null;
  const cor = L.corDoStatus(row.status);
  return { ...row, cor, cor_hex: L.COR_HEX[cor] ?? L.COR_HEX.cinza };
}

// --------------------------------------------------------------------------
// Filtros de listagem
// --------------------------------------------------------------------------
function construirWhere(q: Record<string, string | undefined>): { clause: string; params: any[] } {
  const where: string[] = [];
  const params: any[] = [];
  const uf = limpar(q.uf);
  if (uf) { where.push("uf=?"); params.push(uf.toUpperCase()); }
  const mr = limpar(q.microrregiao);
  if (mr) { where.push("microrregiao=?"); params.push(mr); }
  const muni = limpar(q.municipio);
  if (muni) { where.push("cidade=?"); params.push(muni); }
  const seg = limpar(q.segmento);
  if (seg) { where.push("segmento=?"); params.push(seg); }
  const status = limpar(q.status);
  if (status) { where.push("status=?"); params.push(status); }
  const canal = limpar(q.canal);
  if (canal) { where.push("canal=?"); params.push(canal); }
  const resp = limpar(q.responsavel);
  if (resp) { where.push("responsavel=?"); params.push(resp); }
  const prio = limpar(q.prioridade);
  if (prio) { where.push("prioridade=?"); params.push(prio); }
  if (["1", "true", "sim"].includes(q.credenciado ?? "")) where.push("status='Credenciado'");
  if (["1", "true", "sim"].includes(q.potencial ?? ""))
    where.push("status IN ('Prospectado','Primeiro contato realizado','Em negociação','Interessado')");
  if (["1", "true", "sim"].includes(q.telecom ?? "")) where.push("(trabalha_telecom=1 OR ja_starlink=1)");
  const busca = limpar(q.q);
  if (busca) {
    const like = `%${busca}%`;
    where.push(
      "(razao_social LIKE ? OR nome_fantasia LIKE ? OR cnpj LIKE ? OR resp_nome LIKE ? OR codigo LIKE ? OR cidade LIKE ?)"
    );
    params.push(like, like, like, like, like, like);
  }
  const clause = where.length ? " WHERE " + where.join(" AND ") : "";
  return { clause, params };
}

// --------------------------------------------------------------------------
// App Hono — somente /api/* (assets servem a SPA)
// --------------------------------------------------------------------------
// --------------------------------------------------------------------------
// Autenticacao: tela de login propria (cookie de sessao assinado) + Basic p/ API
// --------------------------------------------------------------------------
const COOKIE = "psl_auth";
const te = new TextEncoder();

function creds(env: Env) {
  return { user: env.APP_USER || "bradel", pass: env.APP_PASSWORD || "" };
}

async function tokenFor(env: Env): Promise<string> {
  const { user, pass } = creds(env);
  const key = await crypto.subtle.importKey(
    "raw", te.encode(pass), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, te.encode("psl-auth-v1|" + user));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function getCookie(c: any, name: string): string | null {
  const raw = c.req.header("Cookie") || "";
  for (const part of raw.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1);
  }
  return null;
}

function checkBasic(c: any): boolean {
  const h = c.req.header("Authorization") || "";
  if (!h.startsWith("Basic ")) return false;
  let dec = "";
  try { dec = atob(h.slice(6)); } catch { return false; }
  const i = dec.indexOf(":");
  if (i < 0) return false;
  const { user, pass } = creds(c.env);
  return !!pass && dec.slice(0, i) === user && dec.slice(i + 1) === pass;
}

function loginPage(erro = "", user = "bradel"): string {
  const msg = erro ? `<div class="err">${erro}</div>` : "";
  return `<!doctype html><html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Entrar · Prospecção Starlink</title>
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  background:radial-gradient(1200px 800px at 70% -10%,#17324f 0%,#0c1420 55%,#080d16 100%);color:#e8eef6}
.card{width:min(92vw,360px);background:#111b28;border:1px solid #223247;border-radius:16px;padding:28px 26px 26px;
  box-shadow:0 20px 60px rgba(0,0,0,.45)}
.logo{width:46px;height:46px;border-radius:12px;display:grid;place-items:center;font-weight:800;font-size:22px;color:#fff;
  background:linear-gradient(135deg,#2f6fd0,#1b3f7a);margin-bottom:14px}
h1{font-size:19px;margin:0 0 2px}
.sub{margin:0 0 18px;color:#90a2b8;font-size:13px}
label{display:block;font-size:12px;color:#aebccd;margin:14px 0 6px}
input{width:100%;height:42px;padding:0 12px;border-radius:10px;border:1px solid #2b3d54;background:#0c1521;color:#eaf1f9;font-size:15px}
input:focus{outline:none;border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,.25)}
.pw{position:relative}
.pw input{padding-right:44px}
.eye{position:absolute;right:6px;top:5px;height:32px;width:34px;border:0;background:transparent;cursor:pointer;color:#8ea2b8;
  display:grid;place-items:center;border-radius:8px}
.eye:hover{color:#dce7f2;background:#1a2636}
.btn{margin-top:20px;width:100%;height:44px;border:0;border-radius:10px;cursor:pointer;font-size:15px;font-weight:600;color:#fff;
  background:linear-gradient(135deg,#2f6fd0,#2358a8)}
.btn:hover{filter:brightness(1.07)}
.err{background:#3a1720;border:1px solid #7f2d3b;color:#ffb3bf;padding:9px 11px;border-radius:9px;font-size:13px;margin-bottom:4px}
</style></head><body>
<form class="card" method="post" action="/login" autocomplete="on">
  <div class="logo">B</div>
  <h1>Prospecção Starlink</h1>
  <p class="sub">Bradel · acesso restrito</p>
  ${msg}
  <label for="u">Usuário</label>
  <input id="u" name="user" value="${user}" autocomplete="username" autocapitalize="none" spellcheck="false">
  <label for="pw">Senha</label>
  <div class="pw">
    <input id="pw" name="pass" type="password" autocomplete="current-password" required>
    <button type="button" class="eye" id="eye" aria-label="Mostrar senha" aria-pressed="false" onclick="tg()">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>
    </button>
  </div>
  <button class="btn" type="submit">Entrar</button>
</form>
<script>
function tg(){
  var i=document.getElementById('pw'),b=document.getElementById('eye');
  var show=i.type==='password';
  i.type=show?'text':'password';
  b.setAttribute('aria-pressed',show?'true':'false');
  b.setAttribute('aria-label',show?'Ocultar senha':'Mostrar senha');
  b.innerHTML=show
   ?'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20C5 20 1 12 1 12a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M1 1l22 22"/><path d="M9.5 9.5a3 3 0 0 0 4.24 4.24"/></svg>'
   :'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';
}
</script>
</body></html>`;
}

const app = new Hono<{ Bindings: Env }>();

// Middleware de login: tela propria + cookie assinado; API tambem aceita Basic.
app.use("*", async (c, next) => {
  const env = c.env;
  if (!env.APP_PASSWORD) return c.text("Login não configurado (defina o secret APP_PASSWORD).", 503);
  const path = new URL(c.req.url).pathname;

  if (path === "/login") {
    if (c.req.method === "POST") {
      const body = await c.req.parseBody();
      const u = String(body.user ?? "").trim();
      const p = String(body.pass ?? "");
      const { user, pass } = creds(env);
      if (u === user && p === pass) {
        c.header("Set-Cookie",
          `${COOKIE}=${await tokenFor(env)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`);
        return c.redirect("/", 302);
      }
      return c.html(loginPage("Usuário ou senha incorretos.", u || "bradel"), 401);
    }
    return c.html(loginPage());
  }
  if (path === "/logout") {
    c.header("Set-Cookie", `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
    return c.redirect("/login", 302);
  }

  const cookie = getCookie(c, COOKIE);
  const ok = (cookie !== null && cookie === (await tokenFor(env))) || checkBasic(c);
  if (ok) return next();
  if (path.startsWith("/api/")) return c.json({ erro: "Não autenticado." }, 401);
  return c.redirect("/login", 302);
});

async function jsonBody(c: any): Promise<Row> {
  try {
    return (await c.req.json()) ?? {};
  } catch {
    return {};
  }
}

// ---- bootstrap / geo ----
app.get("/api/bootstrap", (c) => {
  const nomes: Record<string, string> = {};
  for (const uf of L.UFS) {
    const est = geo.estado(uf);
    nomes[uf] = est ? est.nome : uf;
  }
  return c.json({
    ufs: L.UFS,
    uf_nomes: nomes,
    status: L.STATUS,
    status_vivensis: L.STATUS_VIVENSIS,
    canais: L.CANAIS,
    responsaveis: L.RESPONSAVEIS,
    origens: L.ORIGENS,
    motivos_perda: L.MOTIVOS_PERDA,
    tipos_contato: L.TIPOS_CONTATO,
    segmentos: L.SEGMENTOS,
    prioridades: L.PRIORIDADES,
    interesse: L.INTERESSE,
    status_cor: L.STATUS_COR,
    cor_hex: L.COR_HEX,
    cor_label: L.COR_LABEL,
    map: { dims: geo.overviewDims(), regions: geo.overviewRegions() },
  });
});

app.get("/api/geo/:uf", (c) => {
  const est = geo.estado(c.req.param("uf"));
  if (!est) return c.notFound();
  return c.json({
    uf: est.uf, nome: est.nome, w: est.w, h: est.h,
    municipios: est.municipios.map((m) => ({ n: m.n, rg: m.rg ?? "", d: m.d })),
    regioes: (est.regioes ?? []).map((r) => ({ n: r.n, d: r.d, lx: r.lx, ly: r.ly })),
  });
});

app.get("/api/municipios", (c) => c.json(geo.listaMunicipios(limpar(c.req.query("uf")))));
app.get("/api/microrregioes", (c) => c.json(geo.listaMicrorregioes(limpar(c.req.query("uf")))));

// ---- empresas ----
app.get("/api/empresas", async (c) => {
  const { clause, params } = construirWhere(c.req.query());
  const { results } = await c.env.DB
    .prepare(`SELECT * FROM empresas${clause} ORDER BY razao_social COLLATE NOCASE`)
    .bind(...params)
    .all<Row>();
  return c.json((results ?? []).map(empresaDict));
});

app.get("/api/empresas/:eid{[0-9]+}", async (c) => {
  const eid = Number(c.req.param("eid"));
  const row = await c.env.DB.prepare("SELECT * FROM empresas WHERE id=?").bind(eid).first<Row>();
  if (!row) return c.notFound();
  const e = empresaDict(row)!;
  const filiais = await c.env.DB.prepare("SELECT * FROM filiais WHERE empresa_id=? ORDER BY id").bind(eid).all<Row>();
  const contatos = await c.env.DB
    .prepare("SELECT * FROM contatos WHERE empresa_id=? ORDER BY data DESC, id DESC").bind(eid).all<Row>();
  e.filiais = filiais.results ?? [];
  e.contatos = contatos.results ?? [];
  return c.json(e);
});

app.post("/api/empresas", async (c) => {
  const data = await jsonBody(c);
  if (!limpar(data.razao_social) && !limpar(data.nome_fantasia)) {
    return c.json({ erro: "Informe ao menos a razão social ou o nome fantasia." }, 400);
  }
  const e = montarEmpresa(data, true);
  const dup = await empresaDupCnpj(c.env.DB, e.cnpj_norm);
  if (dup) return c.json({ erro: "Já existe uma empresa com este CNPJ.", id: dup }, 409);
  if (!e.codigo) e.codigo = await proximoCodigo(c.env.DB);
  const eid = await inserirEmpresa(c.env.DB, e);
  return c.json({ id: eid }, 201);
});

app.put("/api/empresas/:eid{[0-9]+}", async (c) => {
  const eid = Number(c.req.param("eid"));
  const exists = await c.env.DB.prepare("SELECT 1 FROM empresas WHERE id=?").bind(eid).first();
  if (!exists) return c.notFound();
  const data = await jsonBody(c);
  const e = montarEmpresa(data, false);
  const dup = await empresaDupCnpj(c.env.DB, e.cnpj_norm, eid);
  if (dup) return c.json({ erro: "Outra empresa já usa este CNPJ.", id: dup }, 409);
  await atualizarEmpresa(c.env.DB, eid, e);
  return c.json({ id: eid });
});

app.delete("/api/empresas/:eid{[0-9]+}", async (c) => {
  const eid = Number(c.req.param("eid"));
  await c.env.DB.prepare("DELETE FROM empresas WHERE id=?").bind(eid).run();
  return c.json({ ok: true });
});

app.patch("/api/empresas/:eid{[0-9]+}/status", async (c) => {
  const eid = Number(c.req.param("eid"));
  const data = await jsonBody(c);
  const novo = limpar(data.status);
  if (!L.STATUS.includes(novo)) return c.json({ erro: "Status inválido." }, 400);
  if ("motivo_perda" in data) {
    await c.env.DB
      .prepare("UPDATE empresas SET status=?, atualizado_em=?, motivo_perda=? WHERE id=?")
      .bind(novo, agora(), limpar(data.motivo_perda), eid).run();
  } else {
    await c.env.DB
      .prepare("UPDATE empresas SET status=?, atualizado_em=? WHERE id=?")
      .bind(novo, agora(), eid).run();
  }
  return c.json({ id: eid, status: novo, cor: L.corDoStatus(novo) });
});

// ---- contatos ----
app.post("/api/empresas/:eid{[0-9]+}/contatos", async (c) => {
  const eid = Number(c.req.param("eid"));
  const data = await jsonBody(c);
  const dataContato = limpar(data.data) || hoje();
  await c.env.DB
    .prepare(
      "INSERT INTO contatos (empresa_id,data,tipo,responsavel,resumo,proxima_acao,proxima_acao_data,criado_em) VALUES (?,?,?,?,?,?,?,?)"
    )
    .bind(eid, dataContato, limpar(data.tipo) ?? null, limpar(data.responsavel) ?? null,
      limpar(data.resumo) ?? null, limpar(data.proxima_acao) ?? null,
      limpar(data.proxima_acao_data) ?? null, agora()).run();
  await c.env.DB
    .prepare("UPDATE empresas SET data_ultimo_contato=?, proxima_acao=?, proxima_acao_data=?, atualizado_em=? WHERE id=?")
    .bind(dataContato, limpar(data.proxima_acao) ?? null, limpar(data.proxima_acao_data) ?? null, agora(), eid).run();
  return c.json({ ok: true }, 201);
});

app.delete("/api/contatos/:cid{[0-9]+}", async (c) => {
  await c.env.DB.prepare("DELETE FROM contatos WHERE id=?").bind(Number(c.req.param("cid"))).run();
  return c.json({ ok: true });
});

// ---- filiais ----
app.post("/api/empresas/:eid{[0-9]+}/filiais", async (c) => {
  const eid = Number(c.req.param("eid"));
  const data = await jsonBody(c);
  await c.env.DB
    .prepare("INSERT INTO filiais (empresa_id,nome,cnpj,endereco,cidade,uf,telefone,obs) VALUES (?,?,?,?,?,?,?,?)")
    .bind(eid, limpar(data.nome) ?? null, limpar(data.cnpj) ?? null, limpar(data.endereco) ?? null,
      limpar(data.cidade) ?? null, (limpar(data.uf) || "").toUpperCase(),
      limpar(data.telefone) ?? null, limpar(data.obs) ?? null).run();
  await c.env.DB
    .prepare("UPDATE empresas SET qtd_filiais=(SELECT COUNT(*) FROM filiais WHERE empresa_id=?) WHERE id=?")
    .bind(eid, eid).run();
  return c.json({ ok: true }, 201);
});

app.delete("/api/filiais/:fid{[0-9]+}", async (c) => {
  const fid = Number(c.req.param("fid"));
  const row = await c.env.DB.prepare("SELECT empresa_id FROM filiais WHERE id=?").bind(fid).first<Row>();
  await c.env.DB.prepare("DELETE FROM filiais WHERE id=?").bind(fid).run();
  if (row) {
    await c.env.DB
      .prepare("UPDATE empresas SET qtd_filiais=(SELECT COUNT(*) FROM filiais WHERE empresa_id=?) WHERE id=?")
      .bind(row.empresa_id, row.empresa_id).run();
  }
  return c.json({ ok: true });
});

// ---- mapa ----
const GOLDEN = 2.399963229728653;
function jitter(k: number): [number, number] {
  if (k === 0) return [0, 0];
  const r = 7.0 * Math.sqrt(k);
  const a = k * GOLDEN;
  return [r * Math.cos(a), r * Math.sin(a)];
}

app.get("/api/mapa", async (c) => {
  const { clause, params } = construirWhere(c.req.query());
  const { results } = await c.env.DB
    .prepare(`SELECT id,razao_social,nome_fantasia,cidade,uf,microrregiao,status FROM empresas${clause}`)
    .bind(...params).all<Row>();
  const regioes: Record<string, any> = {};
  const marcadores: any[] = [];
  const grupo = new Map<string, number>();
  for (const r of results ?? []) {
    const uf = (r.uf || "").toUpperCase();
    const mr = r.microrregiao || "";
    const status = r.status || "";
    const cor = L.corDoStatus(status);
    const chave = `${uf}|${mr}`;
    let agg = regioes[chave];
    if (!agg) {
      agg = { uf, microrregiao: mr, count: 0, credenciados: 0, por_cor: {} };
      regioes[chave] = agg;
    }
    agg.count += 1;
    if (status === "Credenciado") agg.credenciados += 1;
    agg.por_cor[cor] = (agg.por_cor[cor] ?? 0) + 1;
    const cent = geo.centroideRegiao(uf, mr);
    if (cent) {
      const gk = `${uf}|${mr}`;
      const k = grupo.get(gk) ?? 0;
      grupo.set(gk, k + 1);
      const [dx, dy] = jitter(k);
      marcadores.push({
        id: r.id,
        nome: r.nome_fantasia || r.razao_social,
        uf, microrregiao: mr, municipio: r.cidade,
        status, cor, hex: L.COR_HEX[cor] ?? L.COR_HEX.cinza,
        x: Math.round((cent.cx + dx) * 10) / 10, y: Math.round((cent.cy + dy) * 10) / 10,
      });
    }
  }
  const maxc = Object.values(regioes).reduce((m: number, a: any) => Math.max(m, a.count), 0);
  return c.json({ regioes, marcadores, max: maxc });
});

// ---- dashboard ----
app.get("/api/dashboard", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM empresas").all<Row>();
  const rows = results ?? [];
  const total = rows.length;
  const porStatus: Record<string, number> = {};
  for (const s of L.STATUS) porStatus[s] = 0;
  const porUf: Record<string, number> = {};
  for (const u of L.UFS) porUf[u] = 0;
  const porSegmento: Record<string, number> = {};
  const municipios = new Set<string>();
  const microrregioes = new Set<string>();
  let credenciados = 0, emNegociacao = 0, aguardando = 0, potenciais = 0, perdidos = 0;
  for (const r of rows) {
    const st = r.status || "";
    porStatus[st] = (porStatus[st] ?? 0) + 1;
    const uf = (r.uf || "").toUpperCase();
    if (uf) porUf[uf] = (porUf[uf] ?? 0) + 1;
    const seg = r.segmento || "—";
    porSegmento[seg] = (porSegmento[seg] ?? 0) + 1;
    if (r.cidade) municipios.add(`${uf}|${String(r.cidade).trim().toLowerCase()}`);
    if (r.microrregiao) microrregioes.add(`${uf}|${r.microrregiao}`);
    const cor = L.corDoStatus(st);
    if (st === "Credenciado") credenciados += 1;
    else if (cor === "amarelo") emNegociacao += 1;
    else if (cor === "laranja") aguardando += 1;
    else if (cor === "azul") potenciais += 1;
    else if (cor === "vermelho") perdidos += 1;
  }
  const taxa = total ? Math.round((1000.0 * credenciados) / total) / 10 : 0.0;
  const porSegmentoOrd = Object.fromEntries(Object.entries(porSegmento).sort((a, b) => b[1] - a[1]));
  return c.json({
    total, potenciais, credenciados, em_negociacao: emNegociacao, aguardando, perdidos,
    municipios: municipios.size, microrregioes: microrregioes.size,
    taxa_conversao: taxa, por_status: porStatus, por_uf: porUf, por_segmento: porSegmentoOrd,
  });
});

// --------------------------------------------------------------------------
// Prospeccao Starlink — busca na web (Google Places) + salvar na base
// --------------------------------------------------------------------------
// Grandes redes e distribuidoras generalistas a excluir dos resultados.
// Comparacao por "contem" sobre o nome normalizado (sem acento/minusculo).
// Editavel: adicione aqui novas redes que nao devem aparecer na prospeccao.
const REDES_BLOQUEADAS = [
  "fujioka", "gazin", "havan", "magazine luiza", "magazineluiza", "magalu",
  "casas bahia", "casa bahia", "ponto frio", "pontofrio", "americanas",
  "fast shop", "fastshop", "lojas cem", "ricardo eletro",
  "mercado livre", "amazon", "shopee", "aliexpress",
  // Grandes redes/distribuidoras generalistas. Nomes especificos para nao
  // excluir lojas locais por engano. Adicione novas redes conforme necessario.
];

function nomeBloqueado(nome: string): boolean {
  const n = L.norm(nome);
  if (!n) return false;
  return REDES_BLOQUEADAS.some((rede) => n.includes(rede));
}

// Indice da base atual para deduplicacao (telefone normalizado e nome+cidade).
// A base e pequena; dedup em memoria evita normalizar telefone em SQL.
interface BaseIndex {
  porTel: Map<string, number>;
  porNome: Map<string, number>;
}

async function baseIndex(db: D1Database): Promise<BaseIndex> {
  const { results } = await db
    .prepare("SELECT id, nome_fantasia, razao_social, cidade, telefone_comercial, whatsapp FROM empresas")
    .all<Row>();
  const porTel = new Map<string, number>();
  const porNome = new Map<string, number>();
  for (const r of results ?? []) {
    for (const t of [r.telefone_comercial, r.whatsapp]) {
      const d = soDigitos(t);
      if (d.length >= 8) porTel.set(d, r.id as number);
    }
    const nm = L.norm(String(r.nome_fantasia || r.razao_social || ""));
    const cid = L.norm(String(r.cidade || ""));
    if (nm) porNome.set(`${nm}|${cid}`, r.id as number);
  }
  return { porTel, porNome };
}

function achaDup(idx: BaseIndex, nome: string, cidade: string, telefone: string): number | null {
  const d = soDigitos(telefone);
  if (d.length >= 8 && idx.porTel.has(d)) return idx.porTel.get(d)!;
  const k = `${L.norm(nome)}|${L.norm(cidade)}`;
  if (L.norm(nome) && idx.porNome.has(k)) return idx.porNome.get(k)!;
  return null;
}

// Extrai cidade e UF dos address_components do Places (padrao BR).
function extrairLocal(place: any): { cidade: string; uf: string } {
  let cidade = "";
  let uf = "";
  for (const comp of place.addressComponents ?? []) {
    const tipos: string[] = comp.types ?? [];
    if (tipos.includes("administrative_area_level_1")) uf = (comp.shortText || "").toUpperCase();
    if (tipos.includes("locality") && !cidade) cidade = comp.longText || "";
    if (tipos.includes("administrative_area_level_2") && !cidade) cidade = comp.longText || "";
  }
  return { cidade, uf };
}

// Telefone celular BR (11 digitos com 9 apos o DDD) tambem vira WhatsApp.
function ehCelular(telefone: string): boolean {
  const d = soDigitos(telefone).replace(/^55/, "");
  return d.length === 11 && d[2] === "9";
}

// Chamada ao Google Places (Text Search, New). Retorna os places crus ou lanca erro.
async function placesBuscar(key: string, textQuery: string): Promise<any[]> {
  const resp = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": [
        "places.id", "places.displayName", "places.formattedAddress",
        "places.nationalPhoneNumber", "places.internationalPhoneNumber",
        "places.websiteUri", "places.googleMapsUri", "places.location",
        "places.addressComponents", "places.primaryTypeDisplayName", "places.businessStatus",
      ].join(","),
    },
    body: JSON.stringify({ textQuery, languageCode: "pt-BR", regionCode: "BR", maxResultCount: 20 }),
  });
  const data: any = await resp.json();
  if (!resp.ok) throw new Error(data?.error?.message || `Erro ${resp.status} na API do Google Places.`);
  return data.places ?? [];
}

// Monta o texto de busca estilo "comprar Starlink em Rio Verde GO".
function montarTextQuery(termo: string, cidade: string, mr: string, uf: string): string {
  const ufNome = uf ? (geo.estado(uf)?.nome ?? uf) : "";
  const local = cidade || mr || ufNome;
  const t = termo || "Starlink internet via satélite revenda";
  return [t, local, uf].filter(Boolean).join(" ").trim();
}

// Normaliza um place do Google no formato de candidato da prospeccao.
function normalizaPlace(p: any): Row {
  const nome = p.displayName?.text || "";
  const { cidade, uf } = extrairLocal(p);
  const telefone = p.nationalPhoneNumber || p.internationalPhoneNumber || "";
  return {
    place_id: p.id || "",
    nome,
    tipo: p.primaryTypeDisplayName?.text || "",
    endereco: p.formattedAddress || "",
    cidade,
    uf,
    telefone,
    whatsapp: ehCelular(telefone) ? telefone : "",
    cnpj: "",
    site: p.websiteUri || "",
    fonte: p.googleMapsUri || "",
    lat: p.location?.latitude ?? null,
    lng: p.location?.longitude ?? null,
  };
}

// Extrai cidade e UF do endereco textual do Serper (padrao BR: "..., Cidade - UF, CEP, Brazil").
function extrairLocalSerper(address: string): { cidade: string; uf: string } {
  let cidade = "", uf = "";
  const re = /(?:^|,)\s*([^,]+?)\s*-\s*([A-Z]{2})\b/g;
  let m: RegExpExecArray | null, last: RegExpExecArray | null = null;
  while ((m = re.exec(address || "")) !== null) last = m;
  if (last) { cidade = last[1].trim(); uf = last[2].toUpperCase(); }
  return { cidade, uf };
}

// Chamada ao Serper.dev (endpoint /places = resultados do Google Maps). Normaliza no formato comum.
async function serperBuscar(key: string, textQuery: string): Promise<Row[]> {
  const resp = await fetch("https://google.serper.dev/places", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-KEY": key },
    body: JSON.stringify({ q: textQuery, gl: "br", hl: "pt-br" }),
  });
  const data: any = await resp.json();
  if (!resp.ok) throw new Error(data?.message || `Erro ${resp.status} na API do Serper.`);
  return (data.places ?? []).map((p: any): Row => {
    const { cidade, uf } = extrairLocalSerper(p.address || "");
    const telefone = p.phoneNumber || "";
    return {
      place_id: p.cid ? String(p.cid) : "",
      nome: p.title || "",
      tipo: p.category || p.type || "",
      endereco: p.address || "",
      cidade,
      uf,
      telefone,
      whatsapp: ehCelular(telefone) ? telefone : "",
      cnpj: "",
      site: p.website || "",
      fonte: p.cid ? `https://www.google.com/maps?cid=${p.cid}` : (p.website || ""),
      lat: p.latitude ?? null,
      lng: p.longitude ?? null,
    };
  });
}

// Despacha para a fonte configurada: Serper tem precedencia; senao Google Places.
// Retorna candidatos ja normalizados no formato comum. Lanca se nenhuma chave existir.
async function buscarFonte(env: Env, textQuery: string): Promise<{ provider: string; candidatos: Row[] }> {
  if (env.SERPER_API_KEY) {
    return { provider: "serper", candidatos: await serperBuscar(env.SERPER_API_KEY, textQuery) };
  }
  if (env.PLACES_API_KEY) {
    const places = await placesBuscar(env.PLACES_API_KEY, textQuery);
    return { provider: "places", candidatos: places.map(normalizaPlace) };
  }
  throw new Error("Nenhuma chave de busca configurada (defina SERPER_API_KEY ou PLACES_API_KEY).");
}

function fonteConfigurada(env: Env): boolean {
  return !!(env.SERPER_API_KEY || env.PLACES_API_KEY);
}

// Insere um candidato na base evitando duplicidade (telefone OU nome+cidade).
// Atualiza o indice em memoria para o proximo candidato do mesmo lote. Sem CNPJ.
async function salvarCandidato(db: D1Database, idx: BaseIndex, cand: Row): Promise<"criado" | "dup"> {
  const nome = limpar(cand.nome) || "";
  if (!nome) return "dup";
  const cidade = limpar(cand.cidade) || "";
  const telefone = limpar(cand.telefone) || "";
  if (achaDup(idx, nome, cidade, telefone) !== null) return "dup";
  const obs: string[] = [];
  if (cand.fonte) obs.push(`Fonte: ${cand.fonte}`);
  if (cand.tipo) obs.push(`Tipo (Google): ${cand.tipo}`);
  if (cand.auto) obs.push(`Encontrado pela varredura automática em ${hoje()}`);
  const e = montarEmpresa({
    razao_social: nome,
    nome_fantasia: nome,
    telefone_comercial: telefone,
    whatsapp: limpar(cand.whatsapp) || "",
    site_instagram: limpar(cand.site) || "",
    endereco: limpar(cand.endereco) || "",
    cidade,
    uf: (limpar(cand.uf) || "").toUpperCase(),
    latitude: cand.lat,
    longitude: cand.lng,
    origem_contato: "Prospecção ativa",
    observacoes: obs.join("\n"),
  }, true);
  e.codigo = await proximoCodigo(db);
  const id = await inserirEmpresa(db, e);
  const d = soDigitos(telefone);
  if (d.length >= 8) idx.porTel.set(d, id);
  idx.porNome.set(`${L.norm(nome)}|${L.norm(cidade)}`, id);
  return "criado";
}

// GET /api/busca-places?termo=&uf=&cidade=&microrregiao=
// Busca manual: consulta a fonte (Serper ou Places), exclui grandes redes e marca o que ja esta na base.
app.get("/api/busca-places", async (c) => {
  if (!fonteConfigurada(c.env)) {
    return c.json({ erro: "Busca indisponível: defina a chave de busca (SERPER_API_KEY ou PLACES_API_KEY)." }, 503);
  }
  const uf = (limpar(c.req.query("uf")) || "").toString().toUpperCase();
  const cidade = (limpar(c.req.query("cidade")) || "").toString();
  const mr = (limpar(c.req.query("microrregiao")) || "").toString();
  const termo = (limpar(c.req.query("termo")) || "").toString();
  const textQuery = montarTextQuery(termo, cidade, mr, uf);

  let candidatos: Row[];
  try {
    ({ candidatos } = await buscarFonte(c.env, textQuery));
  } catch (ex: any) {
    return c.json({ erro: ex?.message || "Falha ao consultar a fonte de busca." }, 502);
  }

  const idx = await baseIndex(c.env.DB);
  const resultados: any[] = [];
  let excluidos = 0;
  for (const cand of candidatos) {
    if (!cand.nome) continue;
    if (nomeBloqueado(cand.nome)) { excluidos += 1; continue; }
    // Se o usuario filtrou por UF, mantem apenas resultados daquela UF (quando identificavel).
    if (uf && cand.uf && cand.uf !== uf) continue;
    const dup = achaDup(idx, cand.nome, cand.cidade, cand.telefone);
    resultados.push({ ...cand, ja_salvo: dup !== null, empresa_id: dup });
  }
  return c.json({ textQuery, total: resultados.length, excluidos, resultados });
});

// POST /api/prospeccao/salvar  { candidatos: [ {nome, endereco, cidade, uf, telefone, whatsapp, site, fonte, lat, lng} ] }
// Insere na base evitando duplicidade (por telefone ou nome+cidade). Sem CNPJ.
app.post("/api/prospeccao/salvar", async (c) => {
  const body = await jsonBody(c);
  const candidatos: any[] = Array.isArray(body.candidatos) ? body.candidatos : (body.nome ? [body] : []);
  if (!candidatos.length) return c.json({ erro: "Nenhum candidato enviado." }, 400);

  const idx = await baseIndex(c.env.DB);
  let criados = 0, duplicados = 0;
  for (const cand of candidatos) {
    const r = await salvarCandidato(c.env.DB, idx, cand);
    if (r === "criado") criados += 1; else duplicados += 1;
  }
  return c.json({ criados, duplicados });
});

// --------------------------------------------------------------------------
// Varredura automatica (Cron Trigger diario) — prospeccao rotativa por cidade.
// Rodar todas as cidades todo dia seria caro e bateria nos limites do Worker;
// por isso cada execucao processa um LOTE de cidades e avanca um cursor salvo
// na tabela meta. Em alguns dias cobre toda a regiao e recomeca.
// --------------------------------------------------------------------------
const CRON_BATCH = 25;                                  // cidades por execucao
const CRON_TERMOS = ["Starlink internet via satélite"]; // termos por cidade (1 = mais barato)

async function metaGet(db: D1Database, chave: string): Promise<string | null> {
  const r = await db.prepare("SELECT valor FROM meta WHERE chave=?").bind(chave).first<Row>();
  return r ? String(r.valor) : null;
}

async function metaSet(db: D1Database, chave: string, valor: string): Promise<void> {
  await db
    .prepare("INSERT INTO meta (chave,valor) VALUES (?,?) ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor")
    .bind(chave, valor).run();
}

// Lista ordenada e estavel de cidades-alvo (todas as cidades das UFs de atuacao).
function alvosCron(): { municipio: string; uf: string }[] {
  const out: { municipio: string; uf: string }[] = [];
  for (const uf of L.UFS) {
    for (const m of geo.listaMunicipios(uf)) out.push({ municipio: m.municipio, uf: m.uf });
  }
  return out;
}

// Executa um lote da varredura a partir do cursor. Retorna estatisticas.
async function runCron(env: Env): Promise<Row> {
  const db = env.DB;
  if (!fonteConfigurada(env)) {
    return { ok: false, erro: "Nenhuma chave de busca configurada (SERPER_API_KEY ou PLACES_API_KEY)." };
  }
  const cidades = alvosCron();
  if (!cidades.length) return { ok: false, erro: "Sem cidades-alvo." };

  const cursor = parseInt((await metaGet(db, "cron_cursor")) || "0", 10) || 0;
  const lote: { municipio: string; uf: string }[] = [];
  for (let i = 0; i < CRON_BATCH && i < cidades.length; i++) {
    lote.push(cidades[(cursor + i) % cidades.length]);
  }

  const idx = await baseIndex(db);
  let criados = 0, duplicados = 0, excluidos = 0, buscas = 0, erros = 0;
  for (const alvo of lote) {
    for (const termo of CRON_TERMOS) {
      buscas += 1;
      let candidatos: Row[];
      try {
        ({ candidatos } = await buscarFonte(env, montarTextQuery(termo, alvo.municipio, "", alvo.uf)));
      } catch {
        erros += 1;
        continue;
      }
      for (const cand of candidatos) {
        if (!cand.nome) continue;
        if (nomeBloqueado(cand.nome)) { excluidos += 1; continue; }
        if (alvo.uf && cand.uf && cand.uf !== alvo.uf) continue;
        cand.auto = true;
        const r = await salvarCandidato(db, idx, cand);
        if (r === "criado") criados += 1; else duplicados += 1;
      }
    }
  }

  const novoCursor = (cursor + CRON_BATCH) % cidades.length;
  const stats: Row = {
    ok: true, data: agora(), buscas, criados, duplicados, excluidos, erros,
    cidades: lote.map((a) => `${a.municipio}/${a.uf}`),
    cursor_de: cursor, cursor_ate: novoCursor, total_cidades: cidades.length,
  };
  await metaSet(db, "cron_cursor", String(novoCursor));
  await metaSet(db, "cron_last_run", agora());
  await metaSet(db, "cron_last_stats", JSON.stringify(stats));
  console.log(
    `Cron prospecção: ${buscas} buscas em ${lote.length} cidades · ` +
    `${criados} novos, ${duplicados} duplicados, ${excluidos} excluídos, ${erros} erros · ` +
    `cursor ${cursor}→${novoCursor}/${cidades.length}`
  );
  return stats;
}

// Status da varredura automatica (para exibir na aba Prospeccao).
app.get("/api/prospeccao/cron-status", async (c) => {
  const db = c.env.DB;
  const cursor = parseInt((await metaGet(db, "cron_cursor")) || "0", 10) || 0;
  const total = alvosCron().length;
  const ultima = await metaGet(db, "cron_last_run");
  let stats: any = null;
  try { stats = JSON.parse((await metaGet(db, "cron_last_stats")) || "null"); } catch { stats = null; }
  const provider = c.env.SERPER_API_KEY ? "serper" : (c.env.PLACES_API_KEY ? "places" : null);
  return c.json({
    ativo: fonteConfigurada(c.env), provider, cursor, total, batch: CRON_BATCH, termos: CRON_TERMOS, ultima, stats,
  });
});

// Dispara uma varredura imediata (botao "Rodar agora"). Roda 1 lote sincrono.
app.post("/api/prospeccao/varredura", async (c) => {
  if (!fonteConfigurada(c.env)) {
    return c.json({ erro: "Varredura indisponível: defina SERPER_API_KEY ou PLACES_API_KEY." }, 503);
  }
  const stats = await runCron(c.env);
  return c.json(stats);
});

// --------------------------------------------------------------------------
// Importacao / exportacao Excel
// --------------------------------------------------------------------------
const MODELO_COLS: [string, string][] = [
  ["Razão social", "razao_social"],
  ["Nome fantasia", "nome_fantasia"],
  ["CNPJ", "cnpj"],
  ["Inscrição estadual", "inscricao_estadual"],
  ["Telefone comercial", "telefone_comercial"],
  ["WhatsApp", "whatsapp"],
  ["E-mail comercial", "email_comercial"],
  ["Site / Instagram", "site_instagram"],
  ["Endereço", "endereco"],
  ["CEP", "cep"],
  ["Cidade", "cidade"],
  ["UF", "uf"],
  ["Microrregião", "microrregiao"],
  ["Latitude", "latitude"],
  ["Longitude", "longitude"],
  ["Responsável (nome)", "resp_nome"],
  ["Responsável (cargo)", "resp_cargo"],
  ["Responsável (telefone)", "resp_telefone"],
  ["Responsável (WhatsApp)", "resp_whatsapp"],
  ["Responsável (e-mail)", "resp_email"],
  ["Segmento", "segmento"],
  ["Produtos", "produtos"],
  ["Trabalha com telecom?", "trabalha_telecom"],
  ["Já comercializa Starlink?", "ja_starlink"],
  ["Experiência com antenas?", "exp_antenas"],
  ["Equipe técnica?", "equipe_tecnica"],
  ["Loja física?", "loja_fisica"],
  ["Qtd. filiais", "qtd_filiais"],
  ["Capacidade de vendas/mês", "capacidade_vendas_mes"],
  ["Interesse em ser parceiro", "interesse_parceiro"],
  ["Origem do contato", "origem_contato"],
  ["Canal", "canal"],
  ["Responsável interno", "responsavel"],
  ["Prioridade", "prioridade"],
  ["Status comercial", "status"],
  ["Observações", "observacoes"],
];

function xlsxResponse(c: any, wb: XLSX.WorkBook, filename: string): Response {
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

app.get("/api/modelo.xlsx", (c) => {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([MODELO_COLS.map(([t]) => t)]);
  ws["!cols"] = MODELO_COLS.map(() => ({ wch: 20 }));
  XLSX.utils.book_append_sheet(wb, ws, "Empresas");
  return xlsxResponse(c, wb, "modelo_empresas_starlink.xlsx");
});

app.get("/api/export.xlsx", async (c) => {
  const { clause, params } = construirWhere(c.req.query());
  const { results } = await c.env.DB
    .prepare(`SELECT * FROM empresas${clause} ORDER BY razao_social COLLATE NOCASE`)
    .bind(...params).all<Row>();
  const cabecalhos = ["Código", ...MODELO_COLS.map(([t]) => t)];
  const cols = ["codigo", ...MODELO_COLS.map(([, cc]) => cc)];
  const aoa: any[][] = [cabecalhos];
  for (const row of results ?? []) {
    aoa.push(
      cols.map((col) => {
        let v = col in row ? row[col] : "";
        if (CAMPOS_BOOL.has(col)) v = v ? "Sim" : "Não";
        return v ?? "";
      })
    );
  }
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  XLSX.utils.book_append_sheet(wb, ws, "Empresas");
  return xlsxResponse(c, wb, "empresas_starlink.xlsx");
});

function linhaParaEmpresa(d: Row): Row {
  const tituloParaCol: Record<string, string> = {};
  for (const [t, col] of MODELO_COLS) tituloParaCol[t.trim().toLowerCase()] = col;
  const colsSet = new Set<string>([...MODELO_COLS.map(([, col]) => col), ...CAMPOS_TEXTO]);
  const out: Row = {};
  for (const [k, v] of Object.entries(d)) {
    const key = (k || "").trim().toLowerCase();
    const col = tituloParaCol[key] ?? (colsSet.has(key) ? key : null);
    if (col) out[col] = v;
  }
  return out;
}

app.post("/api/import", async (c) => {
  const form = await c.req.formData();
  const f = form.get("arquivo");
  if (!f || typeof f === "string") {
    return c.json({ erro: "Envie um arquivo .xlsx ou .csv no campo 'arquivo'." }, 400);
  }
  const file = f as File;
  const nome = (file.name || "").toLowerCase();
  const buf = await file.arrayBuffer();
  let registros: Row[] = [];
  if (nome.endsWith(".csv")) {
    const texto = new TextDecoder("utf-8").decode(buf).replace(/^﻿/, "");
    const wb = XLSX.read(texto, { type: "string", raw: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    registros = XLSX.utils.sheet_to_json<Row>(ws, { defval: "" });
  } else {
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    registros = XLSX.utils.sheet_to_json<Row>(ws, { defval: "" });
  }

  let criados = 0, atualizados = 0, ignorados = 0;
  const erros: string[] = [];
  let i = 1;
  for (const bruto of registros) {
    i += 1;
    const data = linhaParaEmpresa(bruto);
    const nomeEmp = limpar(data.razao_social) || limpar(data.nome_fantasia);
    if (!nomeEmp) { ignorados += 1; continue; }
    const e = montarEmpresa(data, true);
    const dup = await empresaDupCnpj(c.env.DB, e.cnpj_norm);
    try {
      if (dup) {
        const e2 = montarEmpresa(data, false);
        await atualizarEmpresa(c.env.DB, dup, e2);
        atualizados += 1;
      } else {
        if (!e.codigo) e.codigo = await proximoCodigo(c.env.DB);
        await inserirEmpresa(c.env.DB, e);
        criados += 1;
      }
    } catch (ex: any) {
      erros.push(`Linha ${i}: ${ex?.message ?? ex}`);
    }
  }
  return c.json({ criados, atualizados, ignorados, erros });
});

// Fallback: tudo que nao e /api/* vai para os assets estaticos (SPA), ja autenticado.
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

// Export com handler HTTP (Hono) + handler agendado (Cron Trigger diario).
export default {
  fetch: app.fetch,
  scheduled: (_controller: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(runCron(env));
  },
};
