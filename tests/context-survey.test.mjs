import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {ALGORITHM_VERSIONS,SURVEY_QUESTIONS,normalizeAnswer,resolveSurvey,selectNextQuestion,toContextFields} from '../dist/index.js';

const facts={today:'2026-09-25',roleLabel:'Data scientist',goalKind:'role',goalText:null};
const settled=(answers)=>resolveSurvey(facts,new Map(answers.map(([id,value,declined=false])=>[id,{value,declined,source:'learner'}])));

test('career survey registry matches the six live questions and omits course preferences',()=>{
 const sql=readFileSync(new URL('../database/migrations/062_context_survey.sql',import.meta.url),'utf8');
 const registered=[...sql.matchAll(/\('praxis-context-survey-v2', '([a-z_]+)', '([a-z]+)', (NULL|'[a-z]+')\)/g)].map(match=>match[1]);
 assert.equal(ALGORITHM_VERSIONS.learnerContextSurvey,'praxis-context-survey-v2');
 assert.deepEqual(registered,SURVEY_QUESTIONS.map(question=>question.id));
 assert.deepEqual(registered,['motivation','situation','hours_per_week','deadline','practice_level','recent_work_example']);
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
 assert.ok(!never.applicable.has('recent_work_example'));
 const practiced=settled([['motivation','job_seeking'],['situation','seeking'],['hours_per_week',4],['deadline','none'],['practice_level','occasionally']]);
 assert.equal(selectNextQuestion(practiced).id,'recent_work_example');
});

test('a skipped answer stays distinct from unanswered and never creates a skill level',()=>{
 const survey=settled([['motivation',null,true],['situation','studying'],['hours_per_week',null,true]]);
 const fields=toContextFields(survey);
 assert.equal(fields.motivation,undefined);
 assert.equal(fields.hoursPerWeek,undefined);
 assert.deepEqual(fields.declinedFields,['motivation','time']);
 assert.equal('level' in fields,false);
 const question=SURVEY_QUESTIONS.find(item=>item.id==='recent_work_example');
 assert.throws(()=>normalizeAnswer(question,survey.state,{value:'short'}),/10/);
});
