import fs from "node:fs";

// STARNET: manter 578 (VSM, id_vsm 3544). Preencher vazios com [340 Form, depois 15 Altamira].
// Mover contato (WhatsApp) da 15 -> 578. Apagar 340 e 15.
const KEEP = 578;
const COPIAS = [340, 15]; // ordem de prioridade p/ preencher campos vazios da mestre
const NAO_SOBRESCREVER = new Set(["id", "criado_em", "atualizado_em"]);

const raw = JSON.parse(fs.readFileSync("backup_starnet.json", "utf8"));
const rows = raw[0].results;
const byId = new Map(rows.map(r => [r.id, r]));
const m = byId.get(KEEP);

const fmt = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});
const agora = fmt.format(new Date()).replace("T", " ");
const vazio = v => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
const sql = v => typeof v === "number" ? String(v) : "'" + String(v).replace(/'/g, "''") + "'";

const sets = [], detalhe = [];
for (const col of Object.keys(m)) {
  if (NAO_SOBRESCREVER.has(col)) continue;
  if (!vazio(m[col])) continue;
  for (const cid of COPIAS) {
    const c = byId.get(cid);
    if (c && !vazio(c[col])) { sets.push(`"${col}"=${sql(c[col])}`); detalhe.push(`${col} <- #${cid}`); break; }
  }
}
sets.push(`"atualizado_em"='${agora}'`);

const linhas = [
  "-- STARNET: consolida 340 e 15 na 578; move contato WhatsApp (15->578); apaga copias",
  `UPDATE contatos SET empresa_id=${KEEP} WHERE empresa_id IN (${COPIAS.join(",")});`,
  `UPDATE empresas SET ${sets.join(", ")} WHERE id=${KEEP};`,
  `DELETE FROM empresas WHERE id IN (${COPIAS.join(",")});`,
];
fs.writeFileSync("merge_starnet.sql", linhas.join("\n") + "\n");
console.log("Campos preenchidos na 578:\n  " + (detalhe.join("\n  ") || "(nenhum)"));
console.log("\nSQL:\n" + linhas.join("\n"));
