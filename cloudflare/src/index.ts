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
  APP_USER?: string;   // usuario admin do login (padrao "bradel")
  APP_PASSWORD?: string; // senha do admin (bradel) — secret (wrangler secret put APP_PASSWORD)
  APP_DEFAULT_PASSWORD?: string; // senha padrao do 1o acesso dos demais logins (secret opcional)
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
  "equipe_tecnica", "loja_fisica", "possui_estoque", "qtd_filiais", "capacidade_vendas_mes",
  "faixa_potencial", "ja_vendeu",
  "interesse_parceiro", "origem_contato",
  "canal", "responsavel", "prioridade", "status", "status_vivensis", "etapa",
  "motivo_perda", "observacoes", "id_vsm",
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
  "status_vivensis", "motivo_perda", "observacoes", "id_vsm",
  "proxima_acao", "proxima_acao_data", "data_ultimo_contato",
]);
const CAMPOS_BOOL = new Set(["trabalha_telecom", "ja_starlink", "exp_antenas", "equipe_tecnica", "loja_fisica", "possui_estoque", "ja_vendeu"]);
const CAMPOS_INT = new Set(["qtd_filiais", "ativacoes_mes", "ativacoes_acum"]);
const CAMPOS_FLOAT = new Set(["latitude", "longitude"]);

type Row = Record<string, any>;

// --------------------------------------------------------------------------
// Utilitarios
// --------------------------------------------------------------------------
const FMT_TS = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});
const FMT_DIA = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
});
// Carimbo "YYYY-MM-DD HH:MM:SS" em horario de Brasilia para uma data qualquer.
function agoraDe(d: Date): string { return FMT_TS.format(d); }
function agora(): string { return FMT_TS.format(new Date()); }
function hoje(): string { return FMT_DIA.format(new Date()); }

// Carimbo N segundos no futuro (p/ expiracao de sessao / bloqueio de login).
function agoraMais(segundos: number): string { return FMT_TS.format(new Date(Date.now() + segundos * 1000)); }

