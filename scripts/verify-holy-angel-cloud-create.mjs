import assert from 'node:assert/strict';
import {createHolyAngelTestWorkspace} from '../js/holy-angel-cloud-create.mjs';
const request=new Request('https://example.test/api/v1/workspaces',{method:'POST',headers:{Origin:'https://example.test','content-type':'application/json'},body:JSON.stringify({challenge:'dummy',document:{}})});
let checks=0;
const test=async(env,status)=>{const r=await createHolyAngelTestWorkspace(request,env);assert.equal(r.status,status);checks++;};
await test({},503);
await test({HOLY_ANGEL_TEST_CREATE_ENABLED:'false'},503);
await test({HOLY_ANGEL_TEST_CREATE_ENABLED:'true'},503);
await test({HOLY_ANGEL_TEST_CREATE_ENABLED:'true',DB:{},TURNSTILE_SECRET:'dummy',HOLY_ANGEL_ALLOWED_ORIGIN:'https://other.test'},403);
await test({HOLY_ANGEL_TEST_CREATE_ENABLED:'true',DB:{},TURNSTILE_SECRET:'dummy',HOLY_ANGEL_ALLOWED_ORIGIN:'https://example.test'},400);
const {createCombinedWorkspace}=await import('../js/holy-angel-combined-workspace.mjs');
const plan={version:1,plans:[{equipmentId:'armA',name:'腕',slot:'arm',current:'240',target:'280',steps:''}],partsBySlot:{arm:0,feet:0,accessory:0,head:0,body:0},ownedRelics:{chalice:0,medal:0,wing:0,fruit:0},settings:{tickets:0,startAt:'2026-10-11T18:30',usedToday:false,strategy:'complete-cycle',roundsPerWeek:3,weeks:4,gauge:0,selected:'none',freeSwitches:1,abandon:false}};
const document=createCombinedWorkspace({planV1:plan});
const validRequest=()=>new Request('https://example.test/api/v1/workspaces',{method:'POST',headers:{Origin:'https://example.test','content-type':'application/json'},body:JSON.stringify({challenge:'offline-test',document})});
const originalFetch=globalThis.fetch;
let inserted=null,quota=0;
const mockDB={prepare(sql){return {
  bind(...values){return {async run(){
    if(!sql.startsWith('INSERT INTO workspaces'))throw Error('bad SQL');
    inserted=values;
    return {meta:{changes:1}};
  }};},
  async run(){quota++;return {meta:{changes:1}};}
};}};
try{
  globalThis.fetch=async()=>new Response(JSON.stringify({success:true}),{status:200});
  const enabled={HOLY_ANGEL_TEST_CREATE_ENABLED:'true',HOLY_ANGEL_ALLOWED_ORIGIN:'https://example.test',TURNSTILE_SECRET:'test-only',DB:mockDB};
  const created=await createHolyAngelTestWorkspace(validRequest(),enabled);
  assert.equal(created.status,201);checks++;
  const credentials=await created.json();
  assert.match(credentials.id,/^[0-9a-f]{64}$/);checks++;
  assert.match(credentials.token,/^[0-9a-f]{64}$/);checks++;
  assert.notEqual(credentials.id,credentials.token);checks++;
  assert.equal(credentials.remoteRevision,0);checks++;
  assert.equal(inserted[0],credentials.id);checks++;
  assert.notEqual(inserted[1],credentials.token);checks++;
  assert.match(inserted[1],/^[0-9a-f]{64}$/);checks++;
  assert.equal(JSON.parse(inserted[2]).schemaVersion,3);checks++;
  assert.equal(quota,0);checks++;
  const next=await createHolyAngelTestWorkspace(validRequest(),enabled);
  const second=await next.json();
  assert.notEqual(second.token,credentials.token);checks++;
  globalThis.fetch=async()=>new Response(JSON.stringify({success:false}),{status:200});
  const denied=await createHolyAngelTestWorkspace(validRequest(),enabled);
  assert.equal(denied.status,403);checks++;
  assert.equal(quota,0);checks++;
}finally{globalThis.fetch=originalFetch;}

console.log('PASS '+checks+' creation safety stop tests (offline only)');
