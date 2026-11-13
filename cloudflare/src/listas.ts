// Enumeracoes e regras de classificacao comercial.
// Portado de app/listas.py (compartilhado pela API).

// UFs de atuacao da Bradel (Starlink)
export const UFS = ["PA", "TO", "MA", "GO"];

// Universo VSM (portal Vivensis): total de revendas Starlink existentes por estado.
// Referencia para medir cobertura (quanto do universo ja foi mapeado no painel).
// Atualizar conforme nova extracao do VSM. Fonte: VSM, informado em 2026-11-13.
export const UNIVERSO_VSM: Record<string, number> = {
  GO: 220,
  MA: 170,
  PA: 287,
  TO: 120,
};

// Classificacao comercial — pipeline principal (9 valores do brief)
export const STATUS = [
  "Prospectado",
  "Primeiro contato realizado",
  "Em negociação",
  "Interessado",
  "Aguardando documentação",
  "Documentação recebida",
  "Credenciado",
  "Não interessado",
  "Sem retorno",
];

// Status Vivensis (credenciamento no portal) — secundario, mantido da planilha
export const STATUS_VIVENSIS = ["Sem credenciamento", "Em credenciamento", "Credenciada"];

// Canal comercial
export const CANAIS = ["Telecom", "Varejo (mercantil)"];

// Responsaveis (equipe de prospeccao)
export const RESPONSAVEIS = ["Leandro", "Ronaldo", "Luis Carlos", "Mateus", "Sunamita"];

// Origem do lead / contato
export const ORIGENS = ["Indicação", "Evento", "Inbound (site)", "Prospecção ativa", "Parceiro", "Outro"];

// Prioridade comercial
export const PRIORIDADES = ["Alta", "Média", "Baixa"];

// Segmento de atuacao da empresa
export const SEGMENTOS = [
  "Telecom / Provedor (ISP)",
  "Loja de informática / eletrônicos",
  "Material de construção",
  "Agropecuária / Rural",
  "Energia solar",
  "Segurança eletrônica",
  "Assistência técnica",
  "Supermercado / Varejo",
  "Outro",
];

// Interesse em se tornar parceiro credenciado
export const INTERESSE = ["Sim", "Talvez", "A avaliar", "Não"];

// Faixa de potencial — capacidade ESTIMADA de vendas/mes (preenchida no contato).
// Classifica o tamanho do parceiro/prospect independente de ja ter vendido.
export const FAIXAS_POTENCIAL = [
  "10+ vendas/mês",
  "30+ vendas/mês",
  "50+ vendas/mês",
  "80+ vendas/mês",
  "100+ vendas/mês",
];

// Cor por faixa (escala quente, do menor para o maior potencial) — usada nos chips e no painel.
export const FAIXA_HEX: Record<string, string> = {
  "10+ vendas/mês": "#8fb4e0",
  "30+ vendas/mês": "#5b8fd0",
  "50+ vendas/mês": "#e8b800",
  "80+ vendas/mês": "#e8811f",
  "100+ vendas/mês": "#cc3a26",
};

// Motivos de perda
export const MOTIVOS_PERDA = ["Preço", "Sem interesse", "Concorrência", "Sem perfil", "Não respondeu", "Outro"];

// Tipos de interacao no historico de contatos
export const TIPOS_CONTATO = ["Ligação", "WhatsApp", "E-mail", "Visita", "Reunião", "Outro"];

// Etapa legada do funil (planilha) — mantida para compatibilidade/importacao
export const ETAPAS_FUNIL = [
  "Lead identificado", "Primeiro contato", "Apresentação", "Interesse confirmado",
  "Revenda cadastrada", "Primeira venda", "Revenda ativa", "Perdida/Descartada",
];

// ---- Cores do mapa por status (legenda do brief) ----
// verde=credenciado, azul=potencial, amarelo=negociacao, laranja=documentacao, vermelho=perdido/sem retorno
export const STATUS_COR: Record<string, string> = {
  "Credenciado": "verde",
  "Prospectado": "azul",
  "Primeiro contato realizado": "azul",
  "Em negociação": "amarelo",
  "Interessado": "amarelo",
  "Aguardando documentação": "laranja",
  "Documentação recebida": "laranja",
  "Não interessado": "vermelho",
  "Sem retorno": "vermelho",
};