// Converte "YYYY-MM-DD HH:MM:SS" (Brasilia, UTC-3 fixo desde 2019) em epoch ms.
// Comparacoes de validade/expiracao usam isto; strings do mesmo formato tambem
// podem ser comparadas lexicograficamente (formato sortavel sv-SE).
function tsEpoch(s: any): number {
  const t = Date.parse(String(s ?? "").trim().replace(" ", "T") + "-03:00");
  return Number.isFinite(t) ? t : 0;
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

// --------------------------------------------------------------------------
// Telefones — padrao BR unico: armazena so digitos (10 fixo / 11 celular),
// exibe/exporta formatado (DD) 9XXXX-XXXX ou (DD) XXXX-XXXX.
// --------------------------------------------------------------------------
// Campos de telefone da empresa e se exigem CELULAR (11 digitos com 9 apos o
// DDD). WhatsApp exige celular; telefone comum aceita fixo (10) ou celular (11).
const TEL_CAMPOS: Record<string, boolean> = {
  telefone_comercial: false,
  whatsapp: true,
  resp_telefone: false,
  resp_whatsapp: true,
};
const TEL_LABEL: Record<string, string> = {
  telefone_comercial: "Telefone comercial",
  whatsapp: "WhatsApp",
  resp_telefone: "Telefone do responsável",
  resp_whatsapp: "WhatsApp do responsável",
};

// Reduz um telefone a 10/11 digitos BR: tira nao-digitos e o DDI 55 (quando
// colado com +55 / 55). Retorna "" se nao sobrar nada.
function telDigitos(s: any): string {
  let d = soDigitos(s);
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  return d;
}

// Valido = fixo (10 digitos) ou celular (11 com 9 apos o DDD). soCel=true aceita
// somente celular (usado em WhatsApp).
function telValido(d: string, soCel: boolean): boolean {
  if (d.length === 11) return d[2] === "9";
  if (d.length === 10) return !soCel;
  return false;
}

// Formata para exibicao/exportacao. Numeros fora do padrao voltam como vieram
// (preserva legado invalido sem perder informacao).
function fmtTel(v: any): string {
  const s = String(v ?? "").trim();
  const d = telDigitos(s);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return s;
}

// Normaliza para gravar: so digitos quando valido; senao preserva o original
// (legado fica para revisao manual, sem perda).
function telParaArmazenar(v: any, soCel: boolean): string {
  const s = String(v ?? "").trim();
  if (!s) return "";
  const d = telDigitos(s);
  return telValido(d, soCel) ? d : s;
}

// Telefones que o usuario informou e estao fora do padrao (nao vazios e
// invalidos). Em edicao, um numero legado inalterado nao bloqueia (nao trava a
// edicao de outros campos). Retorna os rotulos para a mensagem de erro.
function telefonesInvalidos(data: Row, atual?: Row | null): string[] {
  const ruins: string[] = [];
  for (const [k, soCel] of Object.entries(TEL_CAMPOS)) {
    if (!(k in data)) continue;
    const s = String(data[k] ?? "").trim();
    if (!s) continue;
    const d = telDigitos(s);
    if (telValido(d, soCel)) continue;
    if (atual && d === telDigitos(atual[k])) continue; // legado inalterado
    ruins.push(TEL_LABEL[k]);
  }
  return ruins;
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
  // Telefones: grava so digitos (10 fixo / 11 celular); legado invalido preservado.
  for (const [k, soCel] of Object.entries(TEL_CAMPOS)) if (k in e) e[k] = telParaArmazenar(e[k], soCel);
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

  // Responsavel interno automatico pela regra geral de territorio (UF + excecoes
  // por microrregiao). So preenche quando vem vazio — nao sobrescreve atribuicao manual.
  if (!limpar(e.responsavel)) {
    const r = L.responsavelPara(String(e.uf ?? ""), String(e.microrregiao ?? ""));
    if (r) e.responsavel = r;
  }

  if ("cnpj" in e) e.cnpj_norm = soDigitos(e.cnpj);

  if (novo) {
    if (!e.status) e.status = "Aguardando contato";
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

// --------------------------------------------------------------------------
// Trava anti-duplicata do import
// --------------------------------------------------------------------------
// O import antigo so deduplicava por CNPJ. Como as linhas do VSM entram SEM
// CNPJ e as do formulario de credenciamento entram SEM id_vsm, nenhuma das
// duas compartilhava chave e a mesma empresa virava duas fichas. A trava casa
// em tres camadas, da identidade mais forte para a mais fraca:
//   1) CNPJ (cnpj_norm) — identidade legal; difere por filial (/0001, /0002...).
//   2) ID VSM — so o numero inicial (ignora anotacoes tipo "4561 · SO VENDAS").
//   3) Razao social + UF + Cidade (normalizados) — SO contra fichas SEM CNPJ,
//      para nao fundir CNPJs distintos de mesmo nome; a cidade entra no match
//      para preservar filiais reais (ex.: DIGISAT em 5 cidades do mesmo nome).
const estaVazio = (v: any): boolean =>
  v === null || v === undefined || (typeof v === "string" && v.trim() === "");

function normIdVsm(s: any): string {
  const m = String(s ?? "").trim().match(/^\d+/);
  return m ? m[0] : "";
}

function chaveNomeCidade(razao: any, uf: any, cidade: any): string {
  const n = L.norm(String(razao ?? ""));
  if (!n) return "";
  return `${n}|${String(uf ?? "").trim().toUpperCase()}|${L.norm(String(cidade ?? ""))}`;
}

type IndiceDup = { cnpj: Map<string, number>; vsm: Map<string, number>; nome: Map<string, { id: number; idVsm: string }> };

// Carrega UMA vez (1 query) um indice em memoria de todas as fichas existentes.
async function carregarIndiceDup(db: D1Database): Promise<IndiceDup> {
  const { results } = await db
    .prepare("SELECT id, cnpj_norm, id_vsm, razao_social, uf, cidade FROM empresas")
    .all<Row>();
  const idx: IndiceDup = { cnpj: new Map(), vsm: new Map(), nome: new Map() };
  for (const r of results ?? []) {
    const id = Number(r.id);
    const cn = soDigitos(r.cnpj_norm);
    if (cn && !idx.cnpj.has(cn)) idx.cnpj.set(cn, id);
    const v = normIdVsm(r.id_vsm);
    if (v && !idx.vsm.has(v)) idx.vsm.set(v, id);
    const k = chaveNomeCidade(r.razao_social, r.uf, r.cidade);
    if (k && !cn && !idx.nome.has(k)) idx.nome.set(k, { id, idVsm: v });
  }
  return idx;
}

// ID VSM diferente => cadastros distintos (filiais/linhas), NUNCA sao duplicata:
// so bloqueia o match por nome quando AMBOS os lados tem id_vsm e eles diferem
// (uma ficha sem id_vsm — ex.: formulario — ainda funde na ficha VSM por nome).
function idVsmConflita(a: any, b: any): boolean {
  const va = normIdVsm(a), vb = normIdVsm(b);
  return !!va && !!vb && va !== vb;
}

// Id da ficha existente que corresponde a `data`, ou null. Camadas em ordem.
function acharDupIndice(idx: IndiceDup, data: Row): number | null {
  const cn = soDigitos(data.cnpj);
  if (cn && idx.cnpj.has(cn)) return idx.cnpj.get(cn)!;
  const v = normIdVsm(data.id_vsm);
  if (v && idx.vsm.has(v)) return idx.vsm.get(v)!;
  const k = chaveNomeCidade(data.razao_social, data.uf, data.cidade);
  if (k && idx.nome.has(k)) {
    const cand = idx.nome.get(k)!;
    if (idVsmConflita(data.id_vsm, cand.idVsm)) return null; // filiais/linhas distintas
    return cand.id;
  }
  return null;
}

// Indice das fichas NOVAS ainda nao inseridas (dedup dentro do proprio arquivo).
type PendIdx = { cnpj: Map<string, Row>; vsm: Map<string, Row>; nome: Map<string, Row> };
function registrarPendente(p: PendIdx, e: Row): void {
  const cn = soDigitos(e.cnpj); if (cn && !p.cnpj.has(cn)) p.cnpj.set(cn, e);
  const v = normIdVsm(e.id_vsm); if (v && !p.vsm.has(v)) p.vsm.set(v, e);
  const k = chaveNomeCidade(e.razao_social, e.uf, e.cidade); if (k && !cn && !p.nome.has(k)) p.nome.set(k, e);
}
function acharPendente(p: PendIdx, data: Row): Row | null {
  const cn = soDigitos(data.cnpj); if (cn && p.cnpj.has(cn)) return p.cnpj.get(cn)!;
  const v = normIdVsm(data.id_vsm); if (v && p.vsm.has(v)) return p.vsm.get(v)!;
  const k = chaveNomeCidade(data.razao_social, data.uf, data.cidade);
  if (k && p.nome.has(k)) {
    const cand = p.nome.get(k)!;
    if (idVsmConflita(data.id_vsm, cand.id_vsm)) return null; // id_vsm diferente = nao funde
    return cand;
  }
  return null;
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
// Auditoria: registra CADA acao humana (append-only) p/ o painel Gerencial.
// Nunca deve quebrar a acao principal — por isso vai em try/catch. 'ts'/'dia'
// em horario de Brasilia; 'usuario' = quem esta logado. origem='sistema' para
// import/cron (nao conta como produtividade humana).
// --------------------------------------------------------------------------
type Aud = {
  acao: string;
  empresa_id?: number | null;
  empresa_nome?: string | null;
  alvo_id?: number | null;
  campo?: string | null;
  antes?: string | null;
  depois?: string | null;
  origem?: string; // 'humano' (default) | 'sistema' | 'seguranca'
  usuario?: string | null; // sobrescreve o login (ex.: cron sem usuario, ou login)
  ip?: string | null;      // sobrescreve o IP (ex.: tentativa de login falha)
};
async function registrarAuditoria(c: any, a: Aud): Promise<void> {
  try {
    const quem = a.usuario !== undefined ? a.usuario : (c.get("usuario")?.username ?? null);
    const ip = a.ip !== undefined ? a.ip : (ipDe(c) || null);
    await c.env.DB.prepare(
      "INSERT INTO auditoria (ts,dia,usuario,acao,empresa_id,empresa_nome,alvo_id,campo,valor_antes,valor_depois,origem,ip) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
    ).bind(
      agora(), hoje(), quem, a.acao,
      a.empresa_id ?? null, a.empresa_nome ?? null, a.alvo_id ?? null,
      a.campo ?? null, a.antes ?? null, a.depois ?? null, a.origem ?? "humano", ip
    ).run();
  } catch (_e) {
    // log best-effort: um erro aqui nao pode derrubar o POST/PUT/PATCH original.
  }
}
// Evento de seguranca (login/logout/permissao/export/sessao). origem='seguranca'
// nunca conta como produtividade humana (ACOES_PRODUTIVIDADE e uma allowlist).
async function logSeguranca(c: any, acao: string, extra: Partial<Aud> = {}): Promise<void> {
  await registrarAuditoria(c, { acao, origem: "seguranca", ...extra });
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
  const pend = limpar(q.pendencia);
  if (pend) { where.push("pendencia_vsm=?"); params.push(pend); }
  const vendeu = String(q.vendeu ?? "").toLowerCase();
  if (["1", "true", "sim"].includes(vendeu)) where.push("ja_vendeu=1");
  else if (["0", "nao", "não", "false"].includes(vendeu)) where.push("(ja_vendeu=0 OR ja_vendeu IS NULL)");
  if (["1", "true", "sim"].includes(q.credenciado ?? "")) where.push("status='Pronto para venda'");
  if (["1", "true", "sim"].includes(q.potencial ?? ""))
    where.push("status IN ('Aguardando contato','Em atendimento')");
  if (["1", "true", "sim"].includes(q.telecom ?? "")) where.push("(trabalha_telecom=1 OR ja_starlink=1)");
  const busca = limpar(q.q);
  if (busca) {
    const like = `%${busca}%`;
    // Busca de nome ignora espaços: "gtech" encontra "G TECH" e vice-versa.
    const likeSemEspaco = `%${String(busca).replace(/\s+/g, "")}%`;
    where.push(
      "(REPLACE(razao_social,' ','') LIKE ? OR REPLACE(nome_fantasia,' ','') LIKE ? OR cnpj LIKE ? OR resp_nome LIKE ? OR codigo LIKE ? OR cidade LIKE ?)"
    );
    params.push(likeSemEspaco, likeSemEspaco, like, like, like, like);
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

// Papeis do RBAC (3 niveis enxutos). O superadmin do env e sempre 'admin'.
//  admin    — tudo (inclui excluir empresa e gerenciar usuarios/seguranca).
//  operador — cria e edita (empresas, contatos, filiais, prospeccao, import/export);
//             NAO exclui empresa nem gerencia usuarios.
//  consulta — somente leitura: qualquer escrita retorna 403.
type Papel = "admin" | "operador" | "consulta";
const PAPEIS: Papel[] = ["admin", "operador", "consulta"];
function normPapel(p: any): Papel {
  const s = String(p ?? "").trim().toLowerCase();
  return (PAPEIS as string[]).includes(s) ? (s as Papel) : "operador";
}

// Pessoa autenticada. `env` = superadmin do secret (bradel). `admin` = papel admin.
// `mustChange` = entrou pela senha padrao e ainda precisa definir a senha pessoal.
// `sid` = id da sessao no D1 (ausente no acesso via Basic Auth de integracao).
type Usuario = { username: string; papel: Papel; admin: boolean; mustChange: boolean; env?: boolean; sid?: string };

// Autorizacao por papel (verificada SEMPRE no servidor — §2 do brief).
function podeEscrever(u: Usuario | null | undefined): boolean { return !!u && (u.papel === "admin" || u.papel === "operador"); }
function ehAdminPapel(u: Usuario | null | undefined): boolean { return !!u && u.papel === "admin"; }

// Importacao em massa (/api/import): liberada apenas para usuarios nominais —
// o superadmin do env (bradel) e a Jossy. Os demais nao fazem import em massa,
// mesmo sendo admin/operador. Gate no servidor; a UI so esconde o botao.
const IMPORT_USUARIOS = new Set(["jossy"]);
function podeImportar(u: Usuario | null | undefined, env: Env): boolean {
  if (!u) return false;
  const nome = String(u.username || "").trim().toLowerCase();
  return nome === creds(env).user.trim().toLowerCase() || IMPORT_USUARIOS.has(nome);
}

// ---- hashing de senha (PBKDF2-SHA256, so WebCrypto) ----
function hexDe(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}
function bytesDe(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
const PBKDF2_ITER = 100000;
async function hashSenha(senha: string, saltHex?: string): Promise<{ hash: string; salt: string }> {
  const salt = saltHex ? bytesDe(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", te.encode(senha), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITER, hash: "SHA-256" }, key, 256);
  return { hash: hexDe(bits), salt: hexDe(salt) };
}
// Comparacao de tempo ~constante (evita timing attack na conferencia de hash/assinatura).
function igualConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function conferirSenha(senha: string, hashHex: string, saltHex: string): Promise<boolean> {
  const { hash } = await hashSenha(senha, saltHex);
  return igualConstante(hash, hashHex);
}

// Escapa texto para interpolacao segura em HTML (previne XSS refletido).
function escapeHtml(s: any): string {
  return String(s ?? "").replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] as string));
}

// ---- sessoes revogaveis no D1 ----
// O cookie carrega "<sid>.<HMAC(APP_PASSWORD, 'psl-sess-v2|'+sid)>". O HMAC
// rejeita cookies forjados/alterados sem tocar no banco; a validade real (nao
// revogada, dentro da inatividade/expiracao) e conferida no D1.
const SESSAO_INATIVIDADE_SEG = 8 * 60 * 60;   // expira apos 8h sem atividade
const SESSAO_ABSOLUTA_SEG = 30 * 24 * 60 * 60; // validade maxima 30 dias
const SESSAO_TOUCH_SEG = 120;                  // so regrava ultima_atividade a cada 2 min

// Assina um sid com HMAC(APP_PASSWORD) — detecta adulteracao do cookie.
async function assinarSid(env: Env, sid: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", te.encode(env.APP_PASSWORD || ""), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, te.encode("psl-sess-v2|" + sid));
  return hexDe(sig);
}
async function cookieDaSessao(env: Env, sid: string): Promise<string> {
  return sid + "." + (await assinarSid(env, sid));
}
// Extrai o sid de um cookie bem-assinado (null se ausente/forjado/formato antigo).
async function sidDoCookie(env: Env, raw: string | null): Promise<string | null> {
  if (!raw) return null;
  const i = raw.lastIndexOf(".");
  if (i <= 0) return null;
  const sid = raw.slice(0, i);
  if (!/^[0-9a-f]{32,128}$/.test(sid)) return null;
  const esperado = await assinarSid(env, sid);
  return igualConstante(raw.slice(i + 1), esperado) ? sid : null;
}

// Cria uma sessao e devolve o id (hex 256 bits). Registra IP/User-Agent.
async function criarSessao(env: Env, username: string, ip: string, ua: string): Promise<string> {
  const sid = hexDe(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.prepare(
    "INSERT INTO sessoes (id,usuario,criado_em,ultima_atividade,expira_em,ip,user_agent,revogada) VALUES (?,?,?,?,?,?,?,0)"
  ).bind(sid, username, agora(), agora(), agoraMais(SESSAO_ABSOLUTA_SEG), ip || null, (ua || "").slice(0, 300)).run();
  return sid;
}
// Valida a sessao: existe, nao revogada, dentro da expiracao absoluta e da
// inatividade. Renova ultima_atividade (throttled). Retorna o username ou null.
async function validarSessao(env: Env, sid: string): Promise<string | null> {
  const r = await env.DB.prepare(
    "SELECT usuario,ultima_atividade,expira_em,revogada FROM sessoes WHERE id=?").bind(sid).first<Row>();
  if (!r || Number(r.revogada)) return null;
  const nowMs = Date.now();
  if (tsEpoch(r.expira_em) && nowMs > tsEpoch(r.expira_em)) return null;                 // expiracao absoluta
  if (nowMs - tsEpoch(r.ultima_atividade) > SESSAO_INATIVIDADE_SEG * 1000) return null;  // inatividade
  if (nowMs - tsEpoch(r.ultima_atividade) > SESSAO_TOUCH_SEG * 1000) {
    await env.DB.prepare("UPDATE sessoes SET ultima_atividade=? WHERE id=?").bind(agora(), sid).run();
  }
  return String(r.usuario);
}
async function revogarSessao(env: Env, sid: string): Promise<void> {
  await env.DB.prepare("UPDATE sessoes SET revogada=1 WHERE id=?").bind(sid).run();
}
async function revogarSessoesDoUsuario(env: Env, username: string, exceto?: string): Promise<number> {
  const res = exceto
    ? await env.DB.prepare("UPDATE sessoes SET revogada=1 WHERE usuario=? AND revogada=0 AND id<>?").bind(username, exceto).run()
    : await env.DB.prepare("UPDATE sessoes SET revogada=1 WHERE usuario=? AND revogada=0").bind(username).run();
  return Number((res as any)?.meta?.changes || 0);
}

// ---- brute-force / credential stuffing no /login ----
const BF_MAX_TENTATIVAS = 5;          // falhas antes de bloquear
const BF_BLOQUEIO_SEG = 15 * 60;      // duracao do bloqueio (15 min)
function ipDe(c: any): string { return c.req.header("CF-Connecting-IP") || c.req.header("X-Forwarded-For") || ""; }
function chaveBF(username: string, ip: string): string { return `${username}|${ip}`; }

// Esta chave esta bloqueada agora? Retorna segundos restantes (0 = liberado).
async function loginBloqueado(env: Env, chave: string): Promise<number> {
  const r = await env.DB.prepare("SELECT bloqueado_ate FROM login_tentativas WHERE chave=?").bind(chave).first<Row>();
  if (!r || !r.bloqueado_ate) return 0;
  const restante = tsEpoch(r.bloqueado_ate) - Date.now();
  return restante > 0 ? Math.ceil(restante / 1000) : 0;
}
// Registra uma falha; ao atingir o limite, aplica bloqueio temporario.
async function registrarFalhaLogin(env: Env, chave: string): Promise<void> {
  const r = await env.DB.prepare("SELECT tentativas FROM login_tentativas WHERE chave=?").bind(chave).first<Row>();
  const n = (r ? Number(r.tentativas) : 0) + 1;
  const bloq = n >= BF_MAX_TENTATIVAS ? agoraMais(BF_BLOQUEIO_SEG) : null;
  await env.DB.prepare(
    `INSERT INTO login_tentativas (chave,tentativas,bloqueado_ate,atualizado_em) VALUES (?,?,?,?)
     ON CONFLICT(chave) DO UPDATE SET tentativas=excluded.tentativas, bloqueado_ate=excluded.bloqueado_ate, atualizado_em=excluded.atualizado_em`
  ).bind(chave, n >= BF_MAX_TENTATIVAS ? 0 : n, bloq, agora()).run();
}
async function limparFalhasLogin(env: Env, chave: string): Promise<void> {
  await env.DB.prepare("DELETE FROM login_tentativas WHERE chave=?").bind(chave).run();
}

// username valido: minusculo, sem acento/espaco. Ex.: "leandro", "luiscarlos".
const RE_USERNAME = /^[a-z0-9._-]{3,30}$/;
function normUser(s: any): string { return String(s ?? "").trim().toLowerCase(); }

// O login do env (APP_USER/APP_PASSWORD) e o superadmin permanente: nunca fica sem
// acesso e e o unico "admin" (gerencia os demais). Nao vive na tabela usuarios.
function envAdmin(env: Env): Usuario {
  return { username: creds(env).user, papel: "admin", admin: true, mustChange: false, env: true };
}
// Autentica username+senha no /login. Acesso RESTRITO: so entra quem o admin
// (bradel) cadastrou previamente. Fluxo da equipe:
//  - linha pendente (must_change=1) => aceita a SENHA PADRAO (APP_DEFAULT_PASSWORD)
//    e marca mustChange (a pessoa define a senha pessoal antes de usar o sistema);
//  - linha com senha pessoal (must_change=0) => confere o hash pessoal;
//  - sem linha => nega (nao existe auto-cadastro).
async function autenticar(env: Env, username: string, senha: string): Promise<Usuario | null> {
  username = normUser(username);
  if (!username) return null;
  const { user, pass } = creds(env);
  if (username === user) return pass && senha === pass ? envAdmin(env) : null;
  if (!RE_USERNAME.test(username)) return null;
  const r = await env.DB.prepare(
    "SELECT senha_hash,salt,must_change,papel FROM usuarios WHERE username=?").bind(username).first<Row>();
  // Acesso restrito: so entra quem o admin cadastrou (tem linha na tabela).
  if (!r) return null;
  const papel = normPapel(r.papel);
  const admin = papel === "admin";
  // Com senha pessoal definida (must_change=0): confere o hash.
  if (!Number(r.must_change)) {
    return (await conferirSenha(senha, String(r.senha_hash), String(r.salt)))
      ? { username, papel, admin, mustChange: false } : null;
  }
  // Linha pendente de troca (1o acesso ou reset): aceita a senha padrao.
  const padrao = env.APP_DEFAULT_PASSWORD || "";
  if (padrao && senha === padrao) return { username, papel, admin, mustChange: true };
  return null;
}
// Resolve o usuario de um cookie ja assinado (login confiavel). Retorna null se o
// cadastro foi removido depois do login (o cookie deixa de valer).
async function carregarUsuario(env: Env, username: string): Promise<Usuario | null> {
  if (username === creds(env).user) return envAdmin(env);
  const r = await env.DB.prepare(
    "SELECT must_change,papel FROM usuarios WHERE username=?").bind(username).first<Row>();
  if (!r) return null;
  const papel = normPapel(r.papel);
  return { username, papel, admin: papel === "admin", mustChange: !!Number(r.must_change) };
}

function getCookie(c: any, name: string): string | null {
  const raw = c.req.header("Cookie") || "";
  for (const part of raw.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1);
  }
  return null;
}

// Basic Auth p/ a API (scripts/integracoes): user:senha pela mesma autenticacao.
async function usuarioBasic(c: any): Promise<Usuario | null> {
  const h = c.req.header("Authorization") || "";
  if (!h.startsWith("Basic ")) return null;
  let dec = "";
  try { dec = atob(h.slice(6)); } catch { return null; }
  const i = dec.indexOf(":");
  if (i < 0) return null;
  return await autenticar(c.env, dec.slice(0, i), dec.slice(i + 1));
}

function loginPage(erro = "", user = ""): string {
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
  <input id="u" name="user" value="${escapeHtml(user)}" placeholder="seu usuário" autocomplete="username" autocapitalize="none" autofocus spellcheck="false">
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

const app = new Hono<{ Bindings: Env; Variables: { usuario: Usuario } }>();

// Content-Security-Policy. A SPA usa só assets locais (sem CDNs externos), mas
// depende de handlers inline (onclick=) e style="" — por isso 'unsafe-inline' em
// script/style. frame-ancestors 'none' + X-Frame-Options barram clickjacking;
// connect-src 'self' impede exfiltracao p/ terceiros. Endurecer para nonces é
// um passo futuro (exigiria tirar os onclick inline do HTML).
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");
const SEC_HEADERS: Record<string, string> = {
  "Content-Security-Policy": CSP,
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
  "Cross-Origin-Opener-Policy": "same-origin",
};
// Cabecalhos de seguranca em TODA resposta (inclui assets e erros). Reconstrói a
// resposta porque os headers de respostas de assets (fetch) sao imutaveis.
app.use("*", async (c, next) => {
  await next();
  try {
    const res = c.res;
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(SEC_HEADERS)) headers.set(k, v);
    c.res = new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  } catch { /* não quebra a resposta se algo der errado */ }
});

const COOKIE_ATTRS = "HttpOnly; Secure; SameSite=Lax; Path=/";

// Middleware de login: tela propria + cookie de SESSAO (sid no D1, revogavel,
// com expiracao por inatividade); a API tambem aceita Basic. O usuario
// autenticado fica em c.get("usuario").
app.use("*", async (c, next) => {
  const env = c.env;
  if (!env.APP_PASSWORD) return c.text("Login não configurado (defina o secret APP_PASSWORD).", 503);
  const path = new URL(c.req.url).pathname;

  if (path === "/login") {
    if (c.req.method === "POST") {
      const body = await c.req.parseBody();
      const user = normUser(body.user ?? "");
      const ip = ipDe(c);
      const chave = chaveBF(user, ip);
      // Brute-force / credential stuffing: bloqueio temporario apos N falhas.
      const espera = await loginBloqueado(env, chave);
      if (espera > 0) {
        await logSeguranca(c, "login_bloqueado", { usuario: user || null, ip: ip || null, depois: `${espera}s restantes` });
        return c.html(loginPage(`Muitas tentativas. Tente novamente em ${Math.ceil(espera / 60)} min.`, String(body.user ?? "").trim()), 429);
      }
      const u = await autenticar(env, String(body.user ?? ""), String(body.pass ?? ""));
      if (u) {
        await limparFalhasLogin(env, chave);
        const sid = await criarSessao(env, u.username, ip, c.req.header("User-Agent") || "");
        c.header("Set-Cookie", `${COOKIE}=${await cookieDaSessao(env, sid)}; ${COOKIE_ATTRS}; Max-Age=${SESSAO_ABSOLUTA_SEG}`);
        await logSeguranca(c, "login_ok", { usuario: u.username, ip: ip || null });
        return c.redirect("/", 302);
      }
      await registrarFalhaLogin(env, chave);
      await logSeguranca(c, "login_falha", { usuario: user || null, ip: ip || null });
      return c.html(loginPage("Usuário ou senha incorretos.", String(body.user ?? "").trim()), 401);
    }
    return c.html(loginPage());
  }
  if (path === "/logout") {
    const sid = await sidDoCookie(env, getCookie(c, COOKIE));
    if (sid) {
      const quem = await validarSessao(env, sid);
      await revogarSessao(env, sid);
      if (quem) await logSeguranca(c, "logout", { usuario: quem });
    }
    c.header("Set-Cookie", `${COOKIE}=; ${COOKIE_ATTRS}; Max-Age=0`);
    return c.redirect("/login", 302);
  }

  // Assets estaticos: basta o cookie estar bem-assinado (sem toque no banco).
  // Paginas e API fazem a validacao completa da sessao (revogacao/inatividade).
  const ehAsset = path.startsWith("/static/") || path === "/favicon.ico";
  const sid = await sidDoCookie(env, getCookie(c, COOKIE));
  let usuario: Usuario | null = null;
  if (sid) {
    if (ehAsset) {
      usuario = { username: "", papel: "consulta", admin: false, mustChange: false, sid };
    } else {
      const login = await validarSessao(env, sid);
      if (login) {
        usuario = await carregarUsuario(env, login);
        if (usuario) usuario.sid = sid;
      }
    }
  }
  if (!usuario) usuario = await usuarioBasic(c);
  if (usuario) { c.set("usuario", usuario); return next(); }
  if (path.startsWith("/api/")) return c.json({ erro: "Não autenticado." }, 401);
  return c.redirect("/login", 302);
});

// RBAC — autorizacao por papel em TODA a API de escrita (verificacao no servidor,
// §2 do brief). GET/HEAD: qualquer autenticado. Escrita: 'operador'+ (consulta
// bloqueada). Rotas self-service (/api/me/*) e admin especificas sao tratadas
// aqui ou no proprio handler (DELETE empresa e /api/usuarios exigem admin).
app.use("/api/*", async (c, next) => {
  const m = c.req.method.toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return next();
  const u = c.get("usuario");
  const path = new URL(c.req.url).pathname;
  // Self-service: trocar a propria senha / gerenciar as proprias sessoes — liberado
  // a qualquer autenticado (inclusive consulta), para nao travar o 1º acesso.
  if (path.startsWith("/api/me/")) return next();
  if (!podeEscrever(u)) {
    return c.json({ erro: "Seu perfil é somente leitura (Consulta). Ação não permitida." }, 403);
  }
  return next();
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
    pendencias_vsm: L.PENDENCIAS_VSM,
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
  const telRuins = telefonesInvalidos(data);
  if (telRuins.length) {
    return c.json({ erro: `Telefone inválido em: ${telRuins.join(", ")}. Use DDD + número (celular com 9 dígitos).` }, 400);
  }
  const e = montarEmpresa(data, true);
  const dup = await empresaDupCnpj(c.env.DB, e.cnpj_norm);
  if (dup) return c.json({ erro: "Já existe uma empresa com este CNPJ.", id: dup }, 409);
  if (!e.codigo) e.codigo = await proximoCodigo(c.env.DB);
  const eid = await inserirEmpresa(c.env.DB, e);
  await registrarAuditoria(c, {
    acao: "empresa_nova", empresa_id: eid,
    empresa_nome: String(e.razao_social || e.nome_fantasia || ""),
  });
  return c.json({ id: eid }, 201);
});

app.put("/api/empresas/:eid{[0-9]+}", async (c) => {
  const eid = Number(c.req.param("eid"));
  const atual = await c.env.DB.prepare("SELECT * FROM empresas WHERE id=?").bind(eid).first<Row>();
  if (!atual) return c.notFound();
  const data = await jsonBody(c);
  const telRuins = telefonesInvalidos(data, atual);
  if (telRuins.length) {
    return c.json({ erro: `Telefone inválido em: ${telRuins.join(", ")}. Use DDD + número (celular com 9 dígitos).` }, 400);
  }
  const e = montarEmpresa(data, false);
  // ID VSM e imutavel depois de definido: se a empresa ja tem um, ignora
  // qualquer valor que venha do formulario (a UI tambem bloqueia o campo).
  if (String(atual.id_vsm ?? "").trim() !== "") e.id_vsm = atual.id_vsm;
  const dup = await empresaDupCnpj(c.env.DB, e.cnpj_norm, eid);
  if (dup) return c.json({ erro: "Outra empresa já usa este CNPJ.", id: dup }, 409);
  // Diff dos campos que realmente mudaram (ignora carimbos automaticos).
  const mudou: string[] = [];
  const antes: Row = {}, depois: Row = {};
  for (const k of Object.keys(e)) {
    if (k === "atualizado_em" || k === "criado_em") continue;
    const va = atual[k] ?? null, vn = e[k] ?? null;
    if (String(va ?? "") !== String(vn ?? "")) { mudou.push(k); antes[k] = va; depois[k] = vn; }
  }
  await atualizarEmpresa(c.env.DB, eid, e);
  if (mudou.length) {
    await registrarAuditoria(c, {
      acao: "empresa_edit", empresa_id: eid,
      empresa_nome: String(atual.razao_social || atual.nome_fantasia || ""),
      campo: mudou.join(", "), antes: JSON.stringify(antes), depois: JSON.stringify(depois),
    });
  }
  return c.json({ id: eid });
});

app.delete("/api/empresas/:eid{[0-9]+}", async (c) => {
  // Exclusao de empresa e irreversivel — restrita ao admin (operador nao exclui).
  if (!ehAdminPapel(c.get("usuario"))) return c.json({ erro: "Apenas o administrador pode excluir empresas." }, 403);
  const eid = Number(c.req.param("eid"));
  const emp = await c.env.DB.prepare("SELECT razao_social,nome_fantasia FROM empresas WHERE id=?").bind(eid).first<Row>();
  await c.env.DB.prepare("DELETE FROM empresas WHERE id=?").bind(eid).run();
  await registrarAuditoria(c, {
    acao: "empresa_remove", empresa_id: eid,
    empresa_nome: emp ? String(emp.razao_social || emp.nome_fantasia || "") : null,
  });
  return c.json({ ok: true });
});

app.patch("/api/empresas/:eid{[0-9]+}/status", async (c) => {
  const eid = Number(c.req.param("eid"));
  const data = await jsonBody(c);
  const novo = limpar(data.status);
  if (!L.STATUS.includes(novo)) return c.json({ erro: "Status inválido." }, 400);
  const atual = await c.env.DB.prepare("SELECT status,razao_social,nome_fantasia FROM empresas WHERE id=?").bind(eid).first<Row>();
  if ("motivo_perda" in data) {
    await c.env.DB
      .prepare("UPDATE empresas SET status=?, atualizado_em=?, motivo_perda=? WHERE id=?")
      .bind(novo, agora(), limpar(data.motivo_perda), eid).run();
  } else {
    await c.env.DB
      .prepare("UPDATE empresas SET status=?, atualizado_em=? WHERE id=?")
      .bind(novo, agora(), eid).run();
  }
  if (atual && String(atual.status ?? "") !== novo) {
    await registrarAuditoria(c, {
      acao: "status", empresa_id: eid,
      empresa_nome: String(atual.razao_social || atual.nome_fantasia || ""),
      campo: "status", antes: String(atual.status ?? ""), depois: novo,
    });
  }
  return c.json({ id: eid, status: novo, cor: L.corDoStatus(novo) });
});

// Aplica a faixa de potencial (usado pelo botao "usar sugestao"). "" limpa a faixa.
app.patch("/api/empresas/:eid{[0-9]+}/faixa", async (c) => {
  const eid = Number(c.req.param("eid"));
  const data = await jsonBody(c);
  const faixa = limpar(data.faixa_potencial) || "";
  if (faixa && !L.FAIXAS_POTENCIAL.includes(faixa)) return c.json({ erro: "Faixa inválida." }, 400);
  const atual = await c.env.DB.prepare("SELECT faixa_potencial,razao_social,nome_fantasia FROM empresas WHERE id=?").bind(eid).first<Row>();
  await c.env.DB.prepare("UPDATE empresas SET faixa_potencial=?, atualizado_em=? WHERE id=?")
    .bind(faixa || null, agora(), eid).run();
  if (atual && String(atual.faixa_potencial ?? "") !== faixa) {
    await registrarAuditoria(c, {
      acao: "faixa", empresa_id: eid,
      empresa_nome: String(atual.razao_social || atual.nome_fantasia || ""),
      campo: "faixa_potencial", antes: String(atual.faixa_potencial ?? ""), depois: faixa,
    });
  }
  return c.json({ id: eid, faixa_potencial: faixa });
});

// ---- contatos ----
app.post("/api/empresas/:eid{[0-9]+}/contatos", async (c) => {
  const eid = Number(c.req.param("eid"));
  const data = await jsonBody(c);
  const dataContato = limpar(data.data) || hoje();
  const quem = c.get("usuario").username;          // carimbo de quem registrou (auto)
  const responsavel = limpar(data.responsavel) || quem; // por padrao, a pessoa logada
  const res = await c.env.DB
    .prepare(
      "INSERT INTO contatos (empresa_id,data,tipo,responsavel,resumo,proxima_acao,proxima_acao_data,criado_em,criado_por) VALUES (?,?,?,?,?,?,?,?,?)"
    )
    .bind(eid, dataContato, limpar(data.tipo) ?? null, responsavel,
      limpar(data.resumo) ?? null, limpar(data.proxima_acao) ?? null,
      limpar(data.proxima_acao_data) ?? null, agora(), quem).run();
  await c.env.DB
    .prepare("UPDATE empresas SET data_ultimo_contato=?, proxima_acao=?, proxima_acao_data=?, atualizado_em=? WHERE id=?")
    .bind(dataContato, limpar(data.proxima_acao) ?? null, limpar(data.proxima_acao_data) ?? null, agora(), eid).run();
  const emp = await c.env.DB.prepare("SELECT razao_social,nome_fantasia FROM empresas WHERE id=?").bind(eid).first<Row>();
  await registrarAuditoria(c, {
    acao: "contato", empresa_id: eid,
    empresa_nome: emp ? String(emp.razao_social || emp.nome_fantasia || "") : null,
    alvo_id: Number((res as any)?.meta?.last_row_id) || null,
    campo: limpar(data.tipo) || null, depois: limpar(data.resumo) || null,
  });
  return c.json({ ok: true }, 201);
});

app.delete("/api/contatos/:cid{[0-9]+}", async (c) => {
  const cid = Number(c.req.param("cid"));
  const row = await c.env.DB.prepare(
    "SELECT c.empresa_id, c.resumo, e.razao_social, e.nome_fantasia FROM contatos c LEFT JOIN empresas e ON e.id=c.empresa_id WHERE c.id=?")
    .bind(cid).first<Row>();
  await c.env.DB.prepare("DELETE FROM contatos WHERE id=?").bind(cid).run();
  await registrarAuditoria(c, {
    acao: "contato_remove", empresa_id: row ? Number(row.empresa_id) : null,
    empresa_nome: row ? String(row.razao_social || row.nome_fantasia || "") : null,
    alvo_id: cid, antes: row ? String(row.resumo ?? "") : null,
  });
  return c.json({ ok: true });
});

// ---- sessao / usuarios ----
// Quem sou eu (o front usa p/ chip, menu admin e para forcar a 1a troca de senha).
app.get("/api/me", async (c) => {
  const u = c.get("usuario");
  // responsavel = carteira do login (filtra o Follow-up por padrao). "" = ve tudo (geral).
  const responsavel = L.responsavelDoLogin(u.username);
  // Permissao de acesso gerencial: admin do env sempre tem; os demais so se liberados.
  const perm_gerencial = await temPermGerencial(c, u);
  return c.json({
    username: u.username, papel: u.papel, admin: u.admin, env: !!u.env,
    must_change: u.mustChange, responsavel, perm_gerencial,
    // Flags de capacidade p/ a UI esconder botoes (defesa secundaria; o backend decide).
    pode_escrever: podeEscrever(u), pode_excluir_empresa: ehAdminPapel(u),
    pode_importar: podeImportar(u, c.env),
  });
});

// Minhas sessoes ativas (dispositivos). A sessao atual vem marcada.
app.get("/api/me/sessoes", async (c) => {
  const u = c.get("usuario");
  const { results } = await c.env.DB.prepare(
    `SELECT id, criado_em, ultima_atividade, ip, user_agent FROM sessoes
      WHERE usuario=? AND revogada=0 AND expira_em > ? ORDER BY ultima_atividade DESC`
  ).bind(u.username, agora()).all<Row>();
  const lista = (results ?? []).map((r) => ({
    atual: r.id === u.sid, criado_em: r.criado_em, ultima_atividade: r.ultima_atividade,
    ip: r.ip ?? "", user_agent: r.user_agent ?? "",
  }));
  return c.json(lista);
});

// Encerrar todas as outras sessoes (mantem a atual). "Sair de todos os dispositivos".
app.post("/api/me/logout-all", async (c) => {
  const u = c.get("usuario");
  const n = await revogarSessoesDoUsuario(c.env, u.username, u.sid);
  await logSeguranca(c, "logout_all", { depois: `${n} sessão(ões) encerrada(s)` });
  return c.json({ ok: true, encerradas: n });
});

// Define/troca a senha pessoal. No 1o acesso (mustChange) nao pede a senha atual;
// depois disso, exige. O superadmin (bradel) troca a senha pela Cloudflare, nao aqui.
app.post("/api/me/senha", async (c) => {
  const u = c.get("usuario");
  if (u.env) return c.json({ erro: "O administrador do sistema troca a senha pela Cloudflare (secret APP_PASSWORD)." }, 400);
  const d = await jsonBody(c);
  const nova = String(d.nova ?? "");
  const padrao = c.env.APP_DEFAULT_PASSWORD || "";
  if (nova.length < 6) return c.json({ erro: "A nova senha precisa ter ao menos 6 caracteres." }, 400);
  if (padrao && nova === padrao) return c.json({ erro: "Escolha uma senha diferente da senha padrão." }, 400);

  const r = await c.env.DB.prepare(
    "SELECT senha_hash,salt FROM usuarios WHERE username=?").bind(u.username).first<Row>();
  if (r) {
    // Ja tem senha pessoal: confere a atual (a menos que o admin tenha forcado troca).
    if (!u.mustChange) {
      const ok = await conferirSenha(String(d.atual ?? ""), String(r.senha_hash), String(r.salt));
      if (!ok) return c.json({ erro: "Senha atual incorreta." }, 400);
    }
    const { hash, salt } = await hashSenha(nova);
    await c.env.DB.prepare(
      "UPDATE usuarios SET senha_hash=?, salt=?, must_change=0, atualizado_em=? WHERE username=?")
      .bind(hash, salt, agora(), u.username).run();
  } else {
    // 1o acesso: cria a linha com a senha pessoal.
    const { hash, salt } = await hashSenha(nova);
    await c.env.DB.prepare(
      "INSERT INTO usuarios (username,senha_hash,salt,must_change,criado_em) VALUES (?,?,?,0,?)")
      .bind(u.username, hash, salt, agora()).run();
  }
  // Trocar a senha encerra as OUTRAS sessoes (mitiga sessao sequestrada/compartilhada).
  await revogarSessoesDoUsuario(c.env, u.username, u.sid);
  await logSeguranca(c, "senha_alterada", { usuario: u.username });
  return c.json({ ok: true });
});

// --- gestao de usuarios (somente o superadmin/bradel) ---
function soAdmin(c: any) { return c.get("usuario")?.admin === true; }

// Permissao de acesso gerencial: o admin do env sempre tem; os demais so se o
// admin liberou (usuarios.perm_gerencial=1). Independente dos demais modulos.
async function temPermGerencial(c: any, u?: Usuario): Promise<boolean> {
  u = u || c.get("usuario");
  if (!u) return false;
  if (u.admin) return true;
  const r = await c.env.DB.prepare("SELECT perm_gerencial FROM usuarios WHERE username=?")
    .bind(u.username).first();
  return !!(r && Number(r.perm_gerencial));
}

app.get("/api/usuarios", async (c) => {
  if (!soAdmin(c)) return c.json({ erro: "Apenas o administrador." }, 403);
  const { results } = await c.env.DB.prepare(
    "SELECT username,papel,must_change,perm_gerencial,criado_em,atualizado_em FROM usuarios ORDER BY username COLLATE NOCASE").all<Row>();
  return c.json((results ?? []).map((r) => ({ ...r, papel: normPapel(r.papel) })));
});

// Define o papel (RBAC) de um usuario: admin | operador | consulta (so o admin).
app.post("/api/usuarios/:username/papel", async (c) => {
  if (!soAdmin(c)) return c.json({ erro: "Apenas o administrador." }, 403);
  const username = normUser(c.req.param("username"));
  if (username === creds(c.env).user) return c.json({ erro: "O administrador do sistema não tem o papel alterado por aqui." }, 400);
  const r = await c.env.DB.prepare("SELECT papel FROM usuarios WHERE username=?").bind(username).first<Row>();
  if (!r) return c.json({ erro: "Usuário não encontrado." }, 404);
  const d = await jsonBody(c);
  const papel = String(d.papel ?? "").trim().toLowerCase();
  if (!(PAPEIS as string[]).includes(papel)) return c.json({ erro: "Papel inválido (admin, operador ou consulta)." }, 400);
  const antes = normPapel(r.papel);
  await c.env.DB.prepare("UPDATE usuarios SET papel=?, atualizado_em=? WHERE username=?").bind(papel, agora(), username).run();
  await logSeguranca(c, "papel_alterado", { alvo_id: null, campo: username, antes, depois: papel });
  return c.json({ ok: true, papel });
});

// Liberar/remover o acesso gerencial de um usuario (somente o admin). Nao mexe
// em nenhuma outra permissao/modulo.
app.post("/api/usuarios/:username/gerencial", async (c) => {
  if (!soAdmin(c)) return c.json({ erro: "Apenas o administrador." }, 403);
  const username = normUser(c.req.param("username"));
  const r = await c.env.DB.prepare("SELECT username FROM usuarios WHERE username=?").bind(username).first();
  if (!r) return c.json({ erro: "Usuário não encontrado." }, 404);
  const d = await jsonBody(c);
  const ativo = toBoolInt(d.ativo);
  await c.env.DB.prepare("UPDATE usuarios SET perm_gerencial=?, atualizado_em=? WHERE username=?")
    .bind(ativo, agora(), username).run();
  await logSeguranca(c, "perm_gerencial", { campo: username, depois: ativo ? "liberado" : "removido" });
  return c.json({ ok: true, perm_gerencial: !!ativo });
});

// "Adicionar" alguem = liberar o 1o acesso: cria a linha ja em mustChange, de modo
// que a pessoa entra com a senha padrao e define a dela. Sem senha aqui.
app.post("/api/usuarios", async (c) => {
  if (!soAdmin(c)) return c.json({ erro: "Apenas o administrador." }, 403);
  const d = await jsonBody(c);
  const username = normUser(d.username);
  if (!RE_USERNAME.test(username)) return c.json({ erro: "Usuário inválido (3-30: letras minúsculas, números, . _ -)." }, 400);
  if (username === creds(c.env).user) return c.json({ erro: "Esse usuário é reservado ao administrador do sistema." }, 400);
  const existe = await c.env.DB.prepare("SELECT username FROM usuarios WHERE username=?").bind(username).first();
  if (existe) return c.json({ erro: "Esse usuário já existe." }, 400);
  if (!(c.env.APP_DEFAULT_PASSWORD || "")) return c.json({ erro: "Defina o secret APP_DEFAULT_PASSWORD para liberar o 1º acesso." }, 400);
  const papel = (PAPEIS as string[]).includes(String(d.papel ?? "").toLowerCase()) ? String(d.papel).toLowerCase() : "operador";
  // Placeholder de hash (nunca confere): a pessoa entra pela senha padrao (sem linha-util
  // ate ela trocar). Guardamos must_change=1 so para listar quem esta pendente.
  const { hash, salt } = await hashSenha(crypto.randomUUID());
  await c.env.DB.prepare(
    "INSERT INTO usuarios (username,senha_hash,salt,must_change,papel,criado_em) VALUES (?,?,?,1,?,?)")
    .bind(username, hash, salt, papel, agora()).run();
  await logSeguranca(c, "usuario_novo", { campo: username, depois: papel });
  return c.json({ ok: true, senha_padrao: true, papel }, 201);
});

// Resetar senha = forcar nova troca. Mantem a linha mas marca must_change=1 e troca o
// hash por um aleatorio, para a pessoa voltar a entrar pela senha padrao.
app.post("/api/usuarios/:username/reset", async (c) => {
  if (!soAdmin(c)) return c.json({ erro: "Apenas o administrador." }, 403);
  const username = normUser(c.req.param("username"));
  const r = await c.env.DB.prepare("SELECT username FROM usuarios WHERE username=?").bind(username).first();
  if (!r) return c.json({ erro: "Usuário não encontrado." }, 404);
  const { hash, salt } = await hashSenha(crypto.randomUUID());
  await c.env.DB.prepare(
    "UPDATE usuarios SET senha_hash=?, salt=?, must_change=1, atualizado_em=? WHERE username=?")
    .bind(hash, salt, agora(), username).run();
  // Reset derruba as sessoes ativas do usuario (ele volta pela senha padrao).
  await revogarSessoesDoUsuario(c.env, username);
  await logSeguranca(c, "usuario_reset", { campo: username });
  return c.json({ ok: true });
});

app.delete("/api/usuarios/:username", async (c) => {
  if (!soAdmin(c)) return c.json({ erro: "Apenas o administrador." }, 403);
  const username = normUser(c.req.param("username"));
  await c.env.DB.prepare("DELETE FROM usuarios WHERE username=?").bind(username).run();
  // Remover o cadastro encerra qualquer sessao ativa dele imediatamente.
  await revogarSessoesDoUsuario(c.env, username);
  await logSeguranca(c, "usuario_remove", { campo: username });
  return c.json({ ok: true });
});

// --------------------------------------------------------------------------
// SEGURANCA E AUDITORIA — area restrita ao admin (§9 do brief).
// Sessoes ativas, historico de acessos, tentativas de login e revogacao.
// --------------------------------------------------------------------------
const ACOES_SEGURANCA_LABEL: Record<string, string> = {
  login_ok: "Login", login_falha: "Login falhou", login_bloqueado: "Login bloqueado (brute-force)",
  logout: "Logout", logout_all: "Encerrou outras sessões", senha_alterada: "Trocou a própria senha",
  usuario_novo: "Criou usuário", usuario_reset: "Resetou senha de usuário", usuario_remove: "Removeu usuário",
  papel_alterado: "Alterou papel (RBAC)", perm_gerencial: "Alterou acesso gerencial",
  sessao_revogada: "Revogou sessão", export: "Exportou dados",
};

// Todas as sessoes ativas (todos os usuarios) — para a lista de "usuários/sessões".
app.get("/api/seguranca/sessoes", async (c) => {
  if (!soAdmin(c)) return c.json({ erro: "Apenas o administrador." }, 403);
  const { results } = await c.env.DB.prepare(
    `SELECT id, usuario, criado_em, ultima_atividade, ip, user_agent FROM sessoes
      WHERE revogada=0 AND expira_em > ? ORDER BY ultima_atividade DESC LIMIT 500`
  ).bind(agora()).all<Row>();
  const atual = c.get("usuario")?.sid;
  return c.json((results ?? []).map((r) => ({
    id: r.id, atual: r.id === atual, usuario: r.usuario, criado_em: r.criado_em,
    ultima_atividade: r.ultima_atividade, ip: r.ip ?? "", user_agent: r.user_agent ?? "",
  })));
});

// Revoga uma sessao (por id) ou todas de um usuario (por usuario). Admin.
app.post("/api/seguranca/sessoes/revogar", async (c) => {
  if (!soAdmin(c)) return c.json({ erro: "Apenas o administrador." }, 403);
  const d = await jsonBody(c);
  if (d.id) {
    const sid = String(d.id);
    const r = await c.env.DB.prepare("SELECT usuario FROM sessoes WHERE id=?").bind(sid).first<Row>();
    await revogarSessao(c.env, sid);
    await logSeguranca(c, "sessao_revogada", { campo: r ? String(r.usuario) : null, depois: "1 sessão" });
    return c.json({ ok: true, encerradas: 1 });
  }
  const usuario = normUser(d.usuario);
  if (!usuario) return c.json({ erro: "Informe id ou usuario." }, 400);
  const n = await revogarSessoesDoUsuario(c.env, usuario);
  await logSeguranca(c, "sessao_revogada", { campo: usuario, depois: `${n} sessão(ões)` });
  return c.json({ ok: true, encerradas: n });
});

// Historico de acessos e eventos de seguranca (login/logout/falhas/permissoes).
app.get("/api/seguranca/acessos", async (c) => {
  if (!soAdmin(c)) return c.json({ erro: "Apenas o administrador." }, 403);
  let limit = toInt(c.req.query("limit"), 200);
  if (limit <= 0 || limit > 1000) limit = 200;
  const { results } = await c.env.DB.prepare(
    `SELECT id, ts, usuario, acao, campo, valor_antes, valor_depois, ip FROM auditoria
      WHERE origem='seguranca' ORDER BY id DESC LIMIT ?`
  ).bind(limit).all<Row>();
  return c.json((results ?? []).map((r) => ({ ...r, acao_label: ACOES_SEGURANCA_LABEL[String(r.acao)] ?? r.acao })));
});

// Tentativas de login em andamento / bloqueios ativos.
app.get("/api/seguranca/tentativas", async (c) => {
  if (!soAdmin(c)) return c.json({ erro: "Apenas o administrador." }, 403);
  const { results } = await c.env.DB.prepare(
    "SELECT chave, tentativas, bloqueado_ate, atualizado_em FROM login_tentativas ORDER BY atualizado_em DESC LIMIT 200"
  ).all<Row>();
  const nowStr = agora();
  return c.json((results ?? []).map((r) => {
    const [usuario, ip] = String(r.chave).split("|");
    return {
      usuario, ip, tentativas: Number(r.tentativas) || 0,
      bloqueado: !!(r.bloqueado_ate && String(r.bloqueado_ate) > nowStr),
      bloqueado_ate: r.bloqueado_ate ?? null, atualizado_em: r.atualizado_em,
    };
  }));
});

// Resumo para o cabecalho do painel de seguranca.
app.get("/api/seguranca/resumo", async (c) => {
  if (!soAdmin(c)) return c.json({ erro: "Apenas o administrador." }, 403);
  const nowStr = agora();
  const sess = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM sessoes WHERE revogada=0 AND expira_em > ?").bind(nowStr).first<Row>();
  const users = await c.env.DB.prepare("SELECT COUNT(DISTINCT usuario) AS n FROM sessoes WHERE revogada=0 AND expira_em > ?").bind(nowStr).first<Row>();
  const bloq = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM login_tentativas WHERE bloqueado_ate IS NOT NULL AND bloqueado_ate > ?").bind(nowStr).first<Row>();
  const falhas = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM auditoria WHERE origem='seguranca' AND acao='login_falha' AND dia=?").bind(hoje()).first<Row>();
  return c.json({
    sessoes_ativas: Number(sess?.n) || 0, usuarios_online: Number(users?.n) || 0,
    bloqueios_ativos: Number(bloq?.n) || 0, falhas_hoje: Number(falhas?.n) || 0,
  });
});

// --------------------------------------------------------------------------
// GERENCIAL — produtividade comercial (acesso restrito por perm_gerencial)
// --------------------------------------------------------------------------
// Acoes que contam como "atualizacao humana" na produtividade. Import/cron tem
// origem='sistema' e nunca entram (requisito 7).
const ACOES_PRODUTIVIDADE = [
  "contato", "status", "faixa", "empresa_edit", "empresa_nova",
  "filial_nova", "filial_remove", "contato_remove", "empresa_remove",
];

// Janela de agrupamento (segundos): varias acoes do mesmo colaborador no MESMO
// parceiro, no mesmo dia, com intervalo <= este valor contam como UMA so
// atualizacao na produtividade (ex.: mudar status + registrar contato + editar a
// ficha do mesmo lojista numa unica visita = 1 ponto, nao 3). Se ele voltar ao
// mesmo parceiro mais tarde no dia (gap maior), ai sim conta uma nova atualizacao.
// O detalhamento de CADA acao continua visivel na aba de atividades.
const JANELA_AGRUP_SEG = 10 * 60;

// Normaliza intervalo de datas (YYYY-MM-DD). Default: ultimos 30 dias.
function intervaloDatas(c: any): { inicio: string; fim: string } {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  let fim = String(c.req.query("fim") || "").trim();
  let inicio = String(c.req.query("inicio") || "").trim();
  if (!re.test(fim)) fim = hoje();
  if (!re.test(inicio)) {
    // 30 dias atras a partir de 'fim'
    const t = Date.parse(fim + "T00:00:00Z") - 29 * 86400000;
    inicio = new Date(t).toISOString().slice(0, 10);
  }
  if (inicio > fim) { const tmp = inicio; inicio = fim; fim = tmp; }
  return { inicio, fim };
}

// Lista de dias (YYYY-MM-DD) de inicio..fim, inclusivo (cap de 180 p/ seguranca).
function listaDias(inicio: string, fim: string): string[] {
  const out: string[] = [];
  let t = Date.parse(inicio + "T00:00:00Z");
  const tf = Date.parse(fim + "T00:00:00Z");
  for (let i = 0; i <= 180 && t <= tf; i++, t += 86400000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

// Painel principal: matriz colaborador x dia + totais, ranking e medias.
app.get("/api/gerencial/produtividade", async (c) => {
  if (!(await temPermGerencial(c))) return c.json({ erro: "Sem acesso gerencial." }, 403);
  const { inicio, fim } = intervaloDatas(c);
  const dias = listaDias(inicio, fim);

  const placeholders = ACOES_PRODUTIVIDADE.map(() => "?").join(",");
  const params: any[] = [inicio, fim, ...ACOES_PRODUTIVIDADE];
  let filtroUser = "";
  const usersQ = String(c.req.query("usuarios") || "").trim();
  const usersSel = usersQ ? usersQ.split(",").map((s) => normUser(s)).filter(Boolean) : [];
  if (usersSel.length) {
    filtroUser = ` AND usuario IN (${usersSel.map(() => "?").join(",")})`;
    params.push(...usersSel);
  }
  // Sessionizacao: cada acao vira "inicio de sessao" (=1) quando NAO ha outra acao
  // do mesmo colaborador, no mesmo parceiro e dia, nos ultimos JANELA_AGRUP_SEG
  // segundos. Acoes dentro da janela contam como 0 (fazem parte da mesma "visita").
  // O total do dia = soma dos inicios de sessao. LAG retorna NULL na 1a acao de
  // cada particao (parceiro), e NULL <= janela e' falso -> conta como novo inicio.
  const { results } = await c.env.DB.prepare(
    `WITH base AS (
       SELECT usuario, dia, empresa_id, CAST(strftime('%s', ts) AS INTEGER) AS epoch
         FROM auditoria
        WHERE origem='humano' AND dia BETWEEN ? AND ? AND acao IN (${placeholders})${filtroUser}
     ),
     marcada AS (
       SELECT usuario, dia,
              CASE WHEN epoch - LAG(epoch) OVER (
                     PARTITION BY usuario, dia, empresa_id ORDER BY epoch
                   ) <= ${JANELA_AGRUP_SEG} THEN 0 ELSE 1 END AS inicio
         FROM base
     )
     SELECT usuario, dia, SUM(inicio) AS n
       FROM marcada
      GROUP BY usuario, dia`
  ).bind(...params).all<Row>();

  const matriz: Record<string, Record<string, number>> = {};
  const totaisUser: Record<string, number> = {};
  const totaisDia: Record<string, number> = {};
  let totalGeral = 0;
  for (const r of results ?? []) {
    const u = String(r.usuario || "—");
    const d = String(r.dia);
    const n = Number(r.n) || 0;
    (matriz[u] = matriz[u] || {})[d] = n;
    totaisUser[u] = (totaisUser[u] || 0) + n;
    totaisDia[d] = (totaisDia[d] || 0) + n;
    totalGeral += n;
  }
  const usuarios = Object.keys(matriz).sort((a, b) => (totaisUser[b] - totaisUser[a]) || a.localeCompare(b));
  const ranking = usuarios.map((u) => ({ usuario: u, total: totaisUser[u] }));
  const nColab = usuarios.length;
  const nDias = dias.length || 1;
  const media_diaria_por_colab = nColab ? totalGeral / nColab / nDias : 0;

  return c.json({
    inicio, fim, dias, usuarios, matriz,
    totais_por_usuario: totaisUser, totais_por_dia: totaisDia,
    total_geral: totalGeral, n_colaboradores: nColab,
    media_diaria_por_colab: Math.round(media_diaria_por_colab * 10) / 10,
    ranking,
  });
});

// Historico detalhado (rastreabilidade): ultimas acoes, com antes->depois.
app.get("/api/gerencial/atividades", async (c) => {
  if (!(await temPermGerencial(c))) return c.json({ erro: "Sem acesso gerencial." }, 403);
  const { inicio, fim } = intervaloDatas(c);
  let limit = toInt(c.req.query("limit"), 200);
  if (limit <= 0 || limit > 1000) limit = 200;
  const params: any[] = [inicio, fim];
  let filtroUser = "";
  const usersQ = String(c.req.query("usuarios") || "").trim();
  const usersSel = usersQ ? usersQ.split(",").map((s) => normUser(s)).filter(Boolean) : [];
  if (usersSel.length) {
    filtroUser = ` AND usuario IN (${usersSel.map(() => "?").join(",")})`;
    params.push(...usersSel);
  }
  params.push(limit);
  const { results } = await c.env.DB.prepare(
    `SELECT id, ts, dia, usuario, acao, empresa_id, empresa_nome, alvo_id, campo, valor_antes, valor_depois, origem
       FROM auditoria
      WHERE dia BETWEEN ? AND ? AND origem<>'seguranca'${filtroUser}
      ORDER BY id DESC LIMIT ?`
  ).bind(...params).all<Row>();
  return c.json(results ?? []);
});

// Colaboradores para povoar o filtro: todos os usuarios cadastrados + o admin,
// unidos a quem ja tem historico na auditoria. So para ter a caixa de selecao
// (independe de ter atividade). Exclui nomes fixos que nao entram no filtro.
const COLAB_EXCLUIR = new Set(["jossy", "romulo"]);
app.get("/api/gerencial/colaboradores", async (c) => {
  if (!(await temPermGerencial(c))) return c.json({ erro: "Sem acesso gerencial." }, 403);
  const { results } = await c.env.DB.prepare(
    `SELECT usuario FROM (
       SELECT username AS usuario FROM usuarios
       UNION
       SELECT usuario FROM auditoria
         WHERE origem='humano' AND usuario IS NOT NULL AND TRIM(usuario)<>''
     )`
  ).all<Row>();
  const nomes = new Set<string>();
  for (const r of results ?? []) {
    const u = String(r.usuario ?? "").trim();
    if (u) nomes.add(u);
  }
  nomes.add(creds(c.env).user); // garante o admin (bradel) na lista
  const lista = [...nomes]
    .filter((u) => !COLAB_EXCLUIR.has(u.toLowerCase()))
    .sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));
  return c.json(lista);
});

// ---- filiais ----
app.post("/api/empresas/:eid{[0-9]+}/filiais", async (c) => {
  const eid = Number(c.req.param("eid"));
  const data = await jsonBody(c);
  const res = await c.env.DB
    .prepare("INSERT INTO filiais (empresa_id,nome,cnpj,endereco,cidade,uf,telefone,obs) VALUES (?,?,?,?,?,?,?,?)")
    .bind(eid, limpar(data.nome) ?? null, limpar(data.cnpj) ?? null, limpar(data.endereco) ?? null,
      limpar(data.cidade) ?? null, (limpar(data.uf) || "").toUpperCase(),
      telParaArmazenar(data.telefone, false) || null, limpar(data.obs) ?? null).run();
  await c.env.DB
    .prepare("UPDATE empresas SET qtd_filiais=(SELECT COUNT(*) FROM filiais WHERE empresa_id=?) WHERE id=?")
    .bind(eid, eid).run();
  const emp = await c.env.DB.prepare("SELECT razao_social,nome_fantasia FROM empresas WHERE id=?").bind(eid).first<Row>();
  await registrarAuditoria(c, {
    acao: "filial_nova", empresa_id: eid,
    empresa_nome: emp ? String(emp.razao_social || emp.nome_fantasia || "") : null,
    alvo_id: Number((res as any)?.meta?.last_row_id) || null, depois: limpar(data.nome) || null,
  });
  return c.json({ ok: true }, 201);
});

app.delete("/api/filiais/:fid{[0-9]+}", async (c) => {
  const fid = Number(c.req.param("fid"));
  const row = await c.env.DB.prepare(
    "SELECT f.empresa_id, f.nome, e.razao_social, e.nome_fantasia FROM filiais f LEFT JOIN empresas e ON e.id=f.empresa_id WHERE f.id=?")
    .bind(fid).first<Row>();
  await c.env.DB.prepare("DELETE FROM filiais WHERE id=?").bind(fid).run();
  if (row) {
    await c.env.DB
      .prepare("UPDATE empresas SET qtd_filiais=(SELECT COUNT(*) FROM filiais WHERE empresa_id=?) WHERE id=?")
      .bind(row.empresa_id, row.empresa_id).run();
    await registrarAuditoria(c, {
      acao: "filial_remove", empresa_id: Number(row.empresa_id),
      empresa_nome: String(row.razao_social || row.nome_fantasia || ""),
      alvo_id: fid, antes: String(row.nome ?? ""),
    });
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
    if (status === "Pronto para venda") agg.credenciados += 1;
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
  // Cobertura VSM conta SÓ empresas de origem VSM (origem_contato "VSM Vivensis").
  // As demais origens (Formulário, Prospecção ativa, etc.) entram nas contagens
  // totais, mas NÃO no percentual do universo VSM — senão a cobertura passaria de 100%.
  const porUfVsm: Record<string, number> = {};
  for (const u of L.UFS) porUfVsm[u] = 0;
  const porSegmento: Record<string, number> = {};
  const municipios = new Set<string>();
  const microrregioes = new Set<string>();
  let credenciados = 0, emNegociacao = 0, aguardando = 0, potenciais = 0, perdidos = 0;
  // Classificacao comercial: distribuicao por faixa de potencial e quem ja vendeu.
  const porFaixa: Record<string, number> = {};
  for (const f of L.FAIXAS_POTENCIAL) porFaixa[f] = 0;
  let semFaixa = 0, jaVenderam = 0;
  // Pendencias VSM (Capilaridade): quem falta treinar / assinar contrato / sem pendencia.
  // O valor combinado "Falta treinar e assinar contrato" soma nas duas pendencias.
  let pendTreinar = 0, pendContrato = 0, semPendencia = 0;
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
    const ehVsm = String(r.origem_contato || "").trim().toUpperCase().startsWith("VSM");
    if (uf && ehVsm) porUfVsm[uf] = (porUfVsm[uf] ?? 0) + 1;
    const seg = r.segmento || "—";
    porSegmento[seg] = (porSegmento[seg] ?? 0) + 1;
    if (r.cidade) municipios.add(`${uf}|${String(r.cidade).trim().toLowerCase()}`);
    if (r.microrregiao) microrregioes.add(`${uf}|${r.microrregiao}`);
    const cor = L.corDoStatus(st);
    if (st === "Pronto para venda") credenciados += 1;
    else if (cor === "amarelo") emNegociacao += 1;
    else if (cor === "laranja") aguardando += 1;
    else if (cor === "azul") potenciais += 1;
    else if (cor === "vermelho") perdidos += 1;

    const fx = (r.faixa_potencial || "").trim();
    if (fx && fx in porFaixa) porFaixa[fx] += 1; else semFaixa += 1;
    if (toBoolInt(r.ja_vendeu)) jaVenderam += 1;

    const pend = String(r.pendencia_vsm || "").trim().toLowerCase();
    if (pend) {
      if (pend.includes("treinar")) pendTreinar += 1;
      if (pend.includes("contrato")) pendContrato += 1;
      if (pend === "sem pendência" || pend === "sem pendencia") semPendencia += 1;
    }

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

  // Volume mensal de novos informado a mao (meta.volume_mensal = {"YYYY-MM": n}).
  // As datas de lead no banco estao achatadas no mes do import, entao nao refletem
  // a entrada real; quando esse volume existir, ele e a fonte da linha de leads.
  let volumeManual: Record<string, number> | null = null;
  try {
    const raw = await metaGet(c.env.DB, "volume_mensal");
    const obj = raw ? JSON.parse(raw) : null;
    if (obj && typeof obj === "object" && Object.keys(obj).length) volumeManual = obj;
  } catch { volumeManual = null; }
  const leadsFonte = volumeManual ?? leadsPorMes;

  // Monta a serie mensal contigua (sem buracos) e mantem so os ultimos 12 meses.
  const mesesSet = new Set<string>([...Object.keys(leadsFonte), ...Object.keys(credPorMes)]);
  let serieMensal: { mes: string; leads: number; creds: number }[] = [];
  if (mesesSet.size) {
    const ordenados = [...mesesSet].sort();
    const mesAtual = mesDe(hoje())!;
    const ultimo = ordenados[ordenados.length - 1];
    const limite = ultimo > mesAtual ? ultimo : mesAtual;
    let cur = ordenados[0];
    while (cur <= limite && serieMensal.length < 240) {
      serieMensal.push({ mes: cur, leads: Number(leadsFonte[cur]) || 0, creds: credPorMes[cur] ?? 0 });
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

  // Cobertura VSM: mapeadas = SÓ empresas de origem VSM (porUfVsm) vs universo de
  // revendas no portal Vivensis. `total_uf` e `outras` expõem as demais origens para
  // a UI mostrar as duas origens sem que elas entrem no percentual de cobertura.
  const coberturaVsm = L.UFS.map((u) => {
    const universo = L.UNIVERSO_VSM[u] ?? 0;
    const mapeadas = porUfVsm[u] ?? 0;
    const total_uf = porUf[u] ?? 0;
    const outras = Math.max(0, total_uf - mapeadas);
    const pct = universo ? Math.round((1000.0 * mapeadas) / universo) / 10 : 0.0;
    return { uf: u, mapeadas, universo, pct, total_uf, outras };
  });
  const universoVsmTotal = L.UFS.reduce((s, u) => s + (L.UNIVERSO_VSM[u] ?? 0), 0);
  const mapeadasVsmTotal = L.UFS.reduce((s, u) => s + (porUfVsm[u] ?? 0), 0);

  return c.json({
    total, potenciais, credenciados, em_negociacao: emNegociacao, aguardando, perdidos,
    municipios: municipios.size, microrregioes: microrregioes.size,
    taxa_conversao: taxa, por_status: porStatus, por_uf: porUf, por_segmento: porSegmentoOrd,
    serie_mensal: serieMensal, tempos_funil: temposFunil,
    por_faixa: porFaixa, sem_faixa: semFaixa, ja_venderam: jaVenderam,
    pend_treinar: pendTreinar, pend_contrato: pendContrato, sem_pendencia: semPendencia,
    cobertura_vsm: coberturaVsm, universo_vsm_total: universoVsmTotal,
    mapeadas_vsm_total: mapeadasVsmTotal,
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
const STATUS_FOLLOWUP_FECHADO = new Set(["Não interessado", "Sem retorno"]);
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
            data_ultimo_contato, faixa_potencial, origem_contato,
            pendencia_vsm, ja_vendeu, vendas_vsm, instalacoes_vsm
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
      origem_contato: r.origem_contato || "",
      pendencia_vsm: r.pendencia_vsm || "",
      ja_vendeu: toBoolInt(r.ja_vendeu) ? 1 : 0,
      vendas_vsm: Number(r.vendas_vsm) || 0,
      instalacoes_vsm: Number(r.instalacoes_vsm) || 0,
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

// Perfil PROVAVEL do candidato, inferido de evidencias no nome/categoria — nunca
// do simples fato de ser internet/telecom. E apenas um HINT (marcado "a confirmar")
// para o vendedor: so sugere "Starlink" quando a palavra aparece de fato, e empresas
// de internet/telecom viram "Infraestrutura de redes", NAO revenda Starlink.
// Retorna "" quando nao ha evidencia. Atende a regra 4 do brief de prospeccao.
function perfilProvavel(nome: string, tipo: string): string {
  const t = L.norm(`${nome} ${tipo}`);
  const perfis: string[] = [];
  if (/starlink/.test(t)) perfis.push("Starlink");
  if (/\bvsat\b|banda ku|\bku\b|via satelite|satelite/.test(t)) perfis.push("Antenas VSAT/KU (satélite)");
  if (/cftv|camera|monitorament|alarme|seguranca eletronica|vigilancia/.test(t)) perfis.push("Segurança eletrônica");
  // Fallback generico so quando nao casou nenhum perfil-alvo acima.
  if (!perfis.length && /provedor|internet|telecom|fibra|\brede/.test(t)) perfis.push("Infraestrutura de redes / internet");
  return perfis.join(" · ");
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
  const perfil = perfilProvavel(nome, String(cand.tipo || ""));
  if (perfil) obs.push(`Perfil provável (a confirmar): ${perfil}`);
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
// Termos-alvo da varredura, cobrindo os 3 perfis que queremos (Starlink, antenas
// via satelite VSAT/KU e seguranca eletronica). Para NAO multiplicar o custo, cada
// rodada usa UM termo (rotacionado pelo cursor cron_termo_idx): o custo diario
// continua = CRON_BATCH, e a lista inteira e coberta ao longo dos dias.
const CRON_TERMOS = [
  "revenda Starlink",
  "instalação de Starlink antena",
  "antena VSAT internet via satélite",
  "instalação de antena banda KU satélite",
  "instalação de CFTV e câmeras de segurança",
  "segurança eletrônica alarmes e monitoramento",
];
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

// Lista estavel de cidades-alvo (todas as cidades das UFs de atuacao),
// INTERCALADA por estado (round-robin: 1 cidade de cada UF por vez). Assim
// cada lote diario do cron toca os 4 estados juntos, em vez de esgotar o PA
// inteiro antes de comecar o TO (o que concentrava os prospects no PA).
function alvosCron(): { municipio: string; uf: string }[] {
  const porUf = L.UFS.map((uf) =>
    geo.listaMunicipios(uf).map((m) => ({ municipio: m.municipio, uf: m.uf }))
  );
  const maxLen = Math.max(0, ...porUf.map((l) => l.length));
  const out: { municipio: string; uf: string }[] = [];
  for (let i = 0; i < maxLen; i++) {
    for (const lista of porUf) {
      if (i < lista.length) out.push(lista[i]);
    }
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

  // Um termo por rodada, rotacionado (ver CRON_TERMOS) — custo diario = CRON_BATCH.
  const termoIdx = parseInt((await metaGet(db, "cron_termo_idx")) || "0", 10) || 0;
  const termo = CRON_TERMOS[termoIdx % CRON_TERMOS.length];

  const idx = await baseIndex(db);
  let pendentes = 0, jaNaBase = 0, jaPendentes = 0, excluidos = 0, buscas = 0, erros = 0;
  for (const alvo of lote) {
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
    termo, cidades: lote.map((a) => `${a.municipio}/${a.uf}`),
    cursor_de: cursor, cursor_ate: novoCursor, total_cidades: cidades.length,
  };
  await metaSet(db, "cron_cursor", String(novoCursor));
  await metaSet(db, "cron_termo_idx", String((termoIdx + 1) % CRON_TERMOS.length));
  await metaSet(db, "cron_last_run", agora());
  await metaSet(db, "cron_last_stats", JSON.stringify(stats));
  // Housekeeping de seguranca: limpa sessoes expiradas/revogadas e bloqueios
  // vencidos (best-effort, nunca derruba a varredura).
  try {
    await db.prepare("DELETE FROM sessoes WHERE expira_em < ? OR (revogada=1 AND ultima_atividade < ?)")
      .bind(agora(), agoraMais(-7 * 24 * 60 * 60)).run();
    await db.prepare("DELETE FROM login_tentativas WHERE bloqueado_ate IS NULL OR bloqueado_ate < ?")
      .bind(agoraMais(-24 * 60 * 60)).run();
  } catch { /* ignora */ }
  console.log(
    `Cron prospecção: ${buscas} buscas em ${lote.length} cidades · termo "${termo}" · ` +
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
  ["Possui estoque?", "possui_estoque"],
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
  ["ID VSM", "id_vsm"],
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
        else if (col in TEL_CAMPOS) v = fmtTel(v);
        return v ?? "";
      })
    );
  }
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  XLSX.utils.book_append_sheet(wb, ws, "Empresas");
  // Exportacao de dados e auditada (§5): quem baixou, quando, quantas linhas.
  await logSeguranca(c, "export", { depois: `${(results ?? []).length} empresas` });
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
  // Import em massa e restrito a usuarios nominais (bradel/jossy). Qualquer outro
  // recebe 403 mesmo que a UI tivesse mostrado o botao.
  if (!podeImportar(c.get("usuario"), c.env)) {
    return c.json({ erro: "Import em massa nao disponivel para este usuario." }, 403);
  }
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

  let atualizados = 0, ignorados = 0, mesclados = 0;
  const erros: string[] = [];
  const novos: Row[] = [];
  // Numero inicial do codigo calculado UMA vez; incrementa em memoria (evita
  // 1 SELECT por linha e o antigo bug de gerar codigos repetidos).
  let proxNum = await proximoCodigoNum(c.env.DB);

  // Trava anti-duplicata: indice das fichas existentes (1 query) + indice das
  // fichas novas deste arquivo (dedup dentro do proprio lote).
  const idx = await carregarIndiceDup(c.env.DB);
  const pend: PendIdx = { cnpj: new Map(), vsm: new Map(), nome: new Map() };

  let i = 1;
  for (const bruto of registros) {
    i += 1;
    try {
      const data = linhaParaEmpresa(bruto);
      const nomeEmp = limpar(data.razao_social) || limpar(data.nome_fantasia);
      if (!nomeEmp) { ignorados += 1; continue; }

      // 1) Ja existe no banco (CNPJ / ID VSM / nome+UF+cidade)? Preenche lacunas.
      const dup = acharDupIndice(idx, data);
      if (dup) {
        const atual = await c.env.DB.prepare("SELECT * FROM empresas WHERE id=?").bind(dup).first<Row>();
        const e = montarEmpresa(data, false);
        // ID VSM e imutavel depois de definido.
        if (atual && String(atual.id_vsm ?? "").trim() !== "") e.id_vsm = atual.id_vsm;
        // Merge nao-destrutivo: so preenche campo que a ficha NAO tem; celula
        // vazia do arquivo nunca apaga dado existente.
        for (const k of Object.keys(e)) {
          if (k === "atualizado_em") continue;
          if (estaVazio(e[k]) || (atual && !estaVazio(atual[k]))) delete e[k];
        }
        if (Object.keys(e).some((k) => k !== "atualizado_em")) {
          e.atualizado_em = agora();
          await atualizarEmpresa(c.env.DB, dup, e);
          const cn = soDigitos(e.cnpj); if (cn) idx.cnpj.set(cn, dup); // ficha pode ter ganho CNPJ
          atualizados += 1;
        } else {
          ignorados += 1; // ja completa, nada a preencher
        }
        continue;
      }

      // 2) Linha repetida DENTRO do mesmo arquivo? Mescla na que ja vai ser criada.
      const p = acharPendente(pend, data);
      if (p) {
        const e = montarEmpresa(data, true);
        for (const k of Object.keys(e)) {
          if (k === "codigo" || k === "criado_em") continue;
          if (!estaVazio(e[k]) && estaVazio(p[k])) p[k] = e[k];
        }
        registrarPendente(pend, p); // re-registra: pode ter ganho CNPJ/ID VSM
        mesclados += 1;
        continue;
      }

      // 3) Empresa nova de fato.
      const e = montarEmpresa(data, true);
      if (!e.codigo) e.codigo = `REV-${String(proxNum++).padStart(3, "0")}`;
      novos.push(e);
      registrarPendente(pend, e);
    } catch (ex: any) {
      erros.push(`Linha ${i}: ${ex?.message ?? ex}`);
    }
  }

  const criados = await inserirEmpresasLote(c.env.DB, novos, erros);
  // Import e acao em lote: registra como origem 'sistema' (NAO conta como
  // produtividade humana no painel Gerencial), apenas para rastreabilidade.
  await registrarAuditoria(c, {
    acao: "import", origem: "sistema",
    depois: `criados=${criados}, atualizados=${atualizados}, mesclados=${mesclados}, ignorados=${ignorados}`,
  });
  return c.json({ criados, atualizados, mesclados, ignorados, erros });
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
