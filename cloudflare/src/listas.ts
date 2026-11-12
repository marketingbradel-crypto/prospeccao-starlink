// Enumeracoes e regras de classificacao comercial.
// Portado de app/listas.py (compartilhado pela API).

// UFs de atuacao da Bradel (Starlink)
export const UFS = ["PA", "TO", "MA", "GO"];

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

// Normaliza string: remove acentos, minuscula, trim (equivalente a listas.norm no Python).
export function norm(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}
