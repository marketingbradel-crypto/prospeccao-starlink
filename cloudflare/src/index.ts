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
  "faixa_potencial", "ja_vendeu",
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
  "segmento", "produtos", "capacidade_vendas_mes", "faixa_potencial", "interesse_parceiro",
  "origem_contato", "canal", "responsavel", "prioridade", "status",
  "status_vivensis", "motivo_perda", "observacoes",
  "proxima_acao", "proxima_acao_data", "data_ultimo_contato",
]);
const CAMPOS_BOOL = new Set(["trabalha_telecom", "ja_starlink", "exp_antenas", "equipe_tecnica", "loja_fisica", "ja_vendeu"]);
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

// Extrai o mes "YYYY-MM" de uma data "YYYY-MM-DD..." (ou null se invalida).
function mesDe(s: any): string | null {
  const m = /^(\d{4})-(\d{2})/.exec(String(s ?? "").trim());
  return m ? `${m[1]}-${m[2]}` : null;
}

// Mes seguinte de um "YYYY-MM" (para preencher a serie mensal sem buracos).
function proxMes(ym: string): string {
  let [y, m] = ym.split("-").map(Number);
  m += 1;
  if (m > 12) { m = 1; y += 1; }
  return `${y}-${String(m).padStart(2, "0")}`;
}

