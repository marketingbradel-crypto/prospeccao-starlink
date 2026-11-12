# -*- coding: utf-8 -*-
"""
ROBO VIVENSIS - rodada de MAPEAMENTO (somente leitura).

Objetivo desta versao: logar e CAPTURAR A HOME + inventario do menu, de forma
que NUNCA quebre, mesmo que o portal abra os dados numa aba nova e feche a
aba original (que foi o que aconteceu antes).

- Loga pelo .env (ou espera login manual).
- Reconquista a aba ativa depois do login (pega a aba nova).
- Grava tudo em vivensis_capturas_auto/ e um log em vivensis_log.txt.
- Tambem segue links <a> do mesmo dominio (se existirem) para ampliar o mapa.
- SOMENTE LEITURA: nao envia formularios nem clica em acoes (salvar/editar/etc).

Uso:  python vivensis_auto.py
"""
import re
import json
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

import vivensis_recon as R  # reaproveita login (.env) e dump de frames

BASE = Path(__file__).parent / "vivensis_capturas_auto"
LOG = Path(__file__).parent / "vivensis_log.txt"
PROFILE_DIR = R.PROFILE_DIR
PORTAL_URL = R.PORTAL_URL

MAX_PAGINAS = 60
ESPERA = 2000

BLOQUEIO = re.compile(
    r"salv|envi|aprov|public|exclu|delet|remov|apag|confirm|edit|"
    r"novo|nova|adicion|inclu|cadastr|grav|atualiz|importa|"
    r"desativ|ativar|bloque|reset|trocar senha|redefinir|logout|sair|sign out",
    re.I,
)


def log(msg: str):
    linha = f"[{datetime.now().strftime('%H:%M:%S')}] {msg}"
    print(linha)
    try:
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(linha + "\n")
    except Exception:
        pass


def slug(s: str) -> str:
    keep = "".join(c if c.isalnum() or c in " -_" else "" for c in (s or "")).strip()
    return (keep.replace(" ", "_") or "tela")[:50]


def mesmo_dominio(url, host):
    try:
        return urlparse(url).netloc == host
    except Exception:
        return False


def pagina_viva(ctx, page):
    """Devolve uma aba aberta. Se a atual fechou, pega a mais recente viva."""
    try:
        if page and not page.is_closed():
            return page
    except Exception:
        pass
    for pg in reversed(ctx.pages):
        try:
            if not pg.is_closed():
                return pg
        except Exception:
            continue
    return None


def dump(page, label):
    n = len(list(BASE.glob("tela_*"))) + 1
    folder = BASE / f"tela_{n:03d}_{slug(label)}"
    folder.mkdir(parents=True, exist_ok=True)
    try:
        url_atual = page.url
    except Exception:
        url_atual = ""
    try:
        titulo = page.title()
    except Exception:
        titulo = label
    (folder / "info.json").write_text(
        json.dumps({"label": label, "url": url_atual, "title": titulo,
                    "momento": datetime.now().strftime("%d/%m/%Y %H:%M:%S")},
                   ensure_ascii=False, indent=2), encoding="utf-8")
    try:
        page.screenshot(path=str(folder / "tela.png"), full_page=True, timeout=15000)
    except Exception as e:
        log(f"   [aviso] screenshot: {e}")
    try:
        R.dump_frame(page.main_frame, folder, "principal")
    except Exception as e:
        log(f"   [aviso] dump principal: {e}")
    for idx, fr in enumerate(page.frames):
        if fr == page.main_frame:
            continue
        try:
            if fr.url and fr.url != "about:blank":
                R.dump_frame(fr, folder, f"iframe{idx}")
        except Exception:
            pass
    # inventario de TUDO que e clicavel (menus, botoes, abas) - so leitura
    try:
        clicaveis = page.evaluate(
            """() => [...document.querySelectorAll('a,button,[role=menuitem],[role=tab],[routerlink],li.menu-item,.nav-link,.menu a,aside a,nav a')]
                 .map(el => ({
                    tag: el.tagName.toLowerCase(),
                    texto: (el.innerText||el.value||el.getAttribute('aria-label')||'').trim().slice(0,60),
                    href: el.getAttribute('href')||'',
                    routerlink: el.getAttribute('routerlink')||'',
                    role: el.getAttribute('role')||''
                 }))
                 .filter(x => x.texto || x.href || x.routerlink)"""
        )
        (folder / "clicaveis.json").write_text(
            json.dumps(clicaveis, ensure_ascii=False, indent=2), encoding="utf-8")
        log(f"   -> {folder.name}: {len(clicaveis)} elemento(s) clicavel(is)")
    except Exception as e:
        log(f"   [aviso] clicaveis: {e}")
    return folder


