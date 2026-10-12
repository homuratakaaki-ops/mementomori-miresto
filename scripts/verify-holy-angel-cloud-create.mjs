import assert from 'node:assert/strict';
import {createHolyAngelTestWorkspace,consumeTestCreationQuota} from '../js/holy-angel-cloud-create.mjs';
const request=new Request('https://example.test/api/v1/workspaces',{method:'POST',headers:{Origin:'https://example.test','content-type':'application/json'},body:JSON.stringify({challenge:'dummy',document:{}})});
let checks=0;
const test=async(env,status)=>{const r=await createHolyAngelTestWorkspace(request,env);assert.equal(r.status,status);checks++;};
await test({},503);
await test({HOLY_ANGEL_TEST_CREATE_ENABLED:'false'},503);
await test({HOLY_ANGEL_TEST_CREATE_ENABLED:'true'},503);
await test({HOLY_ANGEL_TEST_CREATE_ENABLED:'true',DB:{},TURNSTILE_SECRET:'dummy',HOLY_ANGEL_ALLOWED_ORIGIN:'https://other.test'},403);
await test({HOLY_ANGEL_TEST_CREATE_ENABLED:'true',DB:{},TURNSTILE_SECRET:'dummy',HOLY_ANGEL_ALLOWED_ORIGIN:'https://example.test'},400);
let used=0;
const db={prepare(query){assert.match(query,/UPDATE holy_angel_test_quota/);return {async run(){
  if(used>=25)return {meta:{changes:0}};
  used++;return {meta:{changes:1}};
}};}};
for(let i=0;i<25;i++){assert.equal(await consumeTestCreationQuota(db),true);checks++;}
assert.equal(await consumeTestCreationQuota(db),false);checks++;
assert.equal(used,25);checks++;
await assert.rejects(consumeTestCreationQuota({prepare(){throw Error('missing quota table')}}));checks++;
console.log('PASS '+checks+' creation safety stop tests (offline only)');
