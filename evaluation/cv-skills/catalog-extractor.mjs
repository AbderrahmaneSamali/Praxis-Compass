function normalize(text,expanded){return text.normalize(expanded?'NFKC':'NFC').toLocaleLowerCase('fr');}
const isWord=char=>char!==undefined && /[\p{L}\p{N}_]/u.test(char);

/** Reproducible dictionary baselines. Probabilities and learner mastery are not inferred. */
export function extractCatalogSkills(record,catalog,{expanded=false}={}){
 const original=Array.from(record.text),characters=[],offsets=[];
 original.forEach((char,index)=>{for(const normalized of Array.from(normalize(char,expanded))){characters.push(normalized);offsets.push(index);}});
 const text=characters.join(''),matches=new Map();
 for(const concept of catalog.concepts.filter(c=>c.type==='skill')){
  const labels=expanded?[...Object.values(concept.labels),...Object.values(concept.alternatives).flat()]:[concept.labels[record.language==='mixed'?'fr':record.language]];
  const preferred=new Set(Object.values(concept.labels).map(label=>normalize(label,expanded)));
  for(const alias of new Set(labels.filter(Boolean).map(label=>normalize(label,expanded)))){
   if(alias.length<2)continue;let position=0;
   while((position=text.indexOf(alias,position))!==-1){
    const start=Array.from(text.slice(0,position)).length,end=start+Array.from(alias).length;position+=alias.length;
    if(isWord(characters[start-1]) || isWord(characters[end]))continue;
    const originalStart=offsets[start],originalEnd=offsets[end-1]+1,key=`${originalStart}:${originalEnd}`;
    const match=matches.get(key)??{start:originalStart,end:originalEnd,candidates:new Map()};
    match.candidates.set(concept.uri,Math.max(match.candidates.get(concept.uri)??0,preferred.has(alias)?2:1));matches.set(key,match);
   }
  }
 }
 const accepted=[];
 for(const match of [...matches.values()].sort((a,b)=>(b.end-b.start)-(a.end-a.start) || a.start-b.start)){
  if(accepted.some(other=>match.start<other.end && match.end>other.start))continue;
  const candidates=[...match.candidates].sort(([idA,scoreA],[idB,scoreB])=>scoreB-scoreA || idA.localeCompare(idB)).map(([id])=>id).slice(0,10);
  accepted.push({start:match.start,end:match.end,skillId:candidates[0],candidates});
 }
 return {documentId:record.documentId,spans:accepted.sort((a,b)=>a.start-b.start)};
}
