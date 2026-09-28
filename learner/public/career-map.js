const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const stateLabels = {supported:'Pratique déclarée', development_needed:'À développer', unknown:'À clarifier', conflicting:'Déclarations contradictoires'};
const kindLabels = {savoir_faire:'Savoir-faire', savoir_etre:'Savoir-être', savoir:'Connaissance'};

/** The canvas and table share one server projection. No facts are invented by the renderer. */
export function createCareerMap(container, {request, openCareer, toggleCompare, selected, notify}) {
  let graph, options = {page:0,expandedIds:[],skillPage:0,skillState:'all',skillKind:'savoir_faire',filter:'all'};
  let mode = 'graph', focused = null, busy = false, revision = 0, view = null, bounds, drag;
  const isSelected = id => selected().has(id);
  const button = (action, label, disabled = false, extra = '') => `<button type="button" class="map-button" data-map-action="${action}" ${disabled?'disabled':''} ${extra}>${label}</button>`;

  async function load(patch = {}) {
    if (busy) return;
    const active = document.activeElement;
    const restoreFocus = active?.dataset.mapAction ? ['mapAction',active.dataset.mapAction] :
      active?.dataset.mapFilter ? ['mapFilter',active.dataset.mapFilter] : null;
    const next = {...options,...patch}, ticket = ++revision;
    busy = true; container.setAttribute('aria-busy','true');
    container.querySelectorAll('button,select').forEach(item => item.disabled = true);
    try {
      const response = await request(next);
      if (ticket !== revision) return;
      options = {...next,page:response.page,skillPage:response.skillPage}; graph = response; focused = null; view = null;
    } catch (error) { if(ticket === revision) notify(error.message); }
    finally { if(ticket === revision) {busy = false; container.removeAttribute('aria-busy'); render();
      if(restoreFocus) [...container.querySelectorAll('button,select')].find(item=>!item.disabled && item.dataset[restoreFocus[0]]===restoreFocus[1])?.focus({preventScroll:true});
    } }
  }

  function layout() {
    const height = item => Math.max(112, 60 + Math.ceil((item.title ?? item.label).length / 28) * 22);
    const careers = graph.careers.map(item => ({...item,x:282,w:302,h:height(item),type:'career'}));
    const skills = graph.skills.map(item => ({...item,x:703,w:292,h:height(item),type:'skill'}));
    const stackHeight = items => items.reduce((sum,item) => sum + item.h + 24, 0);
    const h = Math.max(550, stackHeight(careers) + 80, stackHeight(skills) + 80);
    for (const items of [careers,skills]) {
      let y = (h-stackHeight(items))/2 + 12;
      for (const item of items) {item.y = y; y += item.h + 24;}
    }
    bounds = {x:0,y:0,w:1024,h};
    return [{...graph.root,x:22,y:h/2-78,w:198,h:156,type:'scope'},...careers,...skills];
  }

  function renderNode(node) {
    const title = node.title ?? node.label;
    const subtitle = node.type === 'career' ? `${node.requirementCount} exigences${node.current?' · Métier actuel':''}${node.expanded?' · Déplié':''}` :
      node.type === 'skill' ? `${stateLabels[node.state]} · ${node.linkedCareers.length} métier(s)` : `${graph.total} métiers disponibles`;
    const tag = node.type === 'career' ? 'MÉTIER' : node.type === 'skill' ? kindLabels[node.kind] ?? 'EXIGENCE' : graph.root.kind === 'domain' ? 'DOMAINE CHOISI' : 'VOTRE POINT DE DÉPART';
    return `<g class="career-node node-${node.type} ${node.state??''} ${node.expanded?'expanded':''}" data-node="${escape(node.id)}" tabindex="0" role="button" aria-label="${escape(title)}${node.type==='career'?', afficher les exigences':''}"><title>${escape(title)}</title><rect x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" rx="10"/><foreignObject x="${node.x+14}" y="${node.y+12}" width="${node.w-28}" height="${node.h-20}"><div xmlns="http://www.w3.org/1999/xhtml" class="node-copy"><span class="node-tag">${escape(tag)}</span><strong>${escape(title)}</strong><small>${escape(subtitle)}</small></div></foreignObject></g>`;
  }

  function renderCanvas() {
    const nodes = layout(), byId = new Map(nodes.map(item=>[item.id,item]));
    if(!view) view = {...bounds};
    const edges = graph.edges.map(edge => {
      const from = byId.get(edge.from), to = byId.get(edge.to); if(!from || !to) return '';
      const x1 = from.x+from.w, y1 = from.y+from.h/2, x2 = to.x, y2 = to.y+to.h/2, mid = (x1+x2)/2;
      return `<g class="career-edge edge-${edge.kind}" data-edge="${escape(edge.id)}" tabindex="0" role="button" aria-label="${escape(`${from.title??from.label} → ${to.title??to.label} : ${edge.label}`)}"><title>${escape(edge.label)} — cliquer pour la source</title><path class="edge-hit" d="M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}"/><path class="edge-line" d="M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}" marker-end="url(#career-arrow)"/></g>`;
    }).join('');
    return `<div class="graph-canvas"><svg id="career-network" viewBox="${view.x} ${view.y} ${view.w} ${view.h}" aria-label="Graphe des métiers et de leurs exigences" role="group"><defs><marker id="career-arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#91aaa0"/></marker></defs>${edges}${nodes.map(renderNode).join('')}</svg>${!graph.expandedIds.length?'<div class="graph-hint">Cliquez sur un métier pour déplier ses compétences.</div>':''}</div>`;
  }

  function renderTable() {
    const careerTable = `<div class="table-wrap explorer-table"><table><caption>Métiers de la page actuelle · mêmes données que la carte</caption><thead><tr><th>Métier</th><th>Pratique déclarée</th><th>À développer</th><th>À clarifier</th><th>Comparer</th></tr></thead><tbody>${graph.careers.filter(item=>graph.pageIds.includes(item.id)).map(item=>`<tr><td>${button('inspect',escape(item.title),false,`data-id="${escape(item.id)}"`)}${item.current?'<small>Métier actuel</small>':''}</td><td>${item.counts.supported}</td><td>${item.counts.development_needed}</td><td>${item.counts.unknown}${item.counts.conflicting?` + ${item.counts.conflicting} contradictoire(s)`:''}</td><td><label class="graph-compare"><input type="checkbox" data-map-compare="${escape(item.id)}" ${isSelected(item.id)?'checked':''}> Sélectionner</label></td></tr>`).join('')}</tbody></table></div>`;
    if(!graph.expandedIds.length) return careerTable;
    return careerTable + `<div class="table-wrap explorer-table"><table><caption>Exigences des métiers dépliés · page ${graph.skillPage+1} / ${graph.skillPageCount}</caption><thead><tr><th>Exigence</th><th>Votre situation</th><th>Métiers liés</th></tr></thead><tbody>${graph.skills.map(item=>`<tr><td>${button('inspect',escape(item.label),false,`data-id="${escape(item.id)}"`)}</td><td>${stateLabels[item.state]}</td><td>${item.linkedCareers.length}</td></tr>`).join('') || '<tr><td colspan="3">Aucune exigence pour ces filtres.</td></tr>'}</tbody></table></div>`;
  }

  function render() {
    if (!graph) return;
    if (!graph.total) {container.innerHTML='<div class="empty"><h3>Votre exploration commence par un choix</h3><p>Choisissez un domaine, votre métier ou des centres d’intérêt pour ouvrir les possibilités disponibles.</p><button class="button secondary" data-view="profile">Choisir mon point de départ</button></div>'; return;}
    container.innerHTML = `<div class="explorer-heading"><div><p class="eyebrow">EXPLORATEUR DE PARCOURS</p><h3>${escape(graph.root.label)}</h3><p>Tous les métiers du périmètre sont accessibles. Dépliez jusqu’à trois métiers pour voir les compétences qu’ils partagent.</p></div><div class="explorer-total"><strong>${graph.total}</strong><span>métiers disponibles</span></div></div>
      <div class="explorer-toolbar"><div class="explorer-tabs" role="group" aria-label="Affichage">${button('graph','Carte',false,`aria-pressed="${mode==='graph'}"`)}${button('table','Tableau',false,`aria-pressed="${mode==='table'}"`)}</div><label>Afficher<select data-map-filter="filter"><option value="all">Tous les métiers</option><option value="saved">Métiers enregistrés</option><option value="practiced">Avec une pratique déclarée</option></select></label><div class="graph-controls" ${mode==='table'?'hidden':''}>${button('zoom-in','+',false,'aria-label="Agrandir la carte"')}${button('zoom-out','−',false,'aria-label="Réduire la carte"')}${button('fit','Recentrer')}</div></div>
      ${graph.filteredTotal ? (mode==='graph'?renderCanvas():renderTable()) : '<div class="empty">Aucun métier pour ce filtre. Choisissez « Tous les métiers » pour retrouver le catalogue.</div>'}
      <div class="graph-pagination"><span>${graph.filteredTotal?`${graph.page*graph.pageSize+1}–${Math.min((graph.page+1)*graph.pageSize,graph.filteredTotal)}`:'0'} sur ${graph.filteredTotal} métiers${graph.careers.some(item=>item.pinned)?' · métiers dépliés conservés sur la carte':''}</span><div>${button('previous','← Précédents',graph.page===0)}${button('next','Suivants →',graph.page+1>=graph.pageCount)}</div></div>
      <div class="skill-toolbar"><div><strong>Exigences des métiers dépliés</strong><span>${graph.expandedIds.length?`${graph.skillTotal} pour ces filtres`:'Sélectionnez un métier sur la carte ou dans le tableau'}</span></div><label>Type<select data-map-filter="skillKind"><option value="all">Tous les types</option><option value="savoir_faire">Savoir-faire</option><option value="savoir_etre">Savoir-être</option><option value="savoir">Connaissances</option></select></label><label>Votre situation<select data-map-filter="skillState"><option value="all">Toutes les situations</option>${Object.entries(stateLabels).map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select></label>${button('collapse','Tout replier',!graph.expandedIds.length)}</div>
      ${graph.expandedIds.length?`<div class="skill-pagination"><span>Exigences : page ${graph.skillPage+1} / ${graph.skillPageCount}</span><div>${button('skill-previous','← Exigences',graph.skillPage===0)}${button('skill-next','Exigences →',graph.skillPage+1>=graph.skillPageCount)}</div></div>`:''}
      <section id="graph-inspector" class="graph-inspector" aria-live="polite"></section><div class="graph-footer"><span><i class="legend-square supported"></i>Pratique déclarée</span><span><i class="legend-square development_needed"></i>À développer</span><span><i class="legend-square unknown"></i>À clarifier</span><span><i class="legend-square conflicting"></i>Contradictoire</span></div><p class="graph-disclosure">${escape(graph.coverage)} Cliquez sur un lien pour consulter sa source. Déplacez le fond pour naviguer, ou utilisez les boutons de zoom.</p>`;
    for (const select of container.querySelectorAll('[data-map-filter]')) select.value = options[select.dataset.mapFilter];
    renderInspector();
  }

  function sourcesMarkup(references) {
    return `<ul class="graph-source-list">${references.map(ref => {
      let label = ref.kind === 'rome_domain' ? `Appartenance au domaine « ${ref.domainLabel} »` :
        ref.kind === 'rome_interest_centre' ? `Intérêt : ${ref.centreLabel}` :
        ref.kind === 'rome_mobility' ? `Mobilité publiée depuis ${ref.fromCodeRome}` :
        ref.kind === 'rome_shared_skills' ? `${ref.sharedSkillOgrs.length} savoir-faire partagés avec ${ref.fromCodeRome}` :
        ref.kind === 'occupation_requirement' ? `Fiche ${ref.codeRome} · ${kindLabels[ref.requirementKind]??'Exigence'} ${ref.itemId}` : ref.label ?? 'Fiches métiers de France Travail';
      return `<li>${escape(label)}<small>France Travail${ref.releaseId?` · version ${escape(ref.releaseId)}`:''}</small></li>`;
    }).join('')}</ul>`;
  }

  function renderInspector() {
    const panel = container.querySelector('#graph-inspector'); if(!panel) return;
    const job = graph.careers.find(item=>item.id===focused), skill = graph.skills.find(item=>item.id===focused), edge = graph.edges.find(item=>item.id===focused);
    if(job) panel.innerHTML = `<div><p class="eyebrow">MÉTIER EXPLORÉ${job.current?' · VOTRE MÉTIER ACTUEL':''}</p><h4>${escape(job.title)}</h4><p>${job.counts.supported} pratique(s) déclarée(s) · ${job.counts.development_needed} à développer · ${job.counts.unknown} à clarifier${job.counts.conflicting?` · ${job.counts.conflicting} contradictoire(s)`:''}</p><div class="inspector-actions">${button('expand',job.expanded?'Replier les exigences':'Déplier les exigences',false,`data-id="${escape(job.id)}"`)}${button('open','Voir la fiche complète',false,`data-id="${escape(job.id)}"`)}<label class="graph-compare"><input type="checkbox" data-map-compare="${escape(job.id)}" ${isSelected(job.id)?'checked':''}> Comparer ce métier</label></div></div><div><strong>Pourquoi ce métier apparaît</strong>${sourcesMarkup(job.reasons)}<p class="graph-disclosure">${job.levelAvailability==='available'?'Un parcours de progression revu est disponible dans la fiche complète.':job.levelAvailability==='market_required'?'Choisissez un pays dans votre point de départ pour consulter les niveaux de progression.':'Aucun référentiel de progression revu pour ce métier, ce pays et ce parcours.'}</p></div>`;
    else if(skill) panel.innerHTML = `<div><p class="eyebrow">${escape(kindLabels[skill.kind]??'EXIGENCE')}</p><h4>${escape(skill.label)}</h4><span class="state-badge ${skill.state}">${escape(stateLabels[skill.state])}</span><p>${skill.evidenceType==='rome_self_confirmation'?'Votre déclaration personnelle ; elle ne valide pas un niveau de maîtrise.':'Aucun niveau de maîtrise n’est établi par ce lien.'}</p><p class="graph-disclosure">France Travail · exigence ${escape(skill.requirementId)}</p></div><div><strong>Utile dans ${skill.linkedCareers.length} métier(s) de votre périmètre</strong><div class="linked-careers">${skill.linkedCareers.map(item=>button('reveal',escape(item.title),false,`data-id="${escape(item.id)}"`)).join('')}</div></div>`;
    else if(edge) panel.innerHTML = `<div><p class="eyebrow">SOURCE DU LIEN</p><h4>${escape(edge.label)}</h4><p>Ce lien provient des enregistrements du catalogue. Il ne représente pas une promesse d’accès au métier.</p></div><div>${sourcesMarkup(edge.references)}</div>`;
    else panel.innerHTML = `<div><p class="eyebrow">LIRE LA CARTE</p><h4>Un métier. Ses exigences. Vos possibilités.</h4><p>Dépliez un métier pour découvrir ses exigences. Sélectionnez une compétence pour voir les autres métiers qui la mobilisent.</p></div><div><strong>Un catalogue complet, une carte lisible</strong><p>${escape(graph.ordering)}</p><p>La pagination limite ce qui est dessiné, pas les métiers accessibles.</p></div>`;
    highlight();
  }

  function highlight() {
    const related = new Set([focused]);
    for(const edge of graph.edges) if(edge.id===focused || edge.from===focused || edge.to===focused) {related.add(edge.id);related.add(edge.from);related.add(edge.to);}
    container.querySelectorAll('[data-node],[data-edge]').forEach(node=>{
      const id = node.dataset.node??node.dataset.edge;
      node.classList.toggle('graph-dim',Boolean(focused) && !related.has(id));
      node.classList.toggle('graph-focus',id===focused);
    });
  }

  async function expand(id) {
    mode = 'graph';
    if(options.expandedIds.includes(id)) await load({expandedIds:options.expandedIds.filter(item=>item!==id),skillPage:0});
    else {if(options.expandedIds.length>=3){notify('Repliez un métier avant d’en déplier un quatrième.');return;} await load({expandedIds:[...options.expandedIds,id],skillPage:0});}
    focused=id; renderInspector();
    [...container.querySelectorAll('[data-node]')].find(node=>node.dataset.node===id)?.focus({preventScroll:true});
  }

  function zoom(factor) {
    if(!view) return;
    const w=Math.max(bounds.w/3,Math.min(bounds.w*1.8,view.w*factor)), ratio=w/view.w;
    view={x:view.x+(view.w-w)/2,y:view.y+(view.h-view.h*ratio)/2,w,h:view.h*ratio}; setView();
  }
  function setView(){container.querySelector('#career-network')?.setAttribute('viewBox',`${view.x} ${view.y} ${view.w} ${view.h}`);}
  container.addEventListener('click',event=>{
    if(busy) return;
    const node=event.target.closest('[data-node]'), edge=event.target.closest('[data-edge]'), control=event.target.closest('[data-map-action]');
    if(node){focused=node.dataset.node;const job=graph.careers.find(item=>item.id===focused);if(job&&!job.expanded){expand(job.id);}else renderInspector();return;}
    if(edge){focused=edge.dataset.edge;renderInspector();return;}
    if(!control) return; const action=control.dataset.mapAction,id=control.dataset.id;
    if(action==='graph'||action==='table'){mode=action;render();}
    else if(action==='previous'||action==='next') load({page:graph.page+(action==='next'?1:-1)});
    else if(action==='skill-previous'||action==='skill-next') load({skillPage:graph.skillPage+(action==='skill-next'?1:-1)});
    else if(action==='collapse') load({expandedIds:[],skillPage:0});
    else if(action==='expand') expand(id);
    else if(action==='inspect'){focused=id;renderInspector();}
    else if(action==='reveal'){mode='graph';if(options.expandedIds.includes(id)){focused=id;render();}else expand(id);}
    else if(action==='open') openCareer(id);
    else if(action==='zoom-in') zoom(.8);
    else if(action==='zoom-out') zoom(1.25);
    else if(action==='fit'){view={...bounds};setView();}
  });
  container.addEventListener('keydown',event=>{
    const target=event.target.closest('[data-node],[data-edge]');
    if(target && ['Enter',' '].includes(event.key)){event.preventDefault();target.dispatchEvent(new MouseEvent('click',{bubbles:true}));}
  });
  container.addEventListener('change',event=>{
    if(event.target.dataset.mapFilter){const key=event.target.dataset.mapFilter;load({[key]:event.target.value,...(key==='filter'?{page:0}:{skillPage:0})});}
    if(event.target.dataset.mapCompare){toggleCompare(event.target.dataset.mapCompare,event.target.checked);container.querySelectorAll('[data-map-compare]').forEach(input=>input.checked=isSelected(input.dataset.mapCompare));}
  });
  container.addEventListener('pointerdown',event=>{
    const svg=event.target.closest('#career-network'); if(!svg || event.target.closest('[data-node],[data-edge]') || event.button!==0) return;
    const matrix=svg.getScreenCTM(); if(!matrix) return;
    drag={id:event.pointerId,x:event.clientX,y:event.clientY,view:{...view},scale:matrix.a};svg.setPointerCapture(event.pointerId);
  });
  container.addEventListener('pointermove',event=>{if(!drag || drag.id!==event.pointerId)return;view={...drag.view,x:drag.view.x-(event.clientX-drag.x)/drag.scale,y:drag.view.y-(event.clientY-drag.y)/drag.scale};setView();});
  const endDrag=()=>{drag=null;};container.addEventListener('pointerup',endDrag);container.addEventListener('pointercancel',endDrag);
  return {syncSelection(){container.querySelectorAll('[data-map-compare]').forEach(input=>input.checked=isSelected(input.dataset.mapCompare));},update(result){revision++;busy=false;container.removeAttribute('aria-busy');graph=result.graph;options={page:0,expandedIds:[],skillPage:0,skillState:'all',skillKind:'savoir_faire',filter:'all'};focused=null;view=null;render();}};
}
