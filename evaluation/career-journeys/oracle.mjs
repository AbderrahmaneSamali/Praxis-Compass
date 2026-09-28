// Expectations come from the journey fixtures, not from the ranking or plan implementation.
export function gradeJourney(scenario,report,expectedCount){
 const target=report.snapshot.targets.find(t=>t.code===scenario.target);
 const candidate=report.snapshot.candidates.find(c=>c.code===scenario.target);
 const activity=target?.activities.find(a=>a.id===scenario.activity);
 const first=target?.plan.nextMilestoneIds.map(id=>target.plan.milestones.find(m=>m.id===id)).find(Boolean);
 const flags={
  inDomain:report.snapshot.candidates.every(c=>c.domains.some(d=>d.code===scenario.domain)),
  exactCoverage:report.snapshot.candidates.length===expectedCount,
  targetPresent:Boolean(candidate&&target),
  pilotActivity:Boolean(activity&&activity.status==='pilot'),
  actionable:Boolean(first&&first.state==='ready'&&first.kind==='exercise'&&first.activityId===scenario.activity),
  activityReady:Boolean(target?.plan.milestones.some(m=>m.id===`exercise:${scenario.activity}`&&m.state==='ready')),
  noFalseLevel:Boolean(target&&target.plan.readiness==='not_assessed'&&target.plan.masteryEstablished===false&&
   !target.plan.gaps.some(g=>g.kind==='career_level')&&target.plan.levelAvailability==='unavailable'),
  marketScoped:report.snapshot.profile.marketCode===scenario.market&&target?.input.target.marketCode===scenario.market,
  targetInTopFive:report.snapshot.recommendations.slice(0,5).some(r=>r.directionId===`rome:${scenario.target}`),
 };
 return {id:scenario.id,market:scenario.market,domain:scenario.domain,target:scenario.target,
  candidateCount:report.snapshot.candidates.length,expectedCount,requirementCount:target?.plan.summary.requirements??null,
  unknownCount:target?.plan.summary.unknown??null,firstStep:{kind:first?.kind??null,label:first?.label??null},flags};
}

export function gradeProgression(before,after,submission,expectedSuccessor){
 const plan=after.snapshot.targets.find(t=>t.code===before.target)?.plan;
 return {passed:submission.outcome==='passed',successorReady:Boolean(plan?.milestones.some(m=>m.id===`exercise:${expectedSuccessor}`&&m.state==='ready')),
  completionRecorded:plan?.summary.exercisesCompleted===1,unknownUnchanged:plan?.summary.unknown===before.unknownCount,
  noMastery:plan?.masteryEstablished===false&&plan?.readiness==='not_assessed'};
}

export const journeyChecks=['inDomain','exactCoverage','targetPresent','pilotActivity','actionable','activityReady','noFalseLevel','marketScoped'];
export function summarize(rows,guardChecks=[]){
 const safetyTotal=rows.length*journeyChecks.length+rows.reduce((n,row)=>n+(row.progress?Object.keys(row.progress).length:0),0)+guardChecks.length;
 const safetyPassed=rows.reduce((n,row)=>n+journeyChecks.filter(name=>row.flags[name]).length+
  (row.progress?Object.values(row.progress).filter(Boolean).length:0),0)+guardChecks.filter(c=>c.passed).length;
 const topFive=rows.filter(row=>row.flags.targetInTopFive).length;
 return {safetyPassed,safetyTotal,safetyRate:safetyTotal?safetyPassed/safetyTotal:null,targetInTopFive:topFive,caseCount:rows.length,
  topFiveRate:rows.length?topFive/rows.length:null,progressionPassed:rows.filter(row=>row.progress&&Object.values(row.progress).every(Boolean)).length,
  progressionCount:rows.filter(row=>row.progress).length};
}

// A/B positions alternate without model names or call metadata in the review packet.
export function blindComparisons(comparisons){
 const review=[],key=[];
 for(const [index,c] of comparisons.entries()){
  if(c.status!=='completed'||!c.assistant)continue;
  const assistantSide=index%2===0?'B':'A';
  review.push({caseId:c.caseId,market:c.market,facts:c.reportFacts,
   A:assistantSide==='A'?c.assistant:c.baseline,B:assistantSide==='B'?c.assistant:c.baseline,
   preferred:'unreviewed',reasonCodes:[],reviewerId:null});
  key.push({caseId:c.caseId,assistantSide});
 }
 return {review,key};
}
