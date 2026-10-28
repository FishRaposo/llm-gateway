/* eslint-disable @typescript-eslint/no-explicit-any */
import {describe,it,expect,afterEach} from 'vitest';
import Redis from 'ioredis';
import {randomUUID} from 'node:crypto';
import {BudgetTracker} from '../../src/storage/budgetTracker';
import {CacheStore} from '../../src/storage/cacheStore';
const url=process.env.GATEWAY_TEST_REDIS_URL;
if(!url||!/^redis:\/\/127\.0\.0\.1:\d+\/?$/.test(url))throw new Error('Set GATEWAY_TEST_REDIS_URL to a disposable loopback Redis instance; no production database is accepted');
const connections:Array<{close:()=>Promise<unknown>}>=[];
afterEach(async()=>{for(const c of connections.splice(0))await c.close()});
describe('actual Redis accounting and cache boundaries',()=>{
 it('establishes a real strict connection and persists admission through another tracker',async()=>{
  const a=new BudgetTracker(url!,Infinity,true),b=new BudgetTracker(url!,Infinity,true);connections.push(a,b);const id=randomUUID();
  await a.setBudget(id,10);expect((await a.reserve(id,'attempt',3)).allowed).toBe(true);
  expect(await b.getBudgetStatus(id)).toMatchObject({used:0,reserved:3,remaining:7});
 });
 for(const method of ['getBudgetStatus','getRemainingBudget'] as const)it(method+' cannot overwrite a concurrent actual Lua settlement',async()=>{
  const r=new Redis(url!,{maxRetriesPerRequest:1});const t=new BudgetTracker(url!,Infinity,true);(t as any).client=r;connections.push(t);
  const id=randomUUID();await t.setBudget(id,10);await t.reserve(id,'attempt',2);
  const get=r.get.bind(r),evalCommand=r.eval.bind(r);let ready!:()=>void,proceed!:()=>void,delayed=false;
  const read=new Promise<void>(s=>ready=s),gate=new Promise<void>(s=>proceed=s);
  async function pause(value:any){if(!delayed){delayed=true;ready();await gate}return value}
  r.get=(async(...args:any[])=>pause(await (get as any)(...args))) as any;
  r.eval=(async(...args:any[])=>{const value=await(evalCommand as any)(...args);return String(args[0]).includes('if not raw then return false end')?pause(value):value}) as any;
  const pending=t[method](id);await read;await t.settle(id,'attempt',3);proceed();await pending;r.get=get;r.eval=evalCommand;
  expect(await t.getBudgetStatus(id)).toMatchObject({used:3,reserved:0,remaining:7});
 });
 it('writes cache data into actual Redis instead of silently using process memory',async()=>{
  const c=new CacheStore(url!),r=new Redis(url!,{maxRetriesPerRequest:1});connections.push(c,{close:()=>r.quit()});const key='audit-cache:'+randomUUID();
  await c.set(key,{response:{synthetic:true},timestamp:1},60);expect(await r.get(key)).toContain('synthetic');
 });
});