def coletar_links(page, host):
    try:
        hrefs = page.evaluate(
            "() => [...document.querySelectorAll('a[href]')].map(a => ({href:a.href,t:(a.innerText||'').trim()}))")
    except Exception:
        return []
    out = []
    for h in hrefs:
        u, t = h.get("href", ""), h.get("t", "")
        if not u or u.startswith(("javascript:", "mailto:", "tel:")):
            continue
        if not mesmo_dominio(u, host) or BLOQUEIO.search(t):
            continue
        out.append(u)
    return out


def main():
    BASE.mkdir(parents=True, exist_ok=True)
    try:
        LOG.write_text("", encoding="utf-8")  # zera log
    except Exception:
        pass
    log("=" * 60)
    log("ROBO VIVENSIS - mapeamento (somente leitura)")
    log("=" * 60)

    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            user_data_dir=str(PROFILE_DIR), headless=False,
            viewport={"width": 1500, "height": 900}, accept_downloads=False)
        ctx.on("page", lambda pg: log(f"   (nova aba detectada: {pg.url[:60]})"))

        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        log("abrindo portal...")
        page.goto(PORTAL_URL, wait_until="domcontentloaded")

        # --- login ---
        env = R.carregar_env(R.ENV_FILE)
        usuario = R.primeiro(env, R.USER_KEYS)
        senha = R.primeiro(env, R.PASS_KEYS)
        logado = False
        if usuario and senha:
            log(f"tentando login automatico (usuario {usuario[:3]}***)...")
            try:
                logado = R.auto_login(page, usuario, senha)
            except Exception as e:
                log(f"   auto-login erro: {e}")
            log("login automatico OK" if logado else "auto-login nao concluido")
        if not logado:
            input(">> Faca o login no navegador e tecle ENTER aqui... ")

        # --- RECONQUISTA a aba ativa (pode ter aberto aba nova) ---
        page.wait_for_timeout(ESPERA)
        page = pagina_viva(ctx, page)
        if page is None:
            log("[ERRO] nenhuma aba aberta apos login. Encerrando.")
            try: ctx.close()
            except Exception: pass
            return
        try:
            page.bring_to_front()
        except Exception:
            pass
        log(f"aba ativa apos login: {page.url[:70]}")
        host = urlparse(page.url).netloc

        # --- captura a home ---
        home_url = page.url
        dump(page, "home")

        # --- segue links do mesmo dominio (se houver) ---
        fila = [u for u in coletar_links(page, host) if u != home_url]
        vistos = {home_url}
        contador = 1
        for url in fila:
            if contador >= MAX_PAGINAS:
                break
            if url in vistos:
                continue
            vistos.add(url)
            page = pagina_viva(ctx, page)
            if page is None:
                log("[!] navegador fechado. encerrando.")
                break
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=25000)
                page.wait_for_timeout(ESPERA)
            except Exception as e:
                if "closed" in str(e).lower():
                    log("[!] navegador fechado. encerrando."); break
                log(f"   [pulou] {url[:60]} ({e})"); continue
            contador += 1
            try:
                t = page.title() or "tela"
            except Exception:
                t = "tela"
            log(f"[{contador:03d}] {t[:40]} | {url[:60]}")
            dump(page, t)
            for novo in coletar_links(page, host):
                if novo not in vistos and novo not in fila:
                    fila.append(novo)

        log("=" * 60)
        log(f"CONCLUIDO. {contador} tela(s) salvas em {BASE.name}/")
        log("Nao feche ainda - confira o terminal. Log em vivensis_log.txt")
        log("=" * 60)
        try:
            ctx.close()
        except Exception:
            pass


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        log(f"[ERRO FATAL] {e}")
        raise