export const COR_HEX: Record<string, string> = {
  verde: "#2e9e5b",
  azul: "#2f6fd0",
  amarelo: "#e8b800",
  laranja: "#e8811f",
  vermelho: "#cc3a26",
  cinza: "#9a948a",
};

export const COR_LABEL: Record<string, string> = {
  verde: "Parceiro credenciado",
  azul: "Potencial parceiro identificado",
  amarelo: "Em negociação",
  laranja: "Aguardando documentação",
  vermelho: "Prospecção não concluída / perdida",
};

export function corDoStatus(status: string): string {
  return STATUS_COR[(status || "").trim()] ?? "cinza";
}

// --------------------------------------------------------------------------
// Pre-classificacao automatica da FAIXA DE POTENCIAL a partir dos sinais ja
// preenchidos na ficha. E apenas uma SUGESTAO (o vendedor confirma/ajusta) —
// nunca sobrescreve a faixa definida manualmente. Transparente: devolve os
// "motivos" para o usuario entender de onde veio a sugestao.
// --------------------------------------------------------------------------
function ehVerdadeiro(v: any): boolean {
  return v === 1 || v === "1" || v === true;
}

// Extrai o primeiro numero de um texto de capacidade ("30 a 50" -> 30; "ate 100" -> 100).
export function parseCapacidade(txt: any): number | null {
  const m = /(\d+)/.exec(String(txt ?? ""));
  return m ? parseInt(m[1], 10) : null;
}

function faixaPorNumero(n: number): string {
  if (n >= 100) return "100+ vendas/mês";
  if (n >= 80) return "80+ vendas/mês";
  if (n >= 50) return "50+ vendas/mês";
  if (n >= 30) return "30+ vendas/mês";
  return "10+ vendas/mês";
}

export function sugerirFaixa(
  e: Record<string, any>
): { faixa: string; score: number; motivos: string[] } | null {
  const motivos: string[] = [];
  let score = 0;
  const seg = String(e.segmento || "");

  if (/telecom|provedor|isp/i.test(seg)) { score += 3; motivos.push("provedor / telecom"); }
  else if (/inform|eletr[oô]nic/i.test(seg)) { score += 1; motivos.push("loja de informática"); }
  else if (/solar/i.test(seg)) { score += 1; motivos.push("energia solar"); }
  else if (/seguran/i.test(seg)) { score += 1; motivos.push("segurança eletrônica"); }

  if (ehVerdadeiro(e.trabalha_telecom)) { score += 2; motivos.push("trabalha com telecom"); }
  if (ehVerdadeiro(e.equipe_tecnica)) { score += 1; motivos.push("equipe técnica"); }
  if (ehVerdadeiro(e.exp_antenas)) { score += 1; motivos.push("experiência com antenas"); }
  if (ehVerdadeiro(e.ja_starlink)) { score += 1; motivos.push("já vende Starlink"); }
  if (ehVerdadeiro(e.loja_fisica)) { score += 1; motivos.push("loja física"); }

  const filiais = parseInt(String(e.qtd_filiais ?? "0"), 10) || 0;
  if (filiais >= 3) { score += 3; motivos.push(`${filiais} filiais`); }
  else if (filiais === 2) { score += 2; motivos.push("2 filiais"); }
  else if (filiais === 1) { score += 1; motivos.push("1 filial"); }

  const cap = parseCapacidade(e.capacidade_vendas_mes);
  let faixa: string;
  if (cap != null) {
    faixa = faixaPorNumero(cap);
    motivos.unshift(`capacidade informada: ${cap}/mês`);
  } else {
    faixa = score >= 8 ? "100+ vendas/mês"
          : score >= 6 ? "80+ vendas/mês"
          : score >= 4 ? "50+ vendas/mês"
          : score >= 2 ? "30+ vendas/mês"
          : "10+ vendas/mês";
  }

  if (!motivos.length) return null; // sem sinais suficientes para sugerir
  return { faixa, score, motivos };
}

// Normaliza string: remove acentos, minuscula, trim (equivalente a listas.norm no Python).
export function norm(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}
