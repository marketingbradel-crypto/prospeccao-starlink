# -*- coding: utf-8 -*-
"""Enumeracoes e regras de classificacao comercial (compartilhadas pela API e pelo seed)."""
import unicodedata

# UFs de atuacao da Bradel (Starlink)
UFS = ["PA", "TO", "MA", "GO"]

# Classificacao comercial — pipeline principal (9 valores do brief)
STATUS = [
    "Prospectado",
    "Primeiro contato realizado",
    "Em negociação",
    "Interessado",
    "Aguardando documentação",
    "Documentação recebida",
    "Credenciado",
    "Não interessado",
    "Sem retorno",
]

# Status Vivensis (credenciamento no portal) — secundario, mantido da planilha
STATUS_VIVENSIS = ["Sem credenciamento", "Em credenciamento", "Credenciada"]

# Canal comercial
CANAIS = ["Telecom", "Varejo (mercantil)"]

# Responsaveis (equipe de prospeccao)
RESPONSAVEIS = ["Leandro", "Ronaldo", "Luis Carlos", "Mateus", "Sunamita", "Elionay", "Alessandra"]

# Origem do lead / contato
ORIGENS = ["Indicação", "Evento", "Inbound (site)", "Prospecção ativa", "Parceiro", "Outro"]

# Prioridade comercial
PRIORIDADES = ["Alta", "Média", "Baixa"]

# Segmento de atuacao da empresa
SEGMENTOS = [
    "Telecom / Provedor (ISP)",
    "Loja de informática / eletrônicos",
    "Material de construção",
    "Agropecuária / Rural",
    "Energia solar",
    "Segurança eletrônica",
    "Assistência técnica",
    "Supermercado / Varejo",
    "Móveis e eletro",
    "Outro",
]

# Interesse em se tornar parceiro credenciado
INTERESSE = ["Sim", "Talvez", "A avaliar", "Não"]

# Motivos de perda
MOTIVOS_PERDA = ["Preço", "Sem interesse", "Concorrência", "Sem perfil", "Não respondeu", "Outro"]

# Tipos de interacao no historico de contatos
TIPOS_CONTATO = ["Ligação", "WhatsApp", "E-mail", "Visita", "Reunião", "Outro"]

# Etapa legada do funil (planilha) — mantida para compatibilidade/importacao
ETAPAS_FUNIL = [
    "Lead identificado", "Primeiro contato", "Apresentação", "Interesse confirmado",
    "Revenda cadastrada", "Primeira venda", "Revenda ativa", "Perdida/Descartada",
]

# ---- Cores do mapa por status (legenda do brief) ----
# verde=credenciado, azul=potencial, amarelo=negociacao, laranja=documentacao, vermelho=perdido/sem retorno
STATUS_COR = {
    "Credenciado": "verde",
    "Prospectado": "azul",
    "Primeiro contato realizado": "azul",
    "Em negociação": "amarelo",
    "Interessado": "amarelo",
    "Aguardando documentação": "laranja",
    "Documentação recebida": "laranja",
    "Não interessado": "vermelho",
    "Sem retorno": "vermelho",
}
COR_HEX = {
    "verde": "#2e9e5b",
    "azul": "#2f6fd0",
    "amarelo": "#e8b800",
    "laranja": "#e8811f",
    "vermelho": "#cc3a26",
    "cinza": "#9a948a",
}
COR_LABEL = {
    "verde": "Parceiro credenciado",
    "azul": "Potencial parceiro identificado",
    "amarelo": "Em negociação",
    "laranja": "Aguardando documentação",
    "vermelho": "Prospecção não concluída / perdida",
}


def cor_do_status(status: str) -> str:
    return STATUS_COR.get((status or "").strip(), "cinza")


# ---- Conversao da etapa legada (planilha) -> status do brief ----
_ETAPA_PARA_STATUS = {
    "Lead identificado": "Prospectado",
    "Primeiro contato": "Primeiro contato realizado",
    "Apresentação": "Em negociação",
    "Interesse confirmado": "Interessado",
    "Revenda cadastrada": "Documentação recebida",
    "Primeira venda": "Credenciado",
    "Revenda ativa": "Credenciado",
    "Perdida/Descartada": "Não interessado",
}


def status_a_partir_de(etapa: str, status_vivensis: str, motivo: str) -> str:
    """Deriva o status comercial (brief) a partir dos campos da planilha legada."""
    etapa = (etapa or "").strip()
    sv = (status_vivensis or "").strip()
    motivo = (motivo or "").strip()
    base = _ETAPA_PARA_STATUS.get(etapa, "Prospectado")
    if etapa == "Perdida/Descartada":
        if motivo in ("Não respondeu",):
            return "Sem retorno"
        return "Não interessado"
    # Em credenciamento no Vivensis => aguardando documentacao (se ainda nao credenciado)
    if sv == "Em credenciamento" and base not in ("Credenciado",):
        return "Aguardando documentação"
    return base


def norm(s: str) -> str:
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return s.strip().lower()
