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
const app = new Hono<{ Bindings: Env }>();

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
    regioes: (est.regioes ?? []).map((r) => ({ n: r.n, d: r.d })),
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

export default app;
