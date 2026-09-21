import test from 'node:test';
import assert from 'node:assert/strict';
import {
 ALGORITHM_VERSIONS,
 LaborMarketRepository,
 biasCorrectLaborMarketIngestion,
 validateBiasCorrectedLaborMarketBatch,
} from '../dist/index.js';

const a={countryCode:'MA',regionCode:'MA-06',sectorCode:'construction',occupationGroupCode:'21'};
const b={countryCode:'MA',regionCode:'MA-06',sectorCode:'information',occupationGroupCode:'25'};
const c={countryCode:'MA',regionCode:'MA-03',sectorCode:'agriculture',occupationGroupCode:'61'};
const release=(id)=>({sourceId:`portal-${id}`,releaseId:id,retrievedAt:new Date('2026-09-20T00:00:00Z'),
 license:'research agreement',coverageNote:'Online advertisements; coverage is not representative.'});
const posting=(sourceReleaseId,externalPostingId,deduplicationKey,stratum,skillIds)=>({sourceReleaseId,externalPostingId,
 deduplicationKey,stratum,skillIds,observedAt:new Date('2026-09-15T00:00:00Z')});
const policy={version:'poststrat-ma-v1',minimumWeight:.1,maximumWeight:10,minimumBenchmarkCoverage:.9,
 minimumEffectiveSampleSize:2,minimumSkillObservations:1,confidenceLevel:.95};
const base={period:'2026-Q3',sourceReleases:[release('release-a'),release('release-b')],
 observations:[
  posting('release-a','a1','job-1',a,['skill-a']),
  posting('release-b','b1','job-1',a,['skill-a','skill-shared']),
  posting('release-a','a2','job-2',a,['skill-shared']),
  ...Array.from({length:8},(_,index)=>posting('release-a',`b-${index}`,`job-b-${index}`,b,index<4?['skill-b']:['skill-shared'])),
 ],benchmark:{sourceId:'official-lfs',releaseId:'lfs-2026-q3',measure:'recent_hires',
  publishedAt:new Date('2026-09-01T00:00:00Z'),cells:[{stratum:a,count:80},{stratum:b,count:20}]},policy};

test('deduplication and poststratification recover the official covered distribution',()=>{
 const batch=biasCorrectLaborMarketIngestion(base);
 assert.equal(batch.algorithmVersion,ALGORITHM_VERSIONS.laborMarketBiasCorrection);
 assert.equal(batch.counts.rawObservations,11);assert.equal(batch.counts.uniquePostings,10);
 assert.equal(batch.counts.duplicatesRemoved,1);assert.equal(batch.benchmarkCoverage.ratio,1);
 const sa=batch.strata.find(row=>row.stratum.sectorCode==='construction');
 const sb=batch.strata.find(row=>row.stratum.sectorCode==='information');
 assert.ok(Math.abs(sa.observedPostings*sa.appliedWeight/10-.8)<1e-12);
 assert.ok(Math.abs(sb.observedPostings*sb.appliedWeight/10-.2)<1e-12);
 const skillA=batch.skills.find(skill=>skill.skillId==='skill-a');
 assert.ok(skillA.adjustedShare>skillA.benchmarkedRawShare);assert.ok(skillA.relativeShareChange>0);
 assert.ok(batch.qualityFlags.includes('duplicates_removed'));
 assert.ok(batch.qualityFlags.includes('duplicate_skill_disagreement'));
 assert.ok(batch.qualityFlags.includes('selection_bias_may_remain'));
 assert.ok(batch.qualityFlags.includes('absolute_vacancy_level_not_identified'));
 validateBiasCorrectedLaborMarketBatch(batch);
});

test('uncovered benchmark cells and unbenchmarked ads block publishable skill estimates',()=>{
 const input={...base,
  observations:[...base.observations,posting('release-a','c-1','job-c-1',
   {...c,sectorCode:'unclassified'},['skill-unbenchmarked'])],
  benchmark:{...base.benchmark,cells:[...base.benchmark.cells,{stratum:c,count:50}]}};
 const batch=biasCorrectLaborMarketIngestion(input);
 assert.ok(batch.benchmarkCoverage.ratio<policy.minimumBenchmarkCoverage);
 assert.ok(batch.qualityFlags.includes('uncovered_benchmark_cells'));
 assert.ok(batch.qualityFlags.includes('unbenchmarked_observations'));
 assert.ok(batch.skills.every(skill=>skill.status==='insufficient_coverage'));
 assert.ok(batch.skills.find(skill=>skill.skillId==='skill-unbenchmarked').qualityFlags.includes('unbenchmarked_skill_observations'));
});

test('weight caps and small effective samples remain explicit',()=>{
 const input={...base,policy:{...policy,maximumWeight:1,minimumEffectiveSampleSize:100}};
 const batch=biasCorrectLaborMarketIngestion(input);
 assert.ok(batch.qualityFlags.includes('weight_capping_applied'));
 assert.ok(batch.qualityFlags.includes('low_effective_sample_size'));
 assert.ok(batch.skills.every(skill=>skill.status==='insufficient_sample'));
 assert.ok(batch.skills.every(skill=>skill.confidenceInterval.lower<=skill.adjustedShare &&
  skill.adjustedShare<=skill.confidenceInterval.upper));
});

test('conflicting duplicate strata and absent overlap are rejected',()=>{
 assert.throws(()=>biasCorrectLaborMarketIngestion({...base,observations:[
  posting('release-a','x','same',a,['skill-a']),posting('release-b','y','same',b,['skill-a'])]}),/conflicting strata/);
 assert.throws(()=>biasCorrectLaborMarketIngestion({...base,observations:[posting('release-a','z','z',c,['skill-a'])]}),/No observed stratum/);
});

test('labor-market persistence records the complete append-only trace atomically',async()=>{
 const batch=biasCorrectLaborMarketIngestion(base),calls=[];let released=false;
 const skillIds=batch.skills.map(skill=>skill.skillId);
 const client={query:async(sql,params=[])=>{
  calls.push({sql:String(sql),params});
  if(String(sql).includes('FROM praxis.labor_market_ingestion_batch'))return {rows:[]};
  if(String(sql).includes('FROM praxis.labor_market_source_release'))return {rows:[]};
  if(String(sql).includes('FROM praxis.labor_market_benchmark_release'))return {rows:[]};
  if(String(sql).includes('SELECT id FROM praxis.skill'))return {rows:skillIds.map(id=>({id}))};
  return {rows:[]};
 },release:()=>{released=true;}};
 const recorded=await new LaborMarketRepository({connect:async()=>client}).record(batch);
 assert.equal(recorded.replayed,false);assert.equal(released,true);
 assert.ok(calls.some(call=>call.sql.includes('INSERT INTO praxis.labor_market_posting_observation')));
 assert.ok(calls.some(call=>call.sql.includes('INSERT INTO praxis.labor_market_skill_demand_estimate')));
 assert.ok(calls.some(call=>call.sql==='COMMIT'));
});

test('tampered estimates fail provenance validation',()=>{
 const batch=biasCorrectLaborMarketIngestion(base);
 assert.throws(()=>validateBiasCorrectedLaborMarketBatch({...batch,effectiveSampleSize:999}),/provenance/);
});
