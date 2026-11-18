import fs from "node:fs";

// G TECH: manter 691 (VSM, id_vsm 4561, "Em atendimento"); mover contato da 218; apagar 218.
const KEEP = 691, DROP = 218;
const NAO_SOBRESCREVER = new Set(["id", "criado_em", "atualizado_em"]);

const raw = JSON.parse(fs.readFileSync("backup_gtech.json", "utf8"));
const rows = raw[0].results;
const byId = new Map(rows.map(r => [r.id, r]));
const m = byId.get(KEEP), c = byId.get(DROP);

const fmt = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});
const agora = fmt.format(new Date()).replace("T", " ");
const vazio = v => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
const sql = v => typeof v === "number" ? String(v) : "'" + String(v).replace(/'/g, "''") + "'";

const sets = [], campos = [];
for (const col of Object.keys(m)) {
  if (NAO_SOBRESCREVER.has(col)) continue;
  if (vazio(m[col]) && !vazio(c[col])) { sets.push(`"${col}"=${sql(c[col])}`); campos.push(col); }
}
sets.push(`"atualizado_em"='${agora}'`);

const linhas = [
  "-- G TECH: move contato 218->691, preenche vazios na 691, remove 218",
  `UPDATE contatos SET empresa_id=${KEEP} WHERE empresa_id=${DROP};`,
  `UPDATE empresas SET ${sets.join(", ")} WHERE id=${KEEP};`,
  `DELETE FROM empresas WHERE id=${DROP};`,
];
fs.writeFileSync("merge_gtech.sql", linhas.join("\n") + "\n");
console.log("Campos preenchidos na 691:", campos.join(", "));
console.log("\nSQL:\n" + linhas.join("\n"));
