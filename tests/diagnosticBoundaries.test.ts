/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createAuthMiddleware } from '../src/middleware/auth';
import { createPolicyMiddleware } from '../src/middleware/policy';
import { parseRequest } from '../src/proxy/request';
import { OpenAIProvider } from '../src/providers/openai';
import { BudgetTracker } from '../src/storage/budgetTracker';

afterEach(()=>vi.unstubAllGlobals());
describe('diagnostic security and accounting boundaries',()=>{
 it('enforces stored model permissions before dispatch',async()=>{
  const cfg:any={gatewayApiKey:'different',policy:{enabled:false,rules:[]}};
  const c:any={apiKey:'synthetic',messages:[{role:'user',content:'hello'}],originalModel:'forbidden',permissions:[]};
  const auth=createAuthMiddleware(cfg,{validate:async()=>({valid:true,record:{id:'audit',name:'audit',permissions:['chat'],allowedModels:['allowed']}})} as any);
  await expect(auth(c,cfg).then(()=>createPolicyMiddleware(cfg)(c,cfg))).rejects.toThrow(/model/i);
 });
 it('allocates a unique accounting attempt despite repeated client correlation ids',()=>{
  const req:any={body:{model:'gpt-4o-mini',messages:[{role:'user',content:'hello'}]},headers:{authorization:'Bearer synthetic','idempotency-key':'same','x-request-id':'same'}};
  expect(parseRequest(req).requestId).not.toBe(parseRequest(req).requestId);
 });
 it('retains uncertain provider cost capacity until reconciliation',async()=>{
  BudgetTracker.resetInMemoryState();const b=new BudgetTracker('redis://localhost:0');
  await b.setBudget('audit',10);await b.reserve('audit','uncertain',4);await b.settle('audit','uncertain',null);
  expect(await b.getBudgetStatus('audit')).toMatchObject({used:0,reserved:4,remaining:6});await b.close();
 });
 it('distinguishes missing non-stream usage from measured zero',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({model:'gpt-4o-mini',choices:[]}))));
  const p=new OpenAIProvider({type:'openai',apiKey:'synthetic',baseUrl:'https://audit.invalid'} as any);
  const r=await p.complete({model:'gpt-4o-mini',messages:[],stream:false,metadata:{}});
  expect(r).toHaveProperty('usageKnown',false);
 });
 it('requests and forwards final stream usage without turning content chunks into measured zero',async()=>{
  const chunks=[{id:'x',model:'gpt-4o-mini',choices:[{delta:{content:'hello'}}],usage:null},{id:'x',model:'gpt-4o-mini',choices:[],usage:{prompt_tokens:100,completion_tokens:200,total_tokens:300}}];
  const f=vi.fn().mockResolvedValue(new Response(chunks.map(c=>'data: '+JSON.stringify(c)+'\n\n').join('')+'data: [DONE]\n\n'));
  vi.stubGlobal('fetch',f);const p=new OpenAIProvider({type:'openai',apiKey:'synthetic',baseUrl:'https://audit.invalid'} as any);
  const out=[];for await(const c of p.streamComplete({model:'gpt-4o-mini',messages:[],stream:true,metadata:{}}))out.push(c);
  expect(JSON.parse(f.mock.calls[0][1].body)).toHaveProperty('stream_options.include_usage',true);
  expect(out[0]).toHaveProperty('usageKnown',false);expect(out[1].usage).toEqual({promptTokens:100,completionTokens:200,totalTokens:300});
 });
});
