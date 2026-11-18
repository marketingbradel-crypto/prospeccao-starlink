# -*- coding: utf-8 -*-
"""Enriquecimento de fichas: casa planilhas-fonte com a base de prod e
propoe preenchimento SOMENTE de campos em branco, apenas em matches certos."""
import json, re, unicodedata, pandas as pd

# ---------- normalizacao ----------
def strip_acc(s):
    if s is None: return ''
    s = str(s)
    s = unicodedata.normalize('NFKD', s)
    return ''.join(c for c in s if not unicodedata.combining(c))

def norm_txt(s):
    s = strip_acc(s).upper()
    s = re.sub(r'[^A-Z0-9 ]', ' ', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s

SUFX = r'\b(LTDA|ME|MEI|EIRELI|EPP|SA|S A|EI|CIA|COMERCIO|COMERCIAL|E|DE|DA|DO|DOS|DAS)\b'
def norm_name(s):
    s = norm_txt(s)
    s = re.sub(SUFX, ' ', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s

def phones(s):
    """retorna set de telefones normalizados (ultimos 10 e 11 digitos)."""
    out = set()
    if not s: return out
    for part in re.split(r'[\/;,]| ou ', str(s)):
        d = re.sub(r'\D', '', part)
        if len(d) >= 10:
            out.add(d[-11:]); out.add(d[-10:])
    return out

def digits(s):
    return re.sub(r'\D', '', str(s or ''))

def name_tokens(s):
    return set(t for t in norm_name(s).split() if len(t) > 2)

def name_match(a, b):
    na, nb = norm_name(a), norm_name(b)
    if not na or not nb: return False, 0.0
    if na == nb: return True, 1.0
    ta, tb = name_tokens(a), name_tokens(b)
    if not ta or not tb: return False, 0.0
    inter = ta & tb
    jac = len(inter) / len(ta | tb)
    # considera match se todos os tokens do menor nome estao no maior, ou jaccard alto
    contained = inter == ta or inter == tb
    strong = (contained and len(inter) >= 1) or jac >= 0.6
    return strong, jac

# ---------- carregar base prod ----------
prod = json.load(open('_prod_empresas.json', encoding='utf-8'))[0]['results']
for r in prod:
    r['_ph'] = phones(r.get('telefone_comercial')) | phones(r.get('whatsapp'))
    r['_cid'] = norm_txt(r.get('cidade'))
    r['_uf'] = (r.get('uf') or '').strip().upper()

# ---------- fontes ----------
sources = []  # cada item: dict com campos candidatos + chaves

# 1) formulario
form = json.load(open('_form_recs.json', encoding='utf-8'))
for r in form:
    cep = digits(r['cep'])
    endereco = ''
    if r['logr']:
        endereco = r['logr'].strip()
        if r['num']: endereco += ', ' + r['num'].strip()
        if r['compl']: endereco += ' - ' + r['compl'].strip()
    cnpj = digits(r['cnpj'])
    sources.append(dict(
        origem='Formulario',
        razao=r['razao'], fantasia=r['fantasia'],
        cnpj=cnpj if len(cnpj) == 14 else '',
        inscricao_estadual=(r['ie'].strip() if len(digits(r['ie'])) >= 8 else ''),
        email_comercial=r['email'].strip(),
        endereco=endereco,
        cep=(cep if len(cep) == 8 else ''),
        _ph=phones(r['tel']) | phones(r['wpp']),
        _uf=(r['uf'] or '').strip().upper(),
        _cidades=set(norm_txt(c) for c in re.split(r'[,/;]', r['cidades']) if norm_txt(c)),
        _names=[r['razao'], r['fantasia']],
    ))

# 2) leads manual + gestao (tem CNPJ)
def add_tab(df, m):
    for _, r in df.fillna('').astype(str).iterrows():
        doc = digits(r.get(m['cnpj'], ''))
        sources.append(dict(
            origem=m['origem'],
            razao=str(r.get(m.get('razao',''), '')).strip(),
            fantasia=str(r.get(m.get('fantasia',''), '')).strip(),
            cnpj=doc if len(doc) == 14 else '',
            inscricao_estadual='',
            email_comercial=str(r.get(m.get('email',''), '')).strip(),
            endereco=str(r.get(m.get('end',''), '')).strip(),
            cep=(lambda c: c if len(c)==8 else '')(digits(r.get(m.get('cep',''), ''))),
            _ph=phones(' '.join(str(r.get(c,'')) for c in m['phones'])),
            _uf=str(r.get(m.get('uf',''), '')).strip().upper(),
            _cidades=set([norm_txt(r.get(m.get('cidade',''), ''))]) - {''},
            _names=[str(r.get(m.get('razao',''),'')), str(r.get(m.get('fantasia',''),''))],
        ))

lm = pd.read_csv('leads-prospeccao-starlink-manual.csv', dtype=str)
add_tab(lm, dict(origem='LeadsManual', razao='Razão social', fantasia='Nome fantasia',
                 cnpj='CNPJ', email='E-mail comercial', end='Endereço', cep='CEP',
                 uf='UF', cidade='Cidade', phones=['Telefone comercial','WhatsApp']))

ge = pd.read_excel('Gestao_Prospeccao_Revendas_Starlink.xlsx', sheet_name='Revendas', dtype=str)
add_tab(ge, dict(origem='Gestao', razao='Nome da revenda', fantasia='Nome da revenda',
                 cnpj='CNPJ/CPF', email='E-mail', uf='UF', cidade='Município',
                 phones=['Telefone']))

# ---------- matching ----------
ENRICH = ['cnpj','inscricao_estadual','email_comercial','endereco','cep']
def is_blank(v): return v is None or str(v).strip() == ''

def cnpj_root_in_name(cnpj, *names):
    if len(cnpj) != 14: return False
    root = cnpj[:8]
    for n in names:
        if root and root in digits(n): return True
    return False

confiante, revisar = [], []
for emp in prod:
    cands = []
    for s in sources:
        if not s['_ph'] and not s['_names']: continue
        uf_ok = (emp['_uf'] == s['_uf']) and bool(emp['_uf'])
        ph_ok = bool(emp['_ph'] & s['_ph'])
        nm_ok = False; nm_exact = False; best = 0.0
        for nm in s['_names']:
            for enm in [emp.get('nome_fantasia'), emp.get('razao_social')]:
                ok, sc = name_match(nm, enm)
                if ok: nm_ok = True
                if norm_name(nm) and norm_name(nm) == norm_name(enm): nm_exact = True
                best = max(best, sc)
        city_ok = emp['_cid'] in s['_cidades'] and bool(emp['_cid'])
        root_ok = cnpj_root_in_name(s['cnpj'], emp.get('nome_fantasia'), emp.get('razao_social'))
        # elegivel para entrar na analise: alguma evidencia forte com UF batendo
        elegivel = uf_ok and (
            (ph_ok and (nm_ok or city_ok)) or (nm_exact and city_ok) or root_ok)
        if not elegivel:
            continue
        # "CERTEZA": tel+nome, OU nome exato+cidade, OU raiz do CNPJ no nome da ficha
        # raiz do CNPJ embutida no nome da ficha (+UF) ja e identidade definitiva
        certo = (ph_ok and nm_ok) or (nm_exact and city_ok) or root_ok
        cands.append((s, dict(uf=uf_ok, phone=ph_ok, name=nm_ok, name_exact=nm_exact,
                              city=city_ok, root=root_ok, sim=round(best,2), certo=certo)))
    if not cands:
        continue
    cnpjs = set(s['cnpj'] for s, _ in cands if s['cnpj'])
    def score(ev): return (ev['certo']*10 + ev['phone'] + ev['name_exact'] + ev['name'] + ev['city'] + ev['root'])
    s, ev = max(cands, key=lambda c: score(c[1]))
    fill = {f: s[f] for f in ENRICH if is_blank(emp.get(f)) and not is_blank(s.get(f))}
    rec = dict(emp=emp, src=s, ev=ev, fill=fill, n_cands=len(cands),
               ambiguo=(len(cnpjs) > 1))
    if not fill:
        continue
    if ev['certo'] and not rec['ambiguo']:
        confiante.append(rec)
    else:
        revisar.append(rec)

from collections import Counter
cnt = Counter()
for m in confiante:
    for f in m['fill']: cnt[f] += 1
print('CONFIANTES (serao aplicados):', len(confiante))
print('  campos:', dict(cnt))
print('REVISAR manualmente (NAO aplicados):', len(revisar))

def to_rows(lst):
    rows = []
    for m in lst:
        e, s, ev = m['emp'], m['src'], m['ev']
        rows.append(dict(
            id=e['id'], codigo=e['codigo'],
            ficha_nome=(e['nome_fantasia'] or e['razao_social']),
            ficha_cidade=e['cidade'], ficha_uf=e['uf'],
            ficha_tel=e['telefone_comercial'], ficha_wpp=e['whatsapp'],
            fonte=s['origem'], fonte_nome=(s['fantasia'] or s['razao']),
            ev_tel=ev['phone'], ev_nome=ev['name'], ev_nome_exato=ev['name_exact'],
            ev_cidade=ev['city'], ev_cnpj_raiz=ev['root'], ev_sim=ev['sim'],
            ambiguo=m['ambiguo'], n_cands=m['n_cands'],
            **{('novo_' + k): v for k, v in m['fill'].items()}))
    return pd.DataFrame(rows)

to_rows(confiante).to_csv('_enriquecimento_confiante.csv', index=False, encoding='utf-8-sig')
to_rows(revisar).to_csv('_enriquecimento_revisar.csv', index=False, encoding='utf-8-sig')
json.dump([{'id': m['emp']['id'], 'fill': m['fill']} for m in confiante],
          open('_enriquecimento.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('relatorios: _enriquecimento_confiante.csv / _enriquecimento_revisar.csv')
