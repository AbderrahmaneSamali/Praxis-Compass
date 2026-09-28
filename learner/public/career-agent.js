const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const terminal=status=>['completed','failed','cancelled'].includes(status);
const statusLabel={queued:'En attente',running:'Analyse en cours',completed:'Analyse terminée',failed:'Analyse interrompue',cancelled:'Analyse annulée'};
const eventLabel={queued:'Dossier accepté',started:'Analyse démarrée',model_call:'Appel au modèle',tool_call:'Lecture du dossier',completed:'Proposition validée',failed:'Analyse arrêtée',cancelled:'Analyse annulée'};
const sourceLabel=ref=>ref.startsWith('rome:')||ref.includes('francetravail.fr/')?'Fiche métier France Travail':ref.startsWith('database/')?'Cas pédagogique PRAXIS (pilote)':ref;

export function createCareerAgent(host,{get,post,notify,openFocus=()=>{}}){
 let reports=[],history={runs:[],available:false,model:'',limits:null},selectedId=null,current=null,working=false,timer=null,revision=0;
 function stopPoll(){if(timer){clearTimeout(timer);timer=null;}}
 function render(){
  const selected=reports.find(r=>r.id===selectedId),run=current?.run;
  host.innerHTML=`<section class="panel agent-panel"><p class="eyebrow">ASSISTANCE BORNÉE</p><h3>Une lecture guidée de votre dossier</h3><p>L’assistant consulte seulement les faits enregistrés dans le rapport. Il propose un ordre de lecture et un prochain jalon disponible pour chaque cible. Les faits et les sources restent ceux du dossier.</p>
   ${!history.available?'<p class="agent-unavailable">Assistance IA non configurée sur ce serveur. Vos rapports restent disponibles sans elle.</p>':!reports.length?'<p>Créez d’abord un rapport pour lancer cette analyse.</p>':`<label for="agent-report">Rapport à analyser</label><select id="agent-report">${reports.map(r=>`<option value="${esc(r.id)}" ${r.id===selectedId?'selected':''}>${esc(r.targets.join(' ; ')||r.id)} · ${esc(r.domain??'Exploration')}</option>`).join('')}</select><div class="agent-controls"><button class="button primary" type="button" data-agent-start ${working||!selected||run&&!terminal(run.status)?'disabled':''}>Lancer l’analyse IA</button>${run&&!terminal(run.status)?`<button class="button secondary" type="button" data-agent-cancel="${esc(run.id)}">Annuler l’analyse</button>`:''}</div><p class="source-note">Modèle ${esc(history.model)} · Au plus ${history.limits?.modelCalls??4} appels au modèle et ${history.limits?.toolCalls??3} lectures du rapport · arrêt automatique à 60 secondes.</p>`}
   ${run?`<div class="agent-run" role="status"><h4>${esc(statusLabel[run.status]??run.status)}</h4><p>${run.modelCalls} ${run.modelCalls===1?'appel':'appels'} au modèle · ${run.toolCalls} ${run.toolCalls===1?'lecture':'lectures'} du dossier.</p>${run.status==='failed'?`<p>Le fournisseur ou la validation a interrompu cette analyse (${esc(run.errorCode??'erreur')}). Le rapport enregistré reste accessible.</p>`:''}${run.status==='cancelled'?'<p>Aucune proposition n’a été conservée pour cette analyse.</p>':''}
   ${run.status==='completed'&&run.result?`<p class="source-note">${esc(run.result.notice)}</p><ol>${run.result.targets.map(t=>`<li><strong>${esc(t.title)}</strong><p>${t.summary.requirements} exigences, dont ${t.summary.unknown} à clarifier et ${t.summary.developmentNeeded} à développer selon déclaration. ${t.summary.exercisesCompleted}/${t.summary.exercises} exercices réussis sur leur cas.</p>${t.focus?`<p><b>Prochain jalon :</b> ${esc(t.focus.label)} — ${esc(t.focus.explanation)}</p><button class="button secondary small" type="button" data-agent-focus="${esc(t.code)}">Ouvrir ce jalon →</button><p class="source-note">${t.focus.sourceReferences.map(sourceLabel).map(esc).join(' · ')||'Source du dossier enregistré'}</p>`:'<p>Aucun jalon disponible dans ce dossier.</p>'}</li>`).join('')}</ol>`:''}
   <details><summary>Voir la trace de cette analyse</summary><ul>${(current?.events??[]).map(e=>`<li>${esc(eventLabel[e.kind]??e.kind)}${e.detail?.name?` : ${esc(e.detail.name)}`:''}</li>`).join('')}</ul></details></div>`:''}
   ${history.runs.length?`<div class="agent-history"><h4>Analyses précédentes</h4>${history.runs.slice(0,5).map(r=>`<button class="button secondary small" type="button" data-agent-read="${esc(r.id)}">${esc(statusLabel[r.status]??r.status)} · ${esc(new Date(r.createdAt).toLocaleString('fr-FR',{timeZone:'Africa/Casablanca'}))}</button>`).join('')}</div>`:''}</section>`;
 }
 async function poll(id,version){
  stopPoll();try{const response=await get('/api/agent-runs/'+id);if(version!==revision)return;current=response;history.runs=history.runs.map(r=>r.id===id?response.run:r);render();if(!terminal(response.run.status))timer=setTimeout(()=>poll(id,version),1500);
  }catch(error){if(version===revision)notify(error.message);}
 }
 async function load(preferredId=null){const version=++revision;stopPoll();try{
  const [reportPage,agentPage]=await Promise.all([get('/api/reports/history'),get('/api/agent-runs/history')]);if(version!==revision)return;
  reports=reportPage.reports;history=agentPage;
  if(preferredId&&!reports.some(r=>r.id===preferredId)){const record=await get('/api/reports/'+preferredId);if(version!==revision)return;reports=[{id:record.id,targets:record.snapshot.targets.map(t=>t.plan.target.title),domain:record.snapshot.profile.domainLabel},...reports];}
  selectedId=preferredId??(reports.some(r=>r.id===selectedId)?selectedId:reports[0]?.id??null);
  const active=history.runs.find(r=>!terminal(r.status));
  if(active){selectedId=active.reportId;await poll(active.id,version);}else render();
 }catch(error){if(version===revision){render();notify(error.message);}}}
 host.addEventListener('change',e=>{if(e.target.id==='agent-report'){selectedId=e.target.value;render();}});
 host.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b||working)return;
  if(b.dataset.agentFocus){const target=current?.run?.result?.targets.find(t=>t.code===b.dataset.agentFocus);if(target?.focus)Promise.resolve(openFocus(target)).catch(error=>notify(error.message));return;}
  if(b.dataset.agentRead){await poll(b.dataset.agentRead,revision);return;}
  working=true;render();try{
   if(b.hasAttribute('data-agent-start')){const run=await post('/api/agent-runs',{reportId:selectedId});await load(selectedId);await poll(run.id,revision);}
   else if(b.dataset.agentCancel){await post('/api/agent-runs/cancel',{runId:b.dataset.agentCancel});await load(selectedId);}
  }catch(error){notify(error.message);}finally{working=false;render();}
 });
 return {load};
}
