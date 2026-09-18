export const now = new Date('2026-09-18T12:00:00Z');
export const evidence = {itemSegment:{successes:0,trials:0},productFamilySector:{successes:0,trials:0},sector:{successes:0,trials:0},global:{successes:0,trials:0}};
export const weights = {gap_coverage:.28,precision:.18,level_fit:.14,evidence_confidence:.10,constraint_fit:.10,outcome_prior:.05,scarcity:.08,freshness:.07,redundancy_penalty:.12,outcome_prior_estimator:{alpha:25,minimum_trials:{item:20,product_family_sector:50,sector:100,global:200},neutral_prior:.5,featured_prior:.7,rank_decay:.03}};
export const skill = (skillId,targetLevel=1,declaredLevel=0) => ({skillId,targetLevel,declaredLevel,gap:Math.max(0,targetLevel-declaredLevel),importance:1,confidence:'medium'});
export const learner = {learnerId:'00000000-0000-0000-0000-000000000001',skills:[skill('a')],constraints:{hoursPerWeek:10}};
export function item(id,outcomes,extra={}) {
 return {id,recordType:'course',slug:id,title:id,summary:'',status:'published',productFamily:null,sectorCode:null,featured:false,coldStartRank:null,coldStartSourceVersion:null,priceMad:100,durationHours:10,languages:['fr'],format:'online_self_paced',nextSessionAt:null,providerId:'p',providerName:'p',applicationUrl:'https://example.org',contactRoute:null,deliveryFormat:'online_self_paced',isOnline:true,locationCity:null,locationCountry:null,priceStatus:'priced',admissionStatus:'rolling_admission',actionableOffer:true,actionableMissing:[],dataSource:'fixture',updatedAt:now,targetOccupationId:null,variant:null,popularity:0,outcomePrior:.5,outcomePriorEvidence:evidence,outcomes:outcomes.map(outcome=>({entryLevel:0,outcomeLevel:1,weight:1,catalogFrequency:1,...outcome})),steps:[],...extra};
}
export function chain() {
 return [item('first',[{skillId:'a'}]),item('second',[{skillId:'b'}],{prerequisites:[{skillId:'a',label:'a',minimumLevel:1}]}),item('third',[{skillId:'c'}],{prerequisites:[{skillId:'b',label:'b',minimumLevel:1}]})];
}
