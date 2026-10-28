/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAIProvider } from '../src/providers/openai';
import { AnthropicProvider } from '../src/providers/anthropic';
import { GeminiProvider } from '../src/providers/gemini';
import { OllamaProvider } from '../src/providers/ollama';
import { BudgetTracker } from '../src/storage/budgetTracker';
import { maskApiKey } from '../src/middleware/auth';
import { logRequest } from '../src/middleware/logging';
import { AuditLogStorage } from '../src/storage/auditLog';
import { parseProviderResponse } from '../src/proxy/request';

const request={model:'gpt-4o-mini',messages:[],stream:false,metadata:{}};
beforeEach(()=>{BudgetTracker.resetInMemoryState();vi.spyOn(console,'log').mockImplementation(()=>{})});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks()});
describe('independent review boundary regressions',()=>{
 for(const n of [-1000,0.5,Number.MAX_SAFE_INTEGER+1])it('rejects malformed token count '+n+' in every actual completion adapter',async()=>{
  const providers=[
   [new OpenAIProvider('synthetic','https://audit.invalid'),{model:'gpt-4o-mini',usage:{prompt_tokens:n,completion_tokens:0,total_tokens:n}}],
   [new AnthropicProvider('synthetic','https://audit.invalid'),{usage:{input_tokens:n,output_tokens:0}}],
   [new GeminiProvider('synthetic','https://audit.invalid'),{usageMetadata:{promptTokenCount:n,candidatesTokenCount:0,totalTokenCount:n}}],
   [new OllamaProvider('synthetic','https://audit.invalid'),{prompt_eval_count:n,eval_count:0}],
  ] as const;
  for(const [provider,payload]of providers){vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify(payload))));const r=await provider.complete(request);expect(r.usageKnown).toBe(false);expect(r.usage).toEqual({promptTokens:0,completionTokens:0,totalTokens:0})}
 });
 it('does not call malformed final streaming counts measured',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('data: '+JSON.stringify({model:'gpt-4o-mini',choices:[],usage:{prompt_tokens:-1000,completion_tokens:0,total_tokens:-1000}})+'\n\ndata: [DONE]\n\n')));
  const out=[];for await(const c of new OpenAIProvider('synthetic','https://audit.invalid').streamComplete({...request,stream:true}))out.push(c);
  expect(out[0].usageKnown).toBe(false);expect(out[0].usage.promptTokens).toBe(0);
 });
 for(const cost of [-1,NaN,Infinity])it('retains an uncertainty hold for invalid settlement '+cost,async()=>{
  const b=new BudgetTracker('redis://127.0.0.1:0');vi.spyOn(b as any,'getClient').mockResolvedValue(null);await b.setBudget('review',10);await b.reserve('review','attempt',2);await b.settle('review','attempt',cost);
  expect(await b.getBudgetStatus('review')).toMatchObject({used:0,reserved:2,remaining:8});
 });
 it('preserves explicit measured zero while exposing unavailable usage and pricing',()=>{
  const base:any={id:'synthetic',model:'gpt-4o-mini',provider:'openai',choices:[],usage:{promptTokens:0,completionTokens:0,totalTokens:0}};
  const route:any={fallbackUsed:false};
  expect(parseProviderResponse({...base,usageKnown:false},route,Date.now())).toMatchObject({usageKnown:false,costBasis:'unknown'});
  expect(parseProviderResponse({...base,usageKnown:true},route,Date.now())).toMatchObject({usageKnown:true,costBasis:'measured'});
  expect(parseProviderResponse({...base,usageKnown:true,model:'unpriced-review-model'},route,Date.now())).toMatchObject({usageKnown:true,costBasis:'unknown'});
 });
 it('redacts short and normal credentials in logs, actual SQLite storage and legacy reads',async()=>{
  const keys=['x','eightchr','a-long-synthetic-credential'];const store=new AuditLogStorage(':memory:');
  for(const [i,key]of keys.entries()){
   expect(maskApiKey(key)).not.toContain(key);
   logRequest({requestId:'audit',timestamp:'audit',apiKey:key,apiKeyName:'safe-label',messages:[],stream:false}as any);
   const logged=JSON.parse((console.log as any).mock.calls.at(-1)[0]);expect(logged.apiKey).not.toContain(key);expect(logged.apiKeyName).toBe('safe-label');
   await store.write({id:String(i),timestamp:'2026-10-28T00:00:00Z',apiKey:key,apiKeyName:'safe-label',accountId:'safe-account',model:'gpt-4o-mini',provider:'openai',inputTokens:0,outputTokens:0,costUsd:0,latencyMs:0,status:'error',cacheHit:false,fallbackUsed:false});
  }
  const db=(store as any).db;expect(db).not.toBeNull();
  expect(db.prepare('SELECT api_key FROM audit_log').all().every((r:any)=>!keys.includes(r.api_key))).toBe(true);
  db.prepare('UPDATE audit_log SET api_key=? WHERE id=?').run(keys[1],'1');
  expect((await store.query({})).every(r=>!keys.includes(r.apiKey))).toBe(true);
  expect(maskApiKey('')).toBe('[missing]');store.close();
 });
});
