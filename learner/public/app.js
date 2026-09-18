const $=selector=>document.querySelector(selector),escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
let csrf='',current=null,busy=false,editing=false,assessmentConnected=false;
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').hidden=true,7000);}
function preferences(){const c={hoursPerWeek:Number($('#hours').value),languages:$('#language').value==='both'?['fr','en']:[$('#language').value]};if($('#budget').value!=='')c.budgetMad=Number($('#budget').value);if($('#format').value)c.onlineFormat=$('#format').value;return c;}
function payload(){return {occupationId:$('#goal').value,constraints:preferences()};}
async function post(route,data){const response=await fetch(route,{method:'POST',headers:{'Content-Type':'application/json','X-Praxis-CSRF':csrf},body:JSON.stringify(data)});const value=await response.json();if(!response.ok)throw new Error(value.error);return value;}
async function task(action){if(busy)return;busy=true;document.querySelectorAll('button').forEach(button=>button.disabled=true);try{await action();}catch(error){toast(error.message);}finally{busy=false;document.querySelectorAll('button').forEach(button=>button.disabled=false);}}
function levelOptions(selected=''){return [['','Je ne sais pas encore'],[0,'0 · Pas encore pratiqué'],[1,'1 · Avec guidage'],[2,'2 · En autonomie'],[3,'3 · Situations variées'],[4,'4 · Expertise et transmission']].map(([value,label])=>`<option value="${value}" ${String(value)===String(selected)?'selected':''}>${label}</option>`).join('');}
function safeLink(value){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)?u.href:null;}catch{return null;}}
function render(wrapper){
 current=wrapper.result;assessmentConnected=wrapper.assessmentConnected;$('#example-banner').hidden=!wrapper.example;
 const target=current.inputSnapshot.targetProfile,selected=new Map(current.evidenceProfile.selectedEvidence.map(e=>[e.skillId,e]));
 const known=target.skills.filter(s=>selected.has(s.skillId)).length,percent=target.skills.length?Math.round(100*known/target.skills.length):0;
 $('#progress-label').textContent=`${known} / ${target.skills.length} compétences renseignées`;$('#progress-fill').style.width=`${percent}%`;$('#progress').setAttribute('aria-valuenow',String(percent));
 const statuses={insufficient_profile:'Quelques compétences restent à préciser. Commencez par celles qui débloquent le plus de formations.',ok:'Votre point de départ est clair. Voici les formations compatibles avec vos compétences et vos préférences.',plan_available:'Votre objectif demande plusieurs étapes. Un parcours progressif est disponible ci-dessous.',goal_satisfied:'Vos niveaux renseignés couvrent les exigences de cet objectif. Vous pouvez choisir un nouvel objectif.',no_eligible_courses:'Votre profil est renseigné, mais aucune offre vérifiée ne correspond actuellement à vos contraintes.'};
 $('#status').textContent=statuses[current.status];
 $('#evidence-summary').hidden=!known;$('#evidence-summary').innerHTML=`${known} niveau${known>1?'x':''} retenu${known>1?'s':''} à partir de vos preuves ou déclarations. ${current.evidenceProfile.disagreements.length?`${current.evidenceProfile.disagreements.length} désaccord(s) signalé(s).`:''}<button type="button" id="edit-levels" class="edit-button">Modifier mes niveaux</button>`;
 let requests=[...current.assessmentHandoff.requests];
 if(editing)for(const s of target.skills)if(!requests.some(r=>r.skillId===s.skillId))requests.push({...s,requiredLevel:s.targetLevel,action:'confirm_level',blockedCourseCount:0,reasons:[]});
 $('#skills').innerHTML=requests.map((r,i)=>{
  const source=selected.get(r.skillId),id=`skill-${i}`,conflict=r.action==='resolve_evidence';
  const hint=conflict?'Des preuves de même autorité se contredisent. Une nouvelle déclaration ne remplace pas une validation plus solide.':r.action==='provide_practical_evidence'?'Une preuve pratique ou une validation humaine est nécessaire pour vérifier une expertise. Vous pouvez indiquer votre niveau actuel.':r.blockedCourseCount?`Ce niveau est nécessaire pour accéder à ${r.blockedCourseCount} formation(s) pertinente(s).`:'Précisez votre niveau actuel pour comparer votre profil à votre objectif.';
  return `<article class="skill-card" data-skill="${escape(r.skillId)}"><div class="skill-top"><span class="skill-index">${String(i+1).padStart(2,'0')}</span><div class="skill-main"><h3>${escape(r.label)}</h3><p class="hint">${hint}</p></div><span class="badge">${conflict?'À clarifier':`Objectif · niveau ${r.requiredLevel}`}</span></div><div class="skill-fields"><div><label for="${id}">Mon niveau actuel</label><select id="${id}" class="level-select">${levelOptions(editing?source?.level:'')}</select>${r.action==='take_assessment' && assessmentConnected?`<button type="button" class="edit-button assessment-launch">Passer l’évaluation ↗</button>`:''}</div><div><label for="${id}-example">Un exemple concret</label><textarea id="${id}-example" class="work-example" maxlength="2000" placeholder="Une tâche, un projet ou une situation de travail…">${editing?escape(source?.provenance?.workExample??''):''}</textarea></div></div></article>`;
 }).join('');
 $('#save').hidden=!requests.length;$('#courses-section').hidden=current.status==='insufficient_profile';
 $('#course-count').textContent=`${current.recommendations.length} formation(s)`;
 $('#courses').innerHTML=current.recommendations.length?current.recommendations.map(({item})=>{
  const url=item.dataSource==='fixture'?null:safeLink(item.applicationUrl);return `<article class="course-card"><p class="section-number">${escape(item.providerName??'Organisme partenaire')}${item.dataSource==='fixture'?' · EXEMPLE':''}</p><h3>${escape(item.title)}</h3><p>${escape(item.summary)}</p><div class="course-meta"><span>${item.priceMad===null?'Prix à demander':`${item.priceMad} MAD`}</span><span>${item.durationHours??'—'} heures</span><span>${item.deliveryFormat==='online_live'?'En ligne · en direct':'En ligne · à votre rythme'}</span></div>${url?`<a class="course-link" href="${escape(url)}" target="_blank" rel="noopener noreferrer">Voir la formation ↗</a>`:`<span class="hint">${item.dataSource==='fixture'?'Offre fictive — aucune inscription.':'Contactez l’organisme pour vous inscrire.'}</span>`}</article>`;
 }).join(''):`<div class="empty-state">${current.status==='goal_satisfied'?'Cet objectif est couvert par vos niveaux renseignés. Explorez un autre objectif pour continuer à apprendre.':'Aucune formation directement accessible pour le moment. Vérifiez les prérequis et essayez un autre budget, un autre rythme ou une autre langue.'}</div>`;
 $('#plans').innerHTML=current.learningPlans.plans.slice(0,1).map(plan=>`<div class="plan"><strong>${plan.complete?'Votre parcours progressif':'Une première partie de votre parcours'}</strong><ol>${plan.steps.map(s=>`<li>${escape(s.title)}</li>`).join('')}</ol><span>Coût ${plan.totalPriceMad===null?'à confirmer':`${plan.totalPriceMad} MAD`} · Fin ${plan.finishAt?new Date(plan.finishAt).toLocaleDateString('fr-FR'):'à estimer'} · Résultats projetés, à confirmer par votre apprentissage</span></div>`).join('');
 post('/api/impressions',{requestId:current.requestId}).catch(error=>toast(`Votre parcours est affiché, mais son enregistrement a échoué : ${error.message}`));
}
$('#preferences-form').addEventListener('submit',event=>{event.preventDefault();editing=false;task(async()=>render(await post('/api/recommendations',payload())));});
$('#skills-form').addEventListener('submit',event=>{event.preventDefault();task(async()=>{
 const declarations=[...document.querySelectorAll('.skill-card')].flatMap(card=>{const level=card.querySelector('.level-select').value;if(level==='')return [];return [{skillId:card.dataset.skill,level:Number(level),workExample:card.querySelector('.work-example').value}];});
 if(!declarations.length)throw new Error('Choisissez au moins un niveau avant d’enregistrer.');
 const result=await post('/api/levels',{...payload(),declarations});editing=false;render(result);toast('Vos niveaux sont enregistrés. Votre parcours a été actualisé.');
});});
document.addEventListener('click',event=>{
 if(event.target.id==='edit-levels'){editing=true;render({result:current,assessmentConnected,example:!$('#example-banner').hidden});}
 if(event.target.classList.contains('assessment-launch'))task(async()=>{const value=await post('/api/assessment-launch',{...payload(),skillId:event.target.closest('.skill-card').dataset.skill});window.location.assign(value.url);});
});
document.addEventListener('change',event=>{if(event.target.classList.contains('level-select')){const textarea=event.target.closest('.skill-card').querySelector('.work-example');textarea.disabled=event.target.value==='0';textarea.placeholder=textarea.disabled?'Aucun exemple demandé pour un premier départ.':'Une tâche, un projet ou une situation de travail…';}});
await task(async()=>{
 const response=await fetch('/api/bootstrap');const data=await response.json();if(!response.ok)throw new Error(data.error);csrf=data.csrf;
 $('#goal').innerHTML=data.goals.length?data.goals.map(goal=>`<option value="${escape(goal.id)}">${escape(goal.label)}</option>`).join(''):'<option value="">Aucun objectif disponible</option>';
 if(!data.goals.length){$('#status').textContent='Aucun objectif publié n’est disponible. Le catalogue doit être préparé avant de proposer un parcours.';$('#refresh').hidden=true;return;}
 $('#goal').value=data.occupationId;$('#hours').value=data.constraints.hoursPerWeek;$('#budget').value=data.constraints.budgetMad??'';$('#language').value=data.constraints.languages?.length===2?'both':data.constraints.languages?.[0]??'fr';$('#format').value=data.constraints.onlineFormat??'';
 render(await post('/api/recommendations',payload()));
});
