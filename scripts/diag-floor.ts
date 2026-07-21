import { loadRichTree } from "../src/data/loadTaxonomy";
import { gridBoardFor } from "../src/data/gridDaily";
import { mrca, separationTierOf } from "../src/core/tree";
const tree = await loadRichTree();
const views=(id)=>tree.byId.get(id)?.views??0;
const med=(xs)=>{const s=[...xs].sort((a,b)=>a-b);const m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2;};
const CUTS=[15000,10000,7500,6000,5000,4000];
const fameTier=(f)=>{for(let i=0;i<CUTS.length;i++)if(f>=CUTS[i])return i+1;return 7;};
const BAND=[[1,4],[3,6],[4,7]]; const WD=[0,0,0,0,1,1,2,2];
const shift=(d,n)=>{const t=new Date(d+"T00:00:00Z");t.setUTCDate(t.getUTCDate()+n);return t.toISOString().slice(0,10);};
const start="2026-07-22"; const days=Number(process.argv[2]??180);
const perTier=new Map();
for(let i=0;i<days;i++){
  const d=shift(start,i); const b=gridBoardFor(tree,d); const ids=b.groups.map(g=>g.cladeId);
  const seps=[]; for(let x=0;x<ids.length;x++)for(let y=x+1;y<ids.length;y++)seps.push(separationTierOf(tree,mrca(tree,ids[x],ids[y])));
  seps.sort((a,c)=>a-c); const medSep=Math.round((seps[2]+seps[3])/2);
  const bf=med(b.groups.map(g=>med([...g.memberIds].sort((a,c)=>views(c)-views(a)).slice(0,4).map(views))));
  const diff=Math.max(medSep,fameTier(bf));
  const wd=((new Date(d+"T00:00:00Z").getUTCDay()+6)%7)+1; const lo=BAND[WD[wd]][0];
  const e=perTier.get(wd)??{n:0,floor:0,dist:new Map()}; e.n++; if(diff===lo)e.floor++; e.dist.set(diff,(e.dist.get(diff)??0)+1); perTier.set(wd,e);
}
const dayName=["","Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
for(const wd of [1,2,3,4,5,6,7]){const e=perTier.get(wd);const lo=BAND[WD[wd]][0];
  console.log(`${dayName[wd]} (tier ${wd}, band floor ${lo}): at floor ${e.floor}/${e.n} = ${(100*e.floor/e.n).toFixed(0)}%  | diff dist ${[...e.dist.entries()].sort((a,b)=>a[0]-b[0]).map(([k,v])=>`${k}:${v}`).join(" ")}`);
}
