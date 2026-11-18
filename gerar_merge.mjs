import fs from "node:fs";

// Pares padrao: [keep (ficha VSM Vivensis), drop (copia Formulario)].
// Exclui G TECH (691/218, tem contato) e STARNET XINGU LTDA (578/340, familia de 3 fichas).
const PARES = [
  [215,337],[607,177],[223,243],[781,316],[686,193],[583,183],[656,170],[705,190],
  [633,129],[499,274],[715,247],[554,98],[43,278],[785,150],[832,241],[585,234],
  [557,86],[676,283],[755,349],[612,209],[602,212],[703,70],[614,174],[806,214],
  [580,272],[681,375],[815,372],[500,306],[712,347],[728,143],[639,268],[759,235],
  [175,309],[38,327],[616,186],[34,195],[929,293],[176,368],[318,227],[572,120],
  [451,370],[618,319],[666,68],[649,303],[653,130],[108,344],[53,296],[631,126],
  [804,232],[77,54],[939,163],[887,300],[182,331],[351,265],[951,188],[507,201],
];

const NAO_SOBRESCREVER = new Set(["id", "criado_em", "atualizado_em"]);

const raw = JSON.parse(fs.readFileSync("backup_empresas_dup.json", "utf8"));
const rows = raw[0].results;
const byId = new Map(rows.map(r => [r.id, r]));

const fmt = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});
const agora = fmt.format(new Date()).replace("T", " ");

const vazio = v => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
const sql = v => typeof v === "number" ? String(v) : "'" + String(v).replace(/'/g, "''") + "'";

const linhas = [];
const resumoFill = [];
let totalPreenchidos = 0;

for (const [keep, drop] of PARES) {
  const m = byId.get(keep), c = byId.get(drop);
  if (!m || !c) { console.error(`FALTA DADO: keep=${keep} drop=${drop}`); process.exit(1); }
  const sets = [];
  const campos = [];
  for (const col of Object.keys(m)) {
    if (NAO_SOBRESCREVER.has(col)) continue;
    if (vazio(m[col]) && !vazio(c[col])) {
      sets.push(`"${col}"=${sql(c[col])}`);
      campos.push(col);
    }
  }
  if (sets.length) {
    sets.push(`"atualizado_em"='${agora}'`);
    linhas.push(`UPDATE empresas SET ${sets.join(", ")} WHERE id=${keep};`);
    totalPreenchidos += campos.length;
    resumoFill.push(`  #${keep} <- #${drop} (${m.razao_social}): ${campos.join(", ")}`);
  }
  linhas.push(`DELETE FROM empresas WHERE id=${drop};`);
}

fs.writeFileSync("merge.sql",
  "-- Consolidacao dos 56 pares padrao (VSM Vivensis mantem; Formulario preenche vazios e e removido)\n" +
  "-- Gerado em " + agora + " (horario de Brasilia)\n" +
  linhas.join("\n") + "\n");

console.log(`Pares processados: ${PARES.length}`);
console.log(`Campos preenchidos na mestre (total): ${totalPreenchidos}`);
console.log(`Statements gerados: ${linhas.length}`);
console.log("\nCampos preenchidos por ficha:");
console.log(resumoFill.length ? resumoFill.join("\n") : "  (nenhum campo precisou ser preenchido)");
