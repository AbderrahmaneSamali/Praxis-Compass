const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const options=(items,value,empty)=>`${empty?`<option value="">${esc(empty)}</option>`:''}${items.map(x=>`<option value="${esc(x.code??x.framework.id)}" ${(x.code??x.framework.id)===value?'selected':''}>${esc(x.label??x.framework.title)}</option>`).join('')}`;

/** Only renders the reviewed, occupation-scoped projection returned by the server. */
export function createCareerLevels(host,{get,post,notify}){
 let revision=0,data=null,frameworkId=null,targetCode=null,currentCode=null,busy=false;
 const bundle=()=>data?.frameworks.find(x=>x.framework.id===frameworkId);
 const trackLabel=code=>data.catalog.tracks.find(x=>x.code===code)?.label??code;
 const sourceLabel=(b,id)=>b.sources.find(x=>x.id===id)?.title??id;
 function chooseFramework(){
  const b=bundle(),goal=data.goal?.frameworkId===frameworkId?data.goal:null;
  targetCode=goal?.targetLevelCode??b.levels[0]?.code;currentCode=goal?.currentLevelCode??null;
 }
 function graph(b){
  const tracks=data.catalog.tracks.filter(t=>b.allLevels.some(l=>l.trackCode===t.code)),positions=new Map();
  let rowCount=1;
  for(const [col,track] of tracks.entries()){
   const levels=b.allLevels.filter(l=>l.trackCode===track.code);rowCount=Math.max(rowCount,levels.length);
   levels.forEach((level,row)=>positions.set(level.code,{x:20+col*320,y:54+row*120,level}));
  }
  const height=62+rowCount*120,width=tracks.length*320+20;
  const edges=b.transitions.map(edge=>{const a=positions.get(edge.fromCode),z=positions.get(edge.toCode);if(!a||!z)return '';
   const same=a.x===z.x,ax=same?a.x+140:a.x+280,ay=same?a.y+84:a.y+42,bx=same?z.x+140:z.x,by=same?z.y:z.y+42;
   return `<path d="M${ax},${ay} C${same?ax:ax+32},${same?ay+18:ay} ${same?bx:bx-32},${same?by-18:by} ${bx},${by}" class="level-edge ${edge.kind==='track_change'?'track-change':''}" marker-end="url(#level-arrow)"><title>${esc(edge.rationale)} · ${esc(sourceLabel(b,edge.sourceId))}</title></path>`;
  }).join('');
  const nodes=[...positions.values()].map(({x,y,level})=>{
   const words=level.label.split(' '),lines=[''];for(const word of words){if((lines.at(-1)+' '+word).trim().length>30)lines.push(word);else lines[lines.length-1]=(lines.at(-1)+' '+word).trim();}
   const selectable=b.levels.some(l=>l.code===level.code);
   return `<g transform="translate(${x},${y})" class="level-node ${level.code===targetCode?'target':''} ${level.code===currentCode?'current':''}" ${selectable?`role="button" tabindex="0" data-level="${esc(level.code)}" aria-label="Voir ${esc(level.label)}" aria-pressed="${level.code===targetCode}"`:''}><rect width="280" height="84" rx="10"/><text x="14" y="24">${lines.slice(0,3).map((line,i)=>`<tspan x="14" dy="${i?19:0}">${esc(line)}</tspan>`).join('')}</text><title>${esc(level.label)} · ${esc(level.autonomy)}</title></g>`;
  }).join('');
  return `<div class="level-map-scroll"><svg class="level-map" viewBox="0 0 ${width} ${height}" role="group" aria-label="Parcours de progression : ${esc(b.framework.title)}"><defs><marker id="level-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="currentColor"/></marker></defs>${tracks.map((t,i)=>`<text class="level-track" x="${20+i*320}" y="26">${esc(t.label)}</text>`).join('')}${edges}${nodes}</svg></div>`;
 }
 function render(){
  if(!data)return;
  const b=bundle();host.innerHTML=`<p class="eyebrow">VOTRE ÉVOLUTION PROFESSIONNELLE</p><h3>Niveaux et responsabilités</h3><p>${esc(data.message)}</p>`;
  if(!b){host.insertAdjacentHTML('beforeend',`<p class="source-note">${esc(data.catalog.markets.find(x=>x.code===data.preference.marketCode)?.label??'Pays à préciser')} · ${esc(data.preference.trackCode?trackLabel(data.preference.trackCode):'Tous les parcours')}</p>${data.previousGoalUnavailable?'<p>Votre ancien objectif est conservé, mais il n’est plus disponible avec ces choix.</p>':''}<button type="button" class="button secondary small" data-view="profile">Choisir mon pays et mon parcours</button>`);return;}
  const level=b.levels.find(x=>x.code===targetCode),requirements=b.requirements.filter(x=>x.levelCode===targetCode);
  host.insertAdjacentHTML('beforeend',`<p class="source-note">${esc(data.catalog.markets.find(x=>x.code===b.framework.marketCode)?.label)} · version ${b.framework.version} · contenu revu</p><label for="level-framework">Référentiel</label><select id="level-framework">${options(data.frameworks,frameworkId)}</select>${graph(b)}<p class="source-note">Les flèches correspondent aux transitions documentées. Elles ne garantissent pas une promotion. Le tableau ci-dessous reprend les mêmes liens.</p><details><summary>Consulter les transitions en tableau</summary><div class="level-table-wrap"><table><thead><tr><th>Départ</th><th>Objectif</th><th>Conditions et source</th></tr></thead><tbody>${b.transitions.map(t=>`<tr><td>${esc(b.allLevels.find(l=>l.code===t.fromCode)?.label)}</td><td>${esc(b.allLevels.find(l=>l.code===t.toCode)?.label)}</td><td>${esc(t.rationale)} · ${esc(sourceLabel(b,t.sourceId))}</td></tr>`).join('')||'<tr><td colspan="3">Aucune transition documentée pour ce métier.</td></tr>'}</tbody></table></div></details><form id="level-goal-form"><div class="form-grid"><div><label for="current-career-level">Mon niveau actuel déclaré (facultatif)</label><select id="current-career-level">${options(b.allLevels,currentCode,'Je ne sais pas encore')}</select></div><div><label for="target-career-level">Niveau que je souhaite explorer</label><select id="target-career-level">${options(b.levels,targetCode)}</select></div></div><p class="source-note">Un niveau déclaré ne prouve pas votre maîtrise. Votre préparation à ce niveau n’a pas encore été évaluée.</p><div class="card-actions"><button class="button primary small" type="submit" ${busy?'disabled':''}>Enregistrer cet objectif</button>${data.goal?`<button class="button secondary small" type="button" data-clear-level ${busy?'disabled':''}>Retirer l’objectif enregistré</button>`:''}</div></form>${data.goal?`<p class="level-saved" role="status">Objectif enregistré : ${esc(data.frameworks.find(f=>f.framework.id===data.goal.frameworkId)?.levels.find(l=>l.code===data.goal.targetLevelCode)?.label)}</p>`:''}<div class="level-expectations"><h4>${esc(level.label)}</h4><p>${esc(trackLabel(level.trackCode))} · ${level.managesPeople?'Responsabilité hiérarchique explicite':'Encadrement hiérarchique non requis par ce niveau'}</p><dl><dt>Autonomie</dt><dd>${esc(level.autonomy)}</dd><dt>Périmètre</dt><dd>${esc(level.scope)}</dd><dt>Influence</dt><dd>${esc(level.influence)}</dd></dl><h4>Ce qu’il faut démontrer</h4><ul class="level-requirements">${requirements.map(r=>`<li><strong>${esc(r.label)}</strong><p>${esc(r.expectedBehavior)}</p><ul>${b.criteria.filter(c=>c.requirementId===r.id).map(c=>`<li>${esc(c.label)}</li>`).join('')}</ul><small>Évaluation non réalisée · ${esc(sourceLabel(b,r.sourceId))}</small></li>`).join('')}</ul></div><details class="source-details"><summary>Périmètre, sources et limites</summary><p>${esc(b.framework.scope)}</p><p>${esc(b.framework.limitations)}</p><ul>${b.sources.map(s=>`<li>${s.url&&s.url.startsWith('https://')?`<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a>`:esc(s.title)} · ${esc(s.publisher)}<p>${esc(s.locator)} · ${esc(s.limitations)}</p></li>`).join('')}</ul></details>`);
 }
 host.addEventListener('change',event=>{
  if(busy){render();return;}
  if(event.target.id==='level-framework'){frameworkId=event.target.value;chooseFramework();render();}
  if(event.target.id==='target-career-level'){targetCode=event.target.value;render();host.querySelector('#target-career-level')?.focus();}
  if(event.target.id==='current-career-level'){currentCode=event.target.value||null;render();host.querySelector('#current-career-level')?.focus();}
 });
 const selectNode=event=>{const node=event.target.closest('[data-level]');if(!node||busy)return;targetCode=node.dataset.level;render();host.querySelector(`[data-level="${CSS.escape(targetCode)}"]`)?.focus();};
 host.addEventListener('click',event=>{selectNode(event);if(event.target.closest('[data-clear-level]'))save(true);});
 host.addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&event.target.matches('[data-level]')){event.preventDefault();selectNode(event);}});
 host.addEventListener('submit',event=>{if(event.target.id==='level-goal-form'){event.preventDefault();save(false);}});
 async function save(clear){
  if(busy||!data)return;busy=true;const version=revision,codeRome=data.codeRome,b=bundle();render();
  try{const response=await post(clear?'/api/career/goal/clear':'/api/career/goal',clear?{codeRome}:{codeRome,frameworkId,trackCode:b.levels.find(x=>x.code===targetCode).trackCode,targetLevelCode:targetCode,currentLevelCode:currentCode});
   if(version===revision){data=response;notify(clear?'Objectif retiré.':'Objectif de progression enregistré.');}
  }catch(error){if(version===revision)notify(error.message);}finally{busy=false;if(version===revision)render();}
 }
 return {async load(codeRome){
  const version=++revision;data=null;host.hidden=!codeRome;if(!codeRome)return;
  host.innerHTML='<p role="status">Chargement des parcours de progression…</p>';
  try{const response=await get('/api/career/levels?codeRome='+encodeURIComponent(codeRome));if(version!==revision)return;data=response;frameworkId=data.goal?.frameworkId??data.frameworks[0]?.framework.id;if(frameworkId)chooseFramework();render();}
  catch(error){if(version===revision)host.innerHTML=`<h3>Niveaux et responsabilités</h3><p role="alert">${esc(error.message)}</p>`;}
 }};
}
