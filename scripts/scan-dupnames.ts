import { loadRichTree } from "../src/data/loadTaxonomy";
const tree = await loadRichTree();
const byCommon = new Map<string, {id:string;sci:string;rank:string;parent:string}[]>();
for (const n of tree.byId.values()) {
  if (n.rank !== "species" || !n.common) continue;
  (byCommon.get(n.common) ?? byCommon.set(n.common, []).get(n.common)!).push({id:n.id, sci:n.sciName ?? "?", rank:n.rank, parent:n.parentId ?? ""});
}
const genus = (sci:string) => sci.split(" ")[0];
const collisions = [...byCommon.entries()].filter(([,v]) => v.length > 1);
let sameGenus = 0, diffGenus = 0;
const sameGenusList:string[] = [], diffGenusList:string[] = [];
for (const [name, v] of collisions) {
  const genera = new Set(v.map(x => genus(x.sci)));
  const line = `${name}: ${v.map(x=>x.sci).join(" / ")}`;
  if (genera.size === 1) { sameGenus++; sameGenusList.push(line); }   // likely true synonym-dup or infraspecies
  else { diffGenus++; diffGenusList.push(line); }                      // distinct taxa sharing a generic name
}
console.log(`species-rank nodes: ${[...tree.byId.values()].filter(n=>n.rank==="species"&&n.common).length}`);
console.log(`distinct common names colliding: ${collisions.length}  (species involved: ${collisions.reduce((a,[,v])=>a+v.length,0)})`);
console.log(`\n== SAME-GENUS collisions (${sameGenus}) — likely TRUE duplicates / synonym pairs ==`);
sameGenusList.slice(0,40).forEach(l=>console.log("  "+l));
console.log(`\n== DIFFERENT-GENUS collisions (${diffGenus}) — distinct taxa sharing an English name ==`);
diffGenusList.slice(0,40).forEach(l=>console.log("  "+l));
