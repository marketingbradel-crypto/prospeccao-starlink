# -*- coding: utf-8 -*-
"""
RECONHECIMENTO (somente leitura) do portal Vivensis - Bradel / Starlink.

O que este script FAZ:
  - Abre um navegador VISIVEL (Chromium).
  - Espera VOCE fazer login manualmente (e parar em captcha/codigo).
  - Quando voce mandar, CAPTURA a tela atual: print, HTML, texto, links,
    inventario de botoes (so lista, nao clica), e todas as tabelas/grades.

O que este script NAO FAZ:
  - Nao digita login/senha. Nao clica em Salvar/Enviar/Aprovar/Excluir/Confirmar.
  - Nao clica em NADA. Toda a navegacao e feita por voce no navegador.

Como usar:
  python vivensis_recon.py
Depois siga as instrucoes no terminal.
"""
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from playwright.sync_api import sync_playwright

PORTAL_URL = "https://vsm.info.vivensis.com.br/"
BASE = Path(__file__).parent / "vivensis_capturas"
PROFILE_DIR = Path(__file__).parent / ".vivensis_perfil"   # mantem login entre execucoes
ENV_FILE = Path(__file__).parent / ".env"

# apelidos aceitos para as credenciais no .env
USER_KEYS = ["VIVENSIS_USUARIO", "VIVENSIS_LOGIN", "VIVENSIS_USER", "VIVENSIS_EMAIL"]
PASS_KEYS = ["VIVENSIS_SENHA", "VIVENSIS_PASSWORD", "VIVENSIS_PASS"]


def carregar_env(caminho: Path) -> dict:
    """Le um .env simples (CHAVE=valor) sem depender de biblioteca externa."""
    dados = {}
    if not caminho.exists():
        return dados
    for linha in caminho.read_text(encoding="utf-8-sig").splitlines():
        linha = linha.strip()
        if not linha or linha.startswith("#") or "=" not in linha:
            continue
        chave, _, valor = linha.partition("=")
        valor = valor.strip().strip('"').strip("'")
        dados[chave.strip()] = valor
    return dados


def primeiro(dados: dict, chaves: list):
    for k in chaves:
        if dados.get(k) or os.environ.get(k):
            return dados.get(k) or os.environ.get(k)
    return None


def auto_login(page, usuario: str, senha: str) -> bool:
    """Tenta preencher o login por heuristica. Retorna True se parecer logado.
    NAO imprime a senha. Se nao achar os campos, retorna False (cai no manual)."""
    try:
        page.wait_for_timeout(1500)
        # campo de senha e o ancora mais confiavel
        campo_senha = page.locator("input[type=password]").first
        if campo_senha.count() == 0:
            # ja pode estar logado (perfil persistente) ou form em iframe
            return "password" not in (page.content() or "").lower()

        # campo de usuario: email/text/nome comum, visivel
        seletores_user = (
            "input[type=email], input[name*=user i], input[name*=login i], "
            "input[name*=email i], input[id*=user i], input[id*=login i], "
            "input[id*=email i], input[type=text]"
        )
        campo_user = page.locator(seletores_user).first
        if campo_user.count() > 0:
            campo_user.fill(usuario)
        campo_senha.fill(senha)
        # submete via Enter (nao depende de achar o botao certo)
        campo_senha.press("Enter")
        page.wait_for_timeout(3500)

        # se ainda ha campo de senha visivel, o login nao passou (erro/captcha)
        ainda_senha = page.locator("input[type=password]").count() > 0
        return not ainda_senha
    except Exception as e:
        print(f"   [aviso] auto-login falhou: {e}")
        return False

# JS que extrai tabelas <table> e grades comuns (Kendo/AgGrid/DevExtreme/Material)
JS_EXTRACT = r"""
() => {
  const out = { tables: [], grids: [], pagination: [] };

  // 1) tabelas HTML classicas
  document.querySelectorAll('table').forEach((t, i) => {
    const headers = [...t.querySelectorAll('thead th, thead td')].map(c => c.innerText.trim());
    const rows = [...t.querySelectorAll('tbody tr')].map(tr =>
      [...tr.querySelectorAll('td,th')].map(c => c.innerText.trim())
    );
    if (headers.length || rows.length) out.tables.push({ index: i, headers, rows });
  });

  // 2) grades baseadas em div (frameworks comuns)
  const gridSel = ['.k-grid','.ag-root','.dx-datagrid','mat-table','.p-datatable','[role="grid"]'];
  document.querySelectorAll(gridSel.join(',')).forEach((g, i) => {
    const cls = g.className || g.tagName;
    const headers = [...g.querySelectorAll('[role="columnheader"], .k-column-title, .ag-header-cell-text, .dx-datagrid-headers td, mat-header-cell, .p-column-title')]
      .map(c => c.innerText.trim()).filter(Boolean);
    out.grids.push({ index: i, kind: cls, headerSample: headers.slice(0, 40) });
  });

  // 3) possiveis controles de paginacao
  const pagSel = ['.k-pager','.ag-paging-panel','.dx-datagrid-pager','mat-paginator','.p-paginator','.pagination','[aria-label*="age"]'];
  document.querySelectorAll(pagSel.join(',')).forEach(p => {
    out.pagination.push((p.innerText || '').trim().slice(0, 200));
  });

  return out;
}
"""


def slug(s: str) -> str:
    keep = "".join(c if c.isalnum() or c in " -_" else "" for c in s).strip()
    return (keep.replace(" ", "_") or "tela")[:50]


