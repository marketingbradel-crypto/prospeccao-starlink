# -*- coding: utf-8 -*-
"""
Inicia a Plataforma de Prospecção Starlink (Bradel).

Uso:
    python run.py

Na primeira execução, se o banco estiver vazio, importa automaticamente as
revendas da planilha Gestao_Prospeccao_Revendas_Starlink.xlsx.
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
        print("Banco vazio — importando da planilha atual…")
        res = excel_io.seed_from_existing()
        print("  ", res)
    url = f"http://localhost:{PORT}"
    print(f"\n  Plataforma de Prospecção Starlink — Bradel")
    print(f"  Abrindo em {url}   (feche esta janela para parar)\n")
    threading.Timer(1.2, lambda: webbrowser.open(url)).start()
    app.run(host="127.0.0.1", port=PORT, debug=False)


if __name__ == "__main__":
    main()
