# -*- coding: utf-8 -*-
"""Banco SQLite (arquivo unico, sem servidor) + schema da plataforma de prospeccao."""
import os
import sqlite3
import threading

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE, "data")
DB_PATH = os.path.join(DATA_DIR, "prospeccao.db")

_local = threading.local()

# Colunas da empresa expostas na API/Excel (ordem = ordem no modelo de planilha)
EMPRESA_CAMPOS = [
    # identificacao
    "codigo", "razao_social", "nome_fantasia", "cnpj", "inscricao_estadual",
    # contato empresa
    "telefone_comercial", "whatsapp", "email_comercial", "site_instagram",
    # endereco
    "endereco", "cep", "cidade", "uf", "microrregiao", "latitude", "longitude",
    # responsavel na empresa
    "resp_nome", "resp_cargo", "resp_telefone", "resp_whatsapp", "resp_email",
    # informacoes comerciais
    "segmento", "produtos", "trabalha_telecom", "ja_starlink", "exp_antenas",
    "equipe_tecnica", "loja_fisica", "qtd_filiais", "capacidade_vendas_mes",
    "interesse_parceiro", "origem_contato",
    # classificacao / gestao
    "canal", "responsavel", "prioridade", "status", "status_vivensis", "etapa",
    "motivo_perda", "observacoes",
    # datas e metricas do funil
    "data_lead", "data_primeiro_contato", "data_apresentacao", "data_interesse",
    "data_cadastro", "data_inicio_cred", "data_cred", "data_primeira_venda",
    "data_ultima_venda", "data_ultimo_contato", "proxima_acao", "proxima_acao_data",
    "ativacoes_mes", "ativacoes_acum",
]

SCHEMA = """
CREATE TABLE IF NOT EXISTS empresas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo TEXT,
    razao_social TEXT,
    nome_fantasia TEXT,
    cnpj TEXT,
    inscricao_estadual TEXT,
    telefone_comercial TEXT,
    whatsapp TEXT,
    email_comercial TEXT,
    site_instagram TEXT,
    endereco TEXT,
    cep TEXT,
    cidade TEXT,
    uf TEXT,
    microrregiao TEXT,
    latitude REAL,
    longitude REAL,
    resp_nome TEXT,
    resp_cargo TEXT,
    resp_telefone TEXT,
    resp_whatsapp TEXT,
    resp_email TEXT,
    segmento TEXT,
    produtos TEXT,
    trabalha_telecom INTEGER DEFAULT 0,
    ja_starlink INTEGER DEFAULT 0,
    exp_antenas INTEGER DEFAULT 0,
    equipe_tecnica INTEGER DEFAULT 0,
    loja_fisica INTEGER DEFAULT 0,
    qtd_filiais INTEGER DEFAULT 0,
    capacidade_vendas_mes TEXT,
    interesse_parceiro TEXT,
    origem_contato TEXT,
    canal TEXT DEFAULT 'Telecom',
    responsavel TEXT,
    prioridade TEXT,
    status TEXT DEFAULT 'Prospectado',
    status_vivensis TEXT DEFAULT 'Sem credenciamento',
    etapa TEXT,
    motivo_perda TEXT,
    observacoes TEXT,
    data_lead TEXT,
    data_primeiro_contato TEXT,
    data_apresentacao TEXT,
    data_interesse TEXT,
    data_cadastro TEXT,
    data_inicio_cred TEXT,
    data_cred TEXT,
    data_primeira_venda TEXT,
    data_ultima_venda TEXT,
    data_ultimo_contato TEXT,
    proxima_acao TEXT,
    proxima_acao_data TEXT,
    ativacoes_mes INTEGER DEFAULT 0,
    ativacoes_acum INTEGER DEFAULT 0,
    cnpj_norm TEXT,
    criado_em TEXT,
    atualizado_em TEXT
);
CREATE INDEX IF NOT EXISTS idx_empresas_cnpjnorm ON empresas(cnpj_norm);
CREATE INDEX IF NOT EXISTS idx_empresas_uf ON empresas(uf);
CREATE INDEX IF NOT EXISTS idx_empresas_status ON empresas(status);

CREATE TABLE IF NOT EXISTS filiais (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    empresa_id INTEGER NOT NULL,
    nome TEXT,
    cnpj TEXT,
    endereco TEXT,
    cidade TEXT,
    uf TEXT,
    telefone TEXT,
    obs TEXT,
    FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_filiais_empresa ON filiais(empresa_id);

CREATE TABLE IF NOT EXISTS contatos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    empresa_id INTEGER NOT NULL,
    data TEXT,
    tipo TEXT,
    responsavel TEXT,
    resumo TEXT,
    proxima_acao TEXT,
    proxima_acao_data TEXT,
    criado_em TEXT,
    FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_contatos_empresa ON contatos(empresa_id);

CREATE TABLE IF NOT EXISTS territorios (
    municipio TEXT,
    uf TEXT,
    responsavel TEXT,
    chave TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS meta (
    chave TEXT PRIMARY KEY,
    valor TEXT
);
"""


def get_conn():
    conn = getattr(_local, "conn", None)
    if conn is None:
        os.makedirs(DATA_DIR, exist_ok=True)
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        _local.conn = conn
    return conn


def init_db():
    conn = get_conn()
    conn.executescript(SCHEMA)
    conn.commit()


def row_to_dict(row):
    return {k: row[k] for k in row.keys()} if row is not None else None


def empresas_count():
    return get_conn().execute("SELECT COUNT(*) AS n FROM empresas").fetchone()["n"]