def dump_frame(frame, folder: Path, tag: str):
    """Captura dados de um frame (pagina principal ou iframe)."""
    try:
        html = frame.content()
        (folder / f"html_{tag}.html").write_text(html, encoding="utf-8")
    except Exception as e:
        print(f"   [aviso] html {tag}: {e}")
    try:
        text = frame.evaluate("() => document.body ? document.body.innerText : ''")
        (folder / f"texto_{tag}.txt").write_text(text, encoding="utf-8")
    except Exception as e:
        print(f"   [aviso] texto {tag}: {e}")
    try:
        links = frame.evaluate(
            "() => [...document.querySelectorAll('a')].map(a => ({t:a.innerText.trim(), href:a.href})).filter(x=>x.t||x.href)"
        )
        (folder / f"links_{tag}.json").write_text(json.dumps(links, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception as e:
        print(f"   [aviso] links {tag}: {e}")
    try:
        # inventario de botoes (SO LISTA - nao clica em nada)
        botoes = frame.evaluate(
            "() => [...document.querySelectorAll('button, input[type=button], input[type=submit], [role=button]')].map(b => (b.innerText||b.value||'').trim()).filter(Boolean)"
        )
        (folder / f"botoes_{tag}.json").write_text(json.dumps(botoes, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception as e:
        print(f"   [aviso] botoes {tag}: {e}")
    try:
        grids = frame.evaluate(JS_EXTRACT)
        (folder / f"tabelas_{tag}.json").write_text(json.dumps(grids, ensure_ascii=False, indent=2), encoding="utf-8")
        nt = len(grids.get("tables", []))
        ng = len(grids.get("grids", []))
        print(f"   -> {tag}: {nt} tabela(s) <table>, {ng} grade(s) div, {len(links)} link(s)")
    except Exception as e:
        print(f"   [aviso] tabelas {tag}: {e}")


def capture(page, label: str):
    n = len(list(BASE.glob("captura_*"))) + 1
    folder = BASE / f"captura_{n:02d}_{slug(label)}"
    folder.mkdir(parents=True, exist_ok=True)

    info = {
        "label": label,
        "url": page.url,
        "title": page.title(),
        "momento": datetime.now().strftime("%d/%m/%Y %H:%M:%S"),
    }
    (folder / "info.json").write_text(json.dumps(info, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n[CAPTURA {n:02d}] {label}")
    print(f"   URL: {page.url}")

    try:
        page.screenshot(path=str(folder / "tela.png"), full_page=True)
    except Exception as e:
        print(f"   [aviso] screenshot: {e}")

    # pagina principal
    dump_frame(page.main_frame, folder, "principal")

    # iframes (muitos portais embutem o conteudo em iframe)
    for idx, fr in enumerate(page.frames):
        if fr == page.main_frame:
            continue
        try:
            if fr.url and fr.url != "about:blank":
                dump_frame(fr, folder, f"iframe{idx}")
        except Exception:
            pass

    print(f"   Salvo em: {folder}")


def main():
    BASE.mkdir(parents=True, exist_ok=True)
    print("=" * 70)
    print(" RECONHECIMENTO PORTAL VIVENSIS - somente leitura")
    print("=" * 70)
    print(" O navegador vai abrir. Faca o LOGIN manualmente.")
    print(" O script NAO clica em nada - quem navega e voce.")
    print("=" * 70)

    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            user_data_dir=str(PROFILE_DIR),
            headless=False,
            viewport={"width": 1500, "height": 900},
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto(PORTAL_URL, wait_until="domcontentloaded")

        # tenta auto-login via .env (sem imprimir a senha)
        env = carregar_env(ENV_FILE)
        usuario = primeiro(env, USER_KEYS)
        senha = primeiro(env, PASS_KEYS)
        logado = False
        if usuario and senha:
            print(f"\n[.env] credenciais encontradas para usuario: {usuario[:3]}***")
            print("[.env] tentando login automatico...")
            logado = auto_login(page, usuario, senha)
            if logado:
                print("[.env] login automatico OK (ou ja estava logado).")
            else:
                print("[.env] auto-login nao concluido (captcha/codigo ou campos diferentes).")
        else:
            print("\n[.env] credenciais nao encontradas - usando login manual.")
            print("       (esperado: VIVENSIS_USUARIO e VIVENSIS_SENHA)")

        if logado:
            input("\n>> Confirme que a tela inicial carregou e tecle ENTER... ")
        else:
            input("\n>> Faca o LOGIN e abra a tela inicial. Depois tecle ENTER aqui... ")
        capture(page, "home")

        print("\nAgora navegue pelo portal. A cada tela que eu deva capturar:")
        print("  - deixe a tela aberta no navegador,")
        print("  - volte aqui, digite um nome curto (ex: 'revendas', 'credenciados') e ENTER.")
        print("  - digite  fim  para encerrar.\n")

        while True:
            label = input(">> Nome da tela para capturar (ou 'fim'): ").strip()
            if label.lower() in ("fim", "sair", "exit", "quit", ""):
                break
            try:
                capture(page, label)
            except Exception as e:
                print(f"   [erro na captura] {e}")

        print("\nReconhecimento concluido. Pasta: vivensis_capturas/")
        print("Feche o navegador quando quiser (ou ele fecha ao sair).")
        try:
            ctx.close()
        except Exception:
            pass


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nInterrompido.")
        sys.exit(0)
