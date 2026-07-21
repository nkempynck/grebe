import { loadRichTree } from "../src/data/loadTaxonomy";
import { gridBoardFor } from "../src/data/gridDaily";
import { mrca, separationTierOf } from "../src/core/tree";
const tree = await loadRichTree();
const nm = (id:string)=>tree.byId.get(id)?.common ?? tree.byId.get(id)?.sciName ?? id;
const rank = (id:string)=>tree.byId.get(id)?.rank ?? "?";
const date = process.argv[2] ?? "2026-07-31";
const tier = Number(process.argv[3] ?? 5);
const b = gridBoardFor(tree, date)!;  // real daily (weekday tier)
const ids = b.groups.map(g=>g.cladeId);
console.log(`${date}  tier ${b.tier}`);
for (const g of b.groups) console.log(`  [${rank(g.cladeId)}] ${nm(g.cladeId)}`);
const pairs:{a:string,c:string,mr:string,sep:number}[]=[];
for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++){const m=mrca(tree,ids[i],ids[j]);pairs.push({a:nm(ids[i]),c:nm(ids[j]),mr:`${rank(m)} ${nm(m)}`,sep:separationTierOf(tree,m)});}
console.log("pairwise separation (1 far/easy .. 7 tight/hard):");
for(const p of pairs) console.log(`  ${p.a} × ${p.c}  ->  MRCA ${p.mr}  sep=${p.sep}`);
const seps=pairs.map(p=>p.sep).sort((a,b)=>a-b);
const medSep=Math.round((seps[2]+seps[3])/2);
console.log(`median pairwise separation = ${medSep}`);
// fame tier
const views=(id:string)=>tree.byId.get(id)?.views??0;
const med=(xs:number[])=>{const s=[...xs].sort((a,b)=>a-b);const m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2;};
const groupFame=b.groups.map(g=>med([...g.memberIds].sort((a,c)=>views(c)-views(a)).slice(0,4).map(views)));
const boardFame=med(groupFame);
const CUTS=[15000,10000,7500,6000,5000,4000]; let fameTier=7; for(let i=0;i<CUTS.length;i++)if(boardFame>=CUTS[i]){fameTier=i+1;break;}
console.log(`board fame (median group fame) = ${boardFame}  -> fameTier ${fameTier}`);
console.log(`boardDiffTier = max(medSep ${medSep}, fameTier ${fameTier}) = ${Math.max(medSep,fameTier)}`);
const BAND=[[1,4],[3,6],[4,7]]; const WD=[0,0,0,0,1,1,2,2];
const wd=((new Date(date+"T00:00:00Z").getUTCDay()+6)%7)+1;
const [lo,hi]=BAND[WD[wd]];
console.log(`weekday tier ${wd}, band window [${lo},${hi}]  -> ${Math.max(medSep,fameTier)>=lo&&Math.max(medSep,fameTier)<=hi?"ON-band":"OFF-band"}`);
