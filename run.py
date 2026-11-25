# -*- coding: utf-8 -*-
"""
Inicia a Plataforma de Prospecção Starlink (Bradel) — APP LOCAL LEGADO.

Uso:
    python run.py

ATENÇÃO — FONTE OFICIAL DE DADOS:
    A fonte única e oficial é a plataforma na nuvem (Cloudflare Worker + D1),
    alimentada pela pasta de rede `U:\\Matriz\\Back office\\Dep` via agente-sync.
    Este app Flask local é LEGADO e NÃO deve ser usado como fonte de dados.

    Por isso o auto-import silencioso da planilha
    `Gestao_Prospeccao_Revendas_Starlink.xlsx` foi DESATIVADO: aquela planilha é
    um protótipo antigo (100 linhas) e reconstruir a base a partir dela criaria
    uma fonte paralela divergente da produção.

    Caso você REALMENTE precise semear o banco local a partir daquela planilha
    (uso de teste/desenvolvimento, por sua conta e risco), rode explicitamente:
        PERMITIR_SEED_LEGADO=1 python run.py
Depois abre o navegador em http://localhost:8000
"""
import os
import threading
import webbrowser

from app import db, excel_io
from app.server import criar_app

PORT = int(os.environ.get("PORT", "8000"))


def main():
    app = criar_app()  # garante db.init_db()
    if db.empresas_count() == 0:
        if os.environ.get("PERMITIR_SEED_LEGADO") == "1":
            print("Banco vazio — SEED LEGADO autorizado (PERMITIR_SEED_LEGADO=1).")
            print("  AVISO: planilha-protótipo obsoleta; NÃO use como fonte oficial.")
            res = excel_io.seed_from_existing()
            print("  ", res)
        else:
            print("Banco local vazio — auto-import DESATIVADO (trava anti-dupla-fonte).")
            print("  A fonte oficial é a plataforma na nuvem (Worker + D1), não esta planilha.")
            print("  Para semear mesmo assim (teste): PERMITIR_SEED_LEGADO=1 python run.py")
    url = f"http://localhost:{PORT}"
    print(f"\n  Plataforma de Prospecção Starlink — Bradel")
    print(f"  Abrindo em {url}   (feche esta janela para parar)\n")
    threading.Timer(1.2, lambda: webbrowser.open(url)).start()
    app.run(host="127.0.0.1", port=PORT, debug=False)


if __name__ == "__main__":
    main()