// Dias entre duas datas "YYYY-MM-DD" (b - a). null se alguma for invalida
// ou se a diferenca for negativa (datas fora de ordem / erro de digitacao).
function diasEntre(a: any, b: any): number | null {
  const ra = /^\d{4}-\d{2}-\d{2}/.exec(String(a ?? "").trim());
  const rb = /^\d{4}-\d{2}-\d{2}/.exec(String(b ?? "").trim());
  if (!ra || !rb) return null;
  const ta = Date.parse(ra[0] + "T00:00:00Z");
  const tb = Date.parse(rb[0] + "T00:00:00Z");
  if (isNaN(ta) || isNaN(tb)) return null;
  const d = Math.round((tb - ta) / 86400000);
  return d >= 0 ? d : null;
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

// Proximo numero de codigo REV: MAX(numero)+1. Usa o MAIOR numero existente
// (nao o codigo da ultima linha por id), evitando codigos duplicados.
async function proximoCodigoNum(db: D1Database): Promise<number> {
  const row = await db
    .prepare("SELECT MAX(CAST(substr(codigo,5) AS INTEGER)) AS n FROM empresas WHERE codigo LIKE 'REV-%'")
    .first<Row>();
  const n = row && row.n != null ? Number(row.n) : 0;
  return (Number.isFinite(n) ? n : 0) + 1;
}

async function proximoCodigo(db: D1Database): Promise<string> {
  return `REV-${String(await proximoCodigoNum(db)).padStart(3, "0")}`;
}

// Monta (sem executar) o INSERT de uma empresa — usado solto ou em DB.batch().
function stmtInserirEmpresa(db: D1Database, e: Row): D1PreparedStatement {
  const cols = [
    ...EMPRESA_CAMPOS.filter((c) => c in e),
    ...["cnpj_norm", "criado_em", "atualizado_em"].filter((c) => c in e),
  ];
  const placeholders = cols.map(() => "?").join(",");
  const sql = `INSERT INTO empresas (${cols.join(",")}) VALUES (${placeholders})`;
  const vals = cols.map((c) => (e[c] === undefined ? null : e[c]));
  return db.prepare(sql).bind(...vals);
}

async function inserirEmpresa(db: D1Database, e: Row): Promise<number> {
  const res = await stmtInserirEmpresa(db, e).run();
  return res.meta.last_row_id as number;
}

// Insere muitas empresas em lotes (DB.batch = 1 subrequest por lote), para nao
// estourar o limite de subrequests do Worker em importacoes grandes. Se um lote
// falhar, cai para insercao linha a linha para nao perder o lote inteiro.
async function inserirEmpresasLote(db: D1Database, novos: Row[], erros: string[]): Promise<number> {
  let ok = 0;
  const TAM = 50;
  for (let i = 0; i < novos.length; i += TAM) {
    const lote = novos.slice(i, i + TAM);
    try {
      await db.batch(lote.map((e) => stmtInserirEmpresa(db, e)));
      ok += lote.length;
    } catch {
      for (const e of lote) {
        try { await stmtInserirEmpresa(db, e).run(); ok += 1; }
        catch (ex: any) { erros.push(`${e.codigo || e.razao_social || "linha"}: ${ex?.message ?? ex}`); }
      }
    }
  }
  return ok;
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
  const faixa = limpar(q.faixa);
  if (faixa) { where.push("faixa_potencial=?"); params.push(faixa); }
  const vendeu = String(q.vendeu ?? "").toLowerCase();
  if (["1", "true", "sim"].includes(vendeu)) where.push("ja_vendeu=1");
  else if (["0", "nao", "não", "false"].includes(vendeu)) where.push("(ja_vendeu=0 OR ja_vendeu IS NULL)");
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
    faixas_potencial: L.FAIXAS_POTENCIAL,
    faixa_hex: L.FAIXA_HEX,
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
  e.faixa_sugerida = L.sugerirFaixa(e); // sugestao de potencial (null se sem sinais)
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

// Aplica a faixa de potencial (usado pelo botao "usar sugestao"). "" limpa a faixa.
app.patch("/api/empresas/:eid{[0-9]+}/faixa", async (c) => {
  const eid = Number(c.req.param("eid"));
  const data = await jsonBody(c);
  const faixa = limpar(data.faixa_potencial) || "";
  if (faixa && !L.FAIXAS_POTENCIAL.includes(faixa)) return c.json({ erro: "Faixa inválida." }, 400);
  await c.env.DB.prepare("UPDATE empresas SET faixa_potencial=?, atualizado_em=? WHERE id=?")
    .bind(faixa || null, agora(), eid).run();
  return c.json({ id: eid, faixa_potencial: faixa });
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
  // Classificacao comercial: distribuicao por faixa de potencial e quem ja vendeu.
  const porFaixa: Record<string, number> = {};
  for (const f of L.FAIXAS_POTENCIAL) porFaixa[f] = 0;
  let semFaixa = 0, jaVenderam = 0;
  // Evolucao no tempo: leads e credenciamentos por mes (YYYY-MM).
  const leadsPorMes: Record<string, number> = {};
  const credPorMes: Record<string, number> = {};
  // Tempo medio (dias) em cada etapa do funil — soma e contagem de amostras validas.
  let sLeadContato = 0, nLeadContato = 0;  // lead -> primeiro contato
  let sLeadCred = 0, nLeadCred = 0;        // lead -> credenciamento
  let sCredVenda = 0, nCredVenda = 0;      // credenciamento -> primeira venda
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

    const fx = (r.faixa_potencial || "").trim();
    if (fx && fx in porFaixa) porFaixa[fx] += 1; else semFaixa += 1;
    if (toBoolInt(r.ja_vendeu)) jaVenderam += 1;

    // Serie mensal: usa data_lead (cai para criado_em se ausente).
    const mLead = mesDe(r.data_lead) || mesDe(r.criado_em);
    if (mLead) leadsPorMes[mLead] = (leadsPorMes[mLead] ?? 0) + 1;
    const mCred = mesDe(r.data_cred);
    if (mCred) credPorMes[mCred] = (credPorMes[mCred] ?? 0) + 1;

    // Tempos de funil (ignora datas ausentes/invertidas).
    const d1 = diasEntre(r.data_lead, r.data_primeiro_contato);
    if (d1 != null) { sLeadContato += d1; nLeadContato += 1; }
    const d2 = diasEntre(r.data_lead, r.data_cred);
    if (d2 != null) { sLeadCred += d2; nLeadCred += 1; }
    const d3 = diasEntre(r.data_cred, r.data_primeira_venda);
    if (d3 != null) { sCredVenda += d3; nCredVenda += 1; }
  }
  const taxa = total ? Math.round((1000.0 * credenciados) / total) / 10 : 0.0;
  const porSegmentoOrd = Object.fromEntries(Object.entries(porSegmento).sort((a, b) => b[1] - a[1]));

  // Monta a serie mensal contigua (sem buracos) e mantem so os ultimos 12 meses.
  const mesesSet = new Set<string>([...Object.keys(leadsPorMes), ...Object.keys(credPorMes)]);
  let serieMensal: { mes: string; leads: number; creds: number }[] = [];
  if (mesesSet.size) {
    const ordenados = [...mesesSet].sort();
    const mesAtual = mesDe(hoje())!;
    const ultimo = ordenados[ordenados.length - 1];
    const limite = ultimo > mesAtual ? ultimo : mesAtual;
    let cur = ordenados[0];
    while (cur <= limite && serieMensal.length < 240) {
      serieMensal.push({ mes: cur, leads: leadsPorMes[cur] ?? 0, creds: credPorMes[cur] ?? 0 });
      cur = proxMes(cur);
    }
    serieMensal = serieMensal.slice(-12);
  }
  const media = (soma: number, n: number) => (n ? Math.round(soma / n) : null);
  const temposFunil = {
    lead_contato: { dias: media(sLeadContato, nLeadContato), n: nLeadContato },
    lead_cred: { dias: media(sLeadCred, nLeadCred), n: nLeadCred },
    cred_venda: { dias: media(sCredVenda, nCredVenda), n: nCredVenda },
  };

  // Cobertura VSM: mapeadas (por_uf) vs universo de revendas no portal Vivensis.
  const coberturaVsm = L.UFS.map((u) => {
    const universo = L.UNIVERSO_VSM[u] ?? 0;
    const mapeadas = porUf[u] ?? 0;
    const pct = universo ? Math.round((1000.0 * mapeadas) / universo) / 10 : 0.0;
    return { uf: u, mapeadas, universo, pct };
  });
  const universoVsmTotal = L.UFS.reduce((s, u) => s + (L.UNIVERSO_VSM[u] ?? 0), 0);

  return c.json({
    total, potenciais, credenciados, em_negociacao: emNegociacao, aguardando, perdidos,
    municipios: municipios.size, microrregioes: microrregioes.size,
    taxa_conversao: taxa, por_status: porStatus, por_uf: porUf, por_segmento: porSegmentoOrd,
    serie_mensal: serieMensal, tempos_funil: temposFunil,
    por_faixa: porFaixa, sem_faixa: semFaixa, ja_venderam: jaVenderam,
    cobertura_vsm: coberturaVsm, universo_vsm_total: universoVsmTotal,
  });
});

// --------------------------------------------------------------------------
// Follow-up / Monitoramento — "o que fazer hoje"
// Agrupa os prospects ATIVOS (nao credenciados nem descartados) em:
//   vencidas  — proxima acao com data no passado
//   hoje      — proxima acao marcada para hoje
//   proximas  — proxima acao nos proximos 7 dias
//   parados   — sem proxima acao marcada e frios (sem contato ha 14+ dias)
// Campos usados ja existem na tabela empresas (proxima_acao, proxima_acao_data,
// data_ultimo_contato). Nada de novo no schema.
// --------------------------------------------------------------------------
const STATUS_FOLLOWUP_FECHADO = new Set(["Credenciado", "Não interessado"]);
const FOLLOWUP_FRIO_DIAS = 14; // sem contato ha N dias (e sem acao marcada) => "parado"

// Diferenca COM SINAL em dias entre duas datas "YYYY-MM-DD" (b - a). NaN se invalida.
// (diasEntre existente zera negativos; aqui precisamos do sinal p/ detectar atraso.)
function diasSinal(aISO: string, bISO: string): number {
  const ra = /^\d{4}-\d{2}-\d{2}/.exec((aISO || "").trim());
  const rb = /^\d{4}-\d{2}-\d{2}/.exec((bISO || "").trim());
  if (!ra || !rb) return NaN;
  const a = Date.parse(ra[0] + "T00:00:00Z");
  const b = Date.parse(rb[0] + "T00:00:00Z");
  if (isNaN(a) || isNaN(b)) return NaN;
  return Math.round((b - a) / 86400000);
}

app.get("/api/follow-up", async (c) => {
  const hojeStr = hoje();
  const { results } = await c.env.DB.prepare(
    `SELECT id, nome_fantasia, razao_social, cidade, uf, status, responsavel, prioridade,
            telefone_comercial, whatsapp, proxima_acao, proxima_acao_data,
            data_ultimo_contato, faixa_potencial
       FROM empresas`
  ).all<Row>();

  const vencidas: Row[] = [], hojeList: Row[] = [], proximas: Row[] = [], parados: Row[] = [];
  for (const r of results ?? []) {
    if (STATUS_FOLLOWUP_FECHADO.has(String(r.status || ""))) continue;
    const nome = r.nome_fantasia || r.razao_social || "(sem nome)";
    const pad = String(r.proxima_acao_data || "").slice(0, 10);
    const base: Row = {
      id: r.id, nome, cidade: r.cidade, uf: r.uf, status: r.status,
      responsavel: r.responsavel, prioridade: r.prioridade,
      telefone: r.telefone_comercial || "", whatsapp: r.whatsapp || "",
      proxima_acao: r.proxima_acao || "", proxima_acao_data: pad,
      data_ultimo_contato: String(r.data_ultimo_contato || "").slice(0, 10),
      faixa_potencial: r.faixa_potencial || "",
    };
    if (pad) {
      const d = diasSinal(hojeStr, pad); // <0 vencida, 0 hoje, >0 futura
      if (isNaN(d)) continue;
      if (d < 0) { base.dias_atraso = -d; vencidas.push(base); }
      else if (d === 0) { hojeList.push(base); }
      else if (d <= 7) { base.dias_para = d; proximas.push(base); }
    } else {
      // Sem acao marcada: entra em "parados" se nunca contatado ou frio (14+ dias sem contato).
      const uc = base.data_ultimo_contato;
      if (!uc) {
        base.dias_sem_contato = null; // nunca contatado
        parados.push(base);
      } else {
        const dsc = diasEntre(uc, hojeStr); // number | null (null = data futura/invalida)
        if (dsc !== null && dsc >= FOLLOWUP_FRIO_DIAS) {
          base.dias_sem_contato = dsc;
          parados.push(base);
        }
      }
    }
  }

  const peso: Record<string, number> = { Alta: 0, "Média": 1, Baixa: 2 };
  vencidas.sort((a, b) => (b.dias_atraso || 0) - (a.dias_atraso || 0));
  proximas.sort((a, b) => (a.dias_para || 0) - (b.dias_para || 0));
  parados.sort((a, b) => (b.dias_sem_contato ?? 9999) - (a.dias_sem_contato ?? 9999));
  hojeList.sort((a, b) => (peso[a.prioridade] ?? 3) - (peso[b.prioridade] ?? 3));

  return c.json({
    hoje: hojeStr,
    total: vencidas.length + hojeList.length + proximas.length + parados.length,
    vencidas, hoje_list: hojeList, proximas, parados,
    contagem: { vencidas: vencidas.length, hoje: hojeList.length, proximas: proximas.length, parados: parados.length },
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

// --------------------------------------------------------------------------
// Busca em REDES SOCIAIS (Instagram / Facebook) via Serper Web Search (/search).
// O endpoint /places so traz o Google Maps; perfis sociais aparecem na busca
// web organica. Filtramos os resultados cujo link e de instagram/facebook e os
// normalizamos no mesmo formato de candidato (vao para a mesma fila de revisao).
// So funciona com SERPER_API_KEY (o Google Places nao faz busca web).
// --------------------------------------------------------------------------
function hostDe(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
}

function redeDoLink(url: string): string {
  const h = hostDe(url);
  if (h.includes("instagram.com")) return "Instagram";
  if (h.includes("facebook.com") || h.includes("fb.com")) return "Facebook";
  return "";
}

// URLs sociais que NAO sao a pagina/perfil de uma empresa (posts, fotos, videos,
// paginas de sistema) — descartadas para manter so perfis prospectaveis.
function linkSocialGenerico(url: string): boolean {
  const u = (url || "").toLowerCase();
  return /instagram\.com\/(explore|p\/|reel|reels|stories|tv\/|tags|accounts|about|directory)/.test(u)
      || /facebook\.com\/(pages\/category|events|groups|watch|marketplace|help|login|sharer|policies|business|photo|photos|media|reel|story|stories|permalink|story\.php|sharer\.php)/.test(u)
      || /\/(posts|videos|photos)\//.test(u); // .../<pagina>/posts/... etc.
}

// Extrai o @handle do perfil social a partir do link, quando houver.
function handleSocial(url: string): string {
  try {
    const seg = new URL(url).pathname.split("/").filter(Boolean)[0] || "";
    return seg && !["p", "reel", "reels", "explore"].includes(seg.toLowerCase()) ? "@" + seg : "";
  } catch { return ""; }
}

// Limpa o titulo do resultado social ("Loja X (@lojax) • Instagram photos..." -> "Loja X").
function limpaTituloSocial(titulo: string): string {
  let t = titulo || "";
  t = t.split("•")[0];                                    // "... • Instagram ..."
  t = t.split("|")[0];                                    // "... | Facebook"
  t = t.replace(/\(@[^)]+\)/g, "");                       // remove (@handle)
  t = t.replace(/\s*[-–—]\s*(Instagram|Facebook).*$/i, "");
  t = t.replace(/\s+(on|no|em)\s+Instagram.*$/i, "");
  t = t.replace(/\s+(on|no|em)\s+Facebook.*$/i, "");
  return t.trim();
}

async function serperWebBuscar(key: string, q: string): Promise<any[]> {
  const resp = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-KEY": key },
    body: JSON.stringify({ q, gl: "br", hl: "pt-br", num: 20 }),
  });
  const data: any = await resp.json();
  if (!resp.ok) throw new Error(data?.message || `Erro ${resp.status} na busca web do Serper.`);
  return data.organic ?? [];
}

// Busca perfis de empresa em redes sociais. Retorna candidatos no formato comum.
// cidade/uf vem do contexto da busca (o resultado social raramente traz endereco).
async function buscarSocial(env: Env, termo: string, cidade: string, mr: string, uf: string): Promise<Row[]> {
  if (!env.SERPER_API_KEY) return []; // redes sociais so via Serper (busca web)
  const ufNome = uf ? (geo.estado(uf)?.nome ?? uf) : "";
  const local = [cidade, mr, ufNome].filter(Boolean).join(" ");
  const base = termo || "Starlink revenda loja internet via satélite";
  // Sem operadores (site:/OR) — contas Serper free os rejeitam. Usamos palavras
  // simples e filtramos os links de instagram/facebook nos resultados organicos.
  const q = `${base} ${local} instagram facebook`.trim();
  const organicos = await serperWebBuscar(env.SERPER_API_KEY, q);
  const out: Row[] = [];
  const vistos = new Set<string>();
  for (const o of organicos) {
    const link = o.link || "";
    const rede = redeDoLink(link);
    if (!rede) continue;
    if (linkSocialGenerico(link)) continue;
    const nome = limpaTituloSocial(o.title || "");
    if (!nome) continue;
    // Dedup por nome+rede: no maximo um Instagram e um Facebook por negocio
    // (o mesmo perfil costuma aparecer em varios links/paginas).
    const chave = L.norm(nome) + "|" + rede;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    out.push({
      place_id: "", nome, tipo: rede, endereco: "", cidade, uf,
      telefone: "", whatsapp: "", cnpj: "",
      site: link, fonte: link, rede, handle: handleSocial(link),
      lat: null, lng: null,
    });
  }
  return out;
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
  if (cand.rede) obs.push(`Rede social: ${cand.rede}${cand.handle ? ` (${cand.handle})` : ""}`);
  if (cand.fonte) obs.push(`Fonte: ${cand.fonte}`);
  if (cand.tipo && !cand.rede) obs.push(`Categoria: ${cand.tipo}`);
  if (cand.auto) obs.push(`Encontrado pela varredura automática em ${String(cand.encontrado_em || hoje()).slice(0, 10)}`);
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

// --------------------------------------------------------------------------
// Historico automatico de pesquisas (tabela `pesquisas`)
// Cada busca manual e salva/atualizada; permite consultar, repesquisar ou
// excluir buscas anteriores sem refazer a consulta. Dedup por `chave`.
// --------------------------------------------------------------------------
let pesquisasPronta = false; // garante a tabela uma vez por isolate (resiliente a migracao nao aplicada)
async function ensurePesquisas(db: D1Database): Promise<void> {
  if (pesquisasPronta) return;
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS pesquisas (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       uf TEXT, cidade TEXT, microrregiao TEXT, termo TEXT, text_query TEXT,
       chave TEXT UNIQUE, total INTEGER DEFAULT 0, novos INTEGER DEFAULT 0, excluidos INTEGER DEFAULT 0,
       resultados TEXT, criado_em TEXT, atualizado_em TEXT)`
  ).run();
  pesquisasPronta = true;
}

// Chave de deduplicacao: mesma regiao + termo => mesma pesquisa (atualiza, nao duplica).
function chavePesquisa(uf: string, cidade: string, mr: string, termo: string): string {
  return [L.norm(uf), L.norm(cidade), L.norm(mr), L.norm(termo)].join("|");
}

// Upsert da pesquisa pela chave. Retorna o id (novo ou existente atualizado).
async function salvarPesquisa(
  db: D1Database,
  p: { uf: string; cidade: string; mr: string; termo: string; textQuery: string;
       total: number; novos: number; excluidos: number; resultados: any[] }
): Promise<number | null> {
  await ensurePesquisas(db);
  const chave = chavePesquisa(p.uf, p.cidade, p.mr, p.termo);
  const now = agora();
  const json = JSON.stringify(p.resultados);
  await db.prepare(
    `INSERT INTO pesquisas (uf,cidade,microrregiao,termo,text_query,chave,total,novos,excluidos,resultados,criado_em,atualizado_em)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(chave) DO UPDATE SET
       text_query=excluded.text_query, total=excluded.total, novos=excluded.novos,
       excluidos=excluded.excluidos, resultados=excluded.resultados, atualizado_em=excluded.atualizado_em`
  ).bind(
    p.uf, p.cidade, p.mr, p.termo, p.textQuery, chave,
    p.total, p.novos, p.excluidos, json, now, now
  ).run();
  const row = await db.prepare("SELECT id FROM pesquisas WHERE chave=?").bind(chave).first<Row>();
  return row ? (row.id as number) : null;
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
  const escopo = ((limpar(c.req.query("escopo")) || "maps").toString().toLowerCase()); // maps | social | ambos
  const textQuery = montarTextQuery(termo, cidade, mr, uf);

  // Redes sociais exigem Serper (busca web). Avisa se o usuario pediu social sem Serper.
  if ((escopo === "social" || escopo === "ambos") && !c.env.SERPER_API_KEY) {
    if (escopo === "social") {
      return c.json({ erro: "Busca em redes sociais exige a chave SERPER_API_KEY." }, 503);
    }
  }

  let candidatos: Row[] = [];
  try {
    if (escopo !== "social") {
      const r = await buscarFonte(c.env, textQuery);
      candidatos = r.candidatos;
    }
    if (escopo === "social" || escopo === "ambos") {
      const social = await buscarSocial(c.env, termo, cidade, mr, uf);
      candidatos = candidatos.concat(social);
    }
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
    // Endereco curto do Serper as vezes nao traz cidade/UF: completa com o contexto da busca.
    if (!cand.cidade && cidade) cand.cidade = cidade;
    if (!cand.uf && uf) cand.uf = uf;
    const dup = achaDup(idx, cand.nome, cand.cidade, cand.telefone);
    resultados.push({ ...cand, ja_salvo: dup !== null, empresa_id: dup });
  }

  // Salva/atualiza no historico de pesquisas (dedup por regiao+termo).
  let pesquisaId: number | null = null;
  try {
    const novos = resultados.filter((r) => !r.ja_salvo).length;
    pesquisaId = await salvarPesquisa(c.env.DB, {
      uf, cidade, mr, termo, textQuery,
      total: resultados.length, novos, excluidos, resultados,
    });
  } catch (ex) {
    console.log("Falha ao salvar historico de pesquisa:", ex);
  }

  return c.json({ textQuery, total: resultados.length, excluidos, resultados, pesquisa_id: pesquisaId });
});

// GET /api/prospeccao/pesquisas?uf=  — lista o historico (metadados, sem o JSON pesado).
app.get("/api/prospeccao/pesquisas", async (c) => {
  await ensurePesquisas(c.env.DB);
  const uf = (limpar(c.req.query("uf")) || "").toString().toUpperCase();
  const where = uf ? " WHERE uf=?" : "";
  const sql =
    `SELECT id,uf,cidade,microrregiao,termo,text_query,total,novos,excluidos,criado_em,atualizado_em
     FROM pesquisas${where} ORDER BY atualizado_em DESC, id DESC`;
  const stmt = uf ? c.env.DB.prepare(sql).bind(uf) : c.env.DB.prepare(sql);
  const { results } = await stmt.all<Row>();
  return c.json(results ?? []);
});

// GET /api/prospeccao/pesquisas/:id — uma pesquisa com os resultados; remarca `ja_salvo` conforme a base atual.
app.get("/api/prospeccao/pesquisas/:id{[0-9]+}", async (c) => {
  await ensurePesquisas(c.env.DB);
  const id = Number(c.req.param("id"));
  const row = await c.env.DB.prepare("SELECT * FROM pesquisas WHERE id=?").bind(id).first<Row>();
  if (!row) return c.notFound();
  let resultados: any[] = [];
  try { resultados = JSON.parse((row.resultados as string) || "[]"); } catch { resultados = []; }
  // Reavalia o que ja esta na base agora (pode ter sido salvo/excluido depois da busca).
  const idx = await baseIndex(c.env.DB);
  resultados = resultados.map((cand) => {
    const dup = achaDup(idx, cand.nome || "", cand.cidade || "", cand.telefone || "");
    return { ...cand, ja_salvo: dup !== null, empresa_id: dup };
  });
  return c.json({ ...row, resultados });
});

// DELETE /api/prospeccao/pesquisas/:id — remove uma pesquisa do historico.
app.delete("/api/prospeccao/pesquisas/:id{[0-9]+}", async (c) => {
  await ensurePesquisas(c.env.DB);
  await c.env.DB.prepare("DELETE FROM pesquisas WHERE id=?").bind(Number(c.req.param("id"))).run();
  return c.json({ ok: true });
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
const CRON_BATCH = 10;                                  // cidades por execucao (Google Maps) — ~300 créditos Serper/mês
const CRON_TERMOS = ["Starlink internet via satélite"]; // termos por cidade (1 = mais barato)
// Varredura em redes sociais (Instagram/Facebook) na mesma execucao diaria.
// Cursor proprio e lote menor para controlar custo: CRON_SOCIAL_BATCH cidades/dia
// = +CRON_SOCIAL_BATCH créditos Serper/dia. Ponha 0 para desligar a parte social.
const CRON_SOCIAL_BATCH = 5;

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

// Staging da varredura: candidatos encontrados aguardam revisao manual antes de
// entrar na base. Tabela criada sob demanda (resiliente a migracao nao aplicada).
let pendentesPronta = false;
async function ensurePendentes(db: D1Database): Promise<void> {
  if (pendentesPronta) return;
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS varredura_pendentes (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       nome TEXT, tipo TEXT, endereco TEXT, cidade TEXT, uf TEXT,
       telefone TEXT, whatsapp TEXT, site TEXT, fonte TEXT,
       lat REAL, lng REAL, place_id TEXT, chave TEXT UNIQUE, encontrado_em TEXT)`
  ).run();
  pendentesPronta = true;
}

// Chave de dedup do pendente: telefone normalizado (>=8 digitos) OU nome+cidade.
function chavePendente(nome: string, cidade: string, telefone: string): string {
  const d = soDigitos(telefone);
  if (d.length >= 8) return "tel:" + d;
  return "nc:" + L.norm(nome) + "|" + L.norm(cidade);
}

// Insere um candidato na fila de pendentes (dedup por chave, INSERT OR IGNORE).
// Retorna true se foi realmente inserido (candidato novo).
async function inserePendente(db: D1Database, cand: Row): Promise<boolean> {
  const chave = chavePendente(cand.nome, cand.cidade, cand.telefone || "");
  const res = await db.prepare(
    `INSERT OR IGNORE INTO varredura_pendentes
       (nome,tipo,endereco,cidade,uf,telefone,whatsapp,site,fonte,lat,lng,place_id,chave,encontrado_em)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    cand.nome, cand.tipo || "", cand.endereco || "", cand.cidade || "", (cand.uf || "").toUpperCase(),
    cand.telefone || "", cand.whatsapp || "", cand.site || "", cand.fonte || "",
    cand.lat ?? null, cand.lng ?? null, cand.place_id || "", chave, agora()
  ).run();
  return !!res.meta.changes;
}

// Reconstrui o objeto candidato a partir de uma linha da tabela de pendentes.
function pendenteParaCandidato(row: Row): Row {
  const tipo = String(row.tipo || "");
  const rede = (tipo === "Instagram" || tipo === "Facebook") ? tipo : "";
  return {
    nome: row.nome, tipo: row.tipo, endereco: row.endereco, cidade: row.cidade, uf: row.uf,
    telefone: row.telefone, whatsapp: row.whatsapp, site: row.site, fonte: row.fonte,
    lat: row.lat, lng: row.lng, place_id: row.place_id,
    rede, handle: rede ? handleSocial(String(row.fonte || row.site || "")) : "",
    auto: true, encontrado_em: row.encontrado_em,
  };
}

// Executa um lote da varredura a partir do cursor. Os achados vao para a tabela
// de PENDENTES (nao direto na base) — o usuario revisa e aprova depois. Retorna estatisticas.
async function runCron(env: Env): Promise<Row> {
  const db = env.DB;
  if (!fonteConfigurada(env)) {
    return { ok: false, erro: "Nenhuma chave de busca configurada (SERPER_API_KEY ou PLACES_API_KEY)." };
  }
  const cidades = alvosCron();
  if (!cidades.length) return { ok: false, erro: "Sem cidades-alvo." };
  await ensurePendentes(db);

  const cursor = parseInt((await metaGet(db, "cron_cursor")) || "0", 10) || 0;
  const lote: { municipio: string; uf: string }[] = [];
  for (let i = 0; i < CRON_BATCH && i < cidades.length; i++) {
    lote.push(cidades[(cursor + i) % cidades.length]);
  }

  const idx = await baseIndex(db);
  let pendentes = 0, jaNaBase = 0, jaPendentes = 0, excluidos = 0, buscas = 0, erros = 0;
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
        // Endereco curto do Serper as vezes nao traz cidade/UF: usa a cidade-alvo da varredura.
        if (!cand.cidade) cand.cidade = alvo.municipio;
        if (!cand.uf) cand.uf = alvo.uf;
        // Ja esta na base? nao vira pendente.
        if (achaDup(idx, cand.nome, cand.cidade, cand.telefone || "") !== null) { jaNaBase += 1; continue; }
        if (await inserePendente(db, cand)) pendentes += 1; else jaPendentes += 1;
      }
    }
  }

  // Varredura em redes sociais (Instagram/Facebook) — cursor proprio, lote menor.
  let pendentesSocial = 0;
  if (CRON_SOCIAL_BATCH > 0 && env.SERPER_API_KEY) {
    const cursorS = parseInt((await metaGet(db, "cron_cursor_social")) || "0", 10) || 0;
    const loteS: { municipio: string; uf: string }[] = [];
    for (let i = 0; i < CRON_SOCIAL_BATCH && i < cidades.length; i++) {
      loteS.push(cidades[(cursorS + i) % cidades.length]);
    }
    for (const alvo of loteS) {
      buscas += 1;
      let social: Row[];
      try { social = await buscarSocial(env, "", alvo.municipio, "", alvo.uf); }
      catch { erros += 1; continue; }
      for (const cand of social) {
        if (!cand.nome) continue;
        if (nomeBloqueado(cand.nome)) { excluidos += 1; continue; }
        if (!cand.cidade) cand.cidade = alvo.municipio;
        if (!cand.uf) cand.uf = alvo.uf;
        if (achaDup(idx, cand.nome, cand.cidade, cand.telefone || "") !== null) { jaNaBase += 1; continue; }
        if (await inserePendente(db, cand)) { pendentes += 1; pendentesSocial += 1; } else jaPendentes += 1;
      }
    }
    await metaSet(db, "cron_cursor_social", String((cursorS + CRON_SOCIAL_BATCH) % cidades.length));
  }

  const novoCursor = (cursor + CRON_BATCH) % cidades.length;
  const stats: Row = {
    ok: true, data: agora(), buscas, pendentes, pendentes_social: pendentesSocial,
    ja_na_base: jaNaBase, ja_pendentes: jaPendentes, excluidos, erros,
    cidades: lote.map((a) => `${a.municipio}/${a.uf}`),
    cursor_de: cursor, cursor_ate: novoCursor, total_cidades: cidades.length,
  };
  await metaSet(db, "cron_cursor", String(novoCursor));
  await metaSet(db, "cron_last_run", agora());
  await metaSet(db, "cron_last_stats", JSON.stringify(stats));
  console.log(
    `Cron prospecção: ${buscas} buscas em ${lote.length} cidades · ` +
    `${pendentes} pendentes novos, ${jaNaBase} já na base, ${jaPendentes} já pendentes, ` +
    `${excluidos} excluídos, ${erros} erros · cursor ${cursor}→${novoCursor}/${cidades.length}`
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

// GET /api/prospeccao/pendentes — lista os candidatos da varredura aguardando revisao.
app.get("/api/prospeccao/pendentes", async (c) => {
  await ensurePendentes(c.env.DB);
  const uf = (limpar(c.req.query("uf")) || "").toString().toUpperCase();
  const where = uf ? " WHERE uf=?" : "";
  const sql = `SELECT * FROM varredura_pendentes${where} ORDER BY encontrado_em DESC, id DESC`;
  const stmt = uf ? c.env.DB.prepare(sql).bind(uf) : c.env.DB.prepare(sql);
  const { results } = await stmt.all<Row>();
  return c.json(results ?? []);
});

// POST /api/prospeccao/pendentes/salvar  { ids?: number[], todos?: boolean }
// Aprova os pendentes: insere na base (dedup por telefone/nome+cidade) e remove da fila.
app.post("/api/prospeccao/pendentes/salvar", async (c) => {
  await ensurePendentes(c.env.DB);
  const body = await jsonBody(c);
  const todos = body.todos === true;
  const ids: number[] = Array.isArray(body.ids) ? body.ids.map((x: any) => Number(x)).filter(Number.isFinite) : [];
  if (!todos && !ids.length) return c.json({ erro: "Informe os ids a salvar (ou todos:true)." }, 400);

  const sql = todos
    ? "SELECT * FROM varredura_pendentes ORDER BY encontrado_em DESC, id DESC"
    : `SELECT * FROM varredura_pendentes WHERE id IN (${ids.map(() => "?").join(",")})`;
  const stmt = todos ? c.env.DB.prepare(sql) : c.env.DB.prepare(sql).bind(...ids);
  const { results } = await stmt.all<Row>();
  const linhas = results ?? [];

  const idx = await baseIndex(c.env.DB);
  let criados = 0, duplicados = 0;
  const removidos: number[] = [];
  for (const row of linhas) {
    const r = await salvarCandidato(c.env.DB, idx, pendenteParaCandidato(row));
    if (r === "criado") criados += 1; else duplicados += 1;
    removidos.push(row.id as number);
  }
  if (removidos.length) {
    await c.env.DB.prepare(`DELETE FROM varredura_pendentes WHERE id IN (${removidos.map(() => "?").join(",")})`)
      .bind(...removidos).run();
  }
  return c.json({ criados, duplicados, removidos: removidos.length });
});

// POST /api/prospeccao/pendentes/descartar  { ids?: number[], todos?: boolean }
// Remove pendentes sem salvar na base.
app.post("/api/prospeccao/pendentes/descartar", async (c) => {
  await ensurePendentes(c.env.DB);
  const body = await jsonBody(c);
  const todos = body.todos === true;
  const ids: number[] = Array.isArray(body.ids) ? body.ids.map((x: any) => Number(x)).filter(Number.isFinite) : [];
  if (todos) {
    await c.env.DB.prepare("DELETE FROM varredura_pendentes").run();
    return c.json({ removidos: -1 });
  }
  if (!ids.length) return c.json({ erro: "Informe os ids a descartar (ou todos:true)." }, 400);
  await c.env.DB.prepare(`DELETE FROM varredura_pendentes WHERE id IN (${ids.map(() => "?").join(",")})`)
    .bind(...ids).run();
  return c.json({ removidos: ids.length });
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
  ["Faixa de potencial", "faixa_potencial"],
  ["Já fez venda?", "ja_vendeu"],
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
  // Leitura/parse do arquivo isolada: multipart torto ou arquivo invalido
  // retorna erro claro em JSON em vez de um 500 cru (o parser de FormData do
  // Worker estoura em partes sem `name`).
  let registros: Row[] = [];
  try {
    const form = await c.req.formData();
    const f = form.get("arquivo");
    if (!f || typeof f === "string") {
      return c.json({ erro: "Envie um arquivo .xlsx ou .csv no campo 'arquivo'." }, 400);
    }
    const file = f as File;
    const nome = (file.name || "").toLowerCase();
    const buf = await file.arrayBuffer();
    if (nome.endsWith(".csv")) {
      const texto = new TextDecoder("utf-8").decode(buf).replace(/^﻿/, "");
      const wb = XLSX.read(texto, { type: "string", raw: true });
      registros = XLSX.utils.sheet_to_json<Row>(wb.Sheets[wb.SheetNames[0]], { defval: "" });
    } else {
      const wb = XLSX.read(new Uint8Array(buf), { type: "array" });
      registros = XLSX.utils.sheet_to_json<Row>(wb.Sheets[wb.SheetNames[0]], { defval: "" });
    }
  } catch (ex: any) {
    return c.json(
      { erro: "Não consegui ler o arquivo. Use o modelo (.xlsx) ou um .csv. Detalhe: " + (ex?.message ?? ex) },
      400
    );
  }

  let atualizados = 0, ignorados = 0;
  const erros: string[] = [];
  const novos: Row[] = [];
  // Numero inicial do codigo calculado UMA vez; incrementa em memoria (evita
  // 1 SELECT por linha e o antigo bug de gerar codigos repetidos).
  let proxNum = await proximoCodigoNum(c.env.DB);

  let i = 1;
  for (const bruto of registros) {
    i += 1;
    try {
      const data = linhaParaEmpresa(bruto);
      const nomeEmp = limpar(data.razao_social) || limpar(data.nome_fantasia);
      if (!nomeEmp) { ignorados += 1; continue; }
      const dup = await empresaDupCnpj(c.env.DB, soDigitos(data.cnpj));
      if (dup) {
        await atualizarEmpresa(c.env.DB, dup, montarEmpresa(data, false));
        atualizados += 1;
      } else {
        const e = montarEmpresa(data, true);
        if (!e.codigo) e.codigo = `REV-${String(proxNum++).padStart(3, "0")}`;
        novos.push(e);
      }
    } catch (ex: any) {
      erros.push(`Linha ${i}: ${ex?.message ?? ex}`);
    }
  }

  const criados = await inserirEmpresasLote(c.env.DB, novos, erros);
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
