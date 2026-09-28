import type {AgentMessage} from './career-agent.js';
import {CAREER_AGENT_LIMITS} from './career-agent.js';

export const NVIDIA_MODEL='google/gemma-4-31b-it';
const ENDPOINT='https://integrate.api.nvidia.com/v1/chat/completions';
const STATUS='https://integrate.api.nvidia.com/v1/status/';
export type AgentProvider=(messages:AgentMessage[],signal:AbortSignal)=>Promise<string>;

/** NVIDIA's model-specific chat endpoint does not document native tools; JSON tool requests are validated by our application. */
export function nvidiaProvider(apiKey:string,fetcher:typeof fetch=fetch):AgentProvider{
 if(!apiKey||apiKey.length<20)throw new Error('NVIDIA_API_KEY is not configured');
 return async(messages,signal)=>{
  const callSignal=AbortSignal.any([signal,AbortSignal.timeout(CAREER_AGENT_LIMITS.providerCallMs)]);
  const headers={Authorization:`Bearer ${apiKey}`,Accept:'application/json','Content-Type':'application/json'};
  let response=await fetcher(ENDPOINT,{method:'POST',headers,signal:callSignal,body:JSON.stringify({model:NVIDIA_MODEL,messages,max_tokens:550,stream:false,temperature:0.1,top_p:1})});
  let polls=0;
  while(response.status===202){
   if(++polls>20)throw new Error('provider_poll_limit');
   const headerId=response.headers.get('nvcf-reqid');
   const pending=headerId?null:await response.json() as {requestId?:unknown;id?:unknown};
   const id=headerId??pending?.requestId??pending?.id;
   if(typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id))throw new Error('provider_missing_request_id');
   await new Promise<void>((resolve,reject)=>{
    if(callSignal.aborted){reject(new Error('provider_cancelled'));return;}
    const onAbort=()=>{clearTimeout(timer);reject(new Error('provider_cancelled'));};
    const timer=setTimeout(()=>{callSignal.removeEventListener('abort',onAbort);resolve();},500);
    callSignal.addEventListener('abort',onAbort,{once:true});
   });
   response=await fetcher(STATUS+id,{method:'GET',headers,signal:callSignal});
  }
  if(!response.ok)throw new Error(`provider_http_${response.status}`);
  const payload=await response.json() as {choices?:{message?:{content?:unknown}}[]};
  const content=payload.choices?.[0]?.message?.content;
  if(typeof content!=='string')throw new Error('provider_missing_content');
  return content;
 };
}
