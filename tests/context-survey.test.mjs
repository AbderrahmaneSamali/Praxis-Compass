import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {ALGORITHM_VERSIONS,SURVEY_QUESTIONS,normalizeAnswer,resolveSurvey,selectNextQuestion,toContextFields} from '../dist/index.js';

const sql=readFileSync(new URL('../database/migrations/064_selection_only_intake.sql',import.meta.url),'utf8');
const catalog={};
for(const [,group,value,label] of sql.matchAll(/\('([a-z_]+)','([^']+)','([^']+)',\d+\)/g)) (catalog[group]??=[]).push({id:group+':'+value,value,labelFr:label});
const facts={catalog,today:'2026-09-25',roleLabel:'Data scientist',goalKind:'role',goalText:null};
const settled=(answers)=>resolveSurvey(facts,new Map(answers.map(([id,value,declined=false])=>[id,{value,declined,source:'learner'}])));

test('career survey registry matches the six live questions and omits course preferences',()=>{
 const registered=[...sql.matchAll(/\('praxis-context-survey-v3', '([a-z_]+)', '([a-z]+)', (NULL|'[a-z]+')\)/g)].map(match=>match[1]);
 assert.equal(ALGORITHM_VERSIONS.learnerContextSurvey,'praxis-context-survey-v3');
 assert.deepEqual(registered,SURVEY_QUESTIONS.map(question=>question.id));
 assert.deepEqual(registered,['motivation','situation','hours_per_week','deadline','practice_level','practice_context']);
 assert.ok(SURVEY_QUESTIONS.every(question=>question.prompt(settled([]).state).split(/\s+/).length<=8));
});

test('earlier career answers change the next question and example branch',()=>{
 assert.equal(selectNextQuestion(settled([])).id,'motivation');
 const employer=settled([['motivation','employer_required']]);
 assert.equal(employer.state.answers.get('situation').source,'inferred');
 assert.equal(employer.state.answers.get('situation').value,'employed');
 assert.equal(selectNextQuestion(employer).id,'deadline');
 const never=settled([['motivation','job_seeking'],['situation','seeking'],['hours_per_week',4],['deadline','none'],['practice_level','never']]);
 assert.equal(selectNextQuestion(never),null);
 assert.ok(!never.applicable.has('practice_context'));
 const practiced=settled([['motivation','job_seeking'],['situation','seeking'],['hours_per_week',4],['deadline','none'],['practice_level','occasionally']]);
 assert.equal(selectNextQuestion(practiced).id,'practice_context');
});

test('a skipped answer stays distinct from unanswered and never creates a skill level',()=>{
 const survey=settled([['motivation',null,true],['situation','studying'],['hours_per_week',null,true]]);
 const fields=toContextFields(survey);
 assert.equal(fields.motivation,undefined);
 assert.equal(fields.hoursPerWeek,undefined);
 assert.deepEqual(fields.declinedFields,['motivation','time']);
 assert.equal('level' in fields,false);
 const question=SURVEY_QUESTIONS.find(item=>item.id==='practice_context');
 assert.throws(()=>normalizeAnswer(question,survey.state,{value:'short'}),/ne correspond pas/);
});

test('survey accepts database choices only and preserves numeric and deadline meaning',()=>{
 const state=settled([]).state;
 for(const question of SURVEY_QUESTIONS){assert.ok(question.options(state).length);assert.equal(question.freeInput?.(state),undefined);assert.throws(()=>normalizeAnswer(question,state,{value:'unlisted text'}));}
 const hours=SURVEY_QUESTIONS.find(q=>q.id==='hours_per_week');
 assert.equal(normalizeAnswer(hours,state,{value:'4'}).value,4);
 assert.throws(()=>normalizeAnswer(hours,state,{value:3.5}));
 assert.equal(toContextFields(settled([['deadline','months_3']])).deadline,'2026-12-25');
});
