import assert from 'node:assert/strict';
import {handleHolyAngelApi} from '../js/holy-angel-cloud-api.mjs';
const base='https://example.test/api/v1/workspaces/'+'w'.repeat(24);
const token='T'.repeat(43);
const req=(method,url=base,body,authorization='Bearer '+token)=>new Request(url,{method,headers:{Authorization:authorization,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
let passed=0;
async function check(name,request,env,expected){const r=await handleHolyAngelApi(request,env);assert.equal(r.status,expected,name);passed++;}
const row={document_json:'{"schemaVersion":3}',remote_revision:4};
const db={prepare(sql){return {bind(...args){return {async first(){return row;},async run(){return {meta:{changes:0}};}}}}}};
await check('unknown route',req('GET','https://example.test/no'),{DB:db},404);
await check('short ID',req('GET',base.slice(0,-15)),{DB:db},404);
await check('create disabled',req('POST'),{DB:db},405);
await check('delete disabled',req('DELETE'),{DB:db},405);
await check('no database',req('GET'),{},503);
await check('missing token',req('GET',base,undefined,''),{DB:db},404);
await check('malformed token',req('GET',base,undefined,'Bearer abc'),{DB:db},404);
await check('read only',req('GET'),{DB:db},200);
await check('invalid expectedRevision',req('PUT',base,{expectedRevision:-1,document:{}}),{DB:db},400);
await check('invalid document',req('PUT',base,{expectedRevision:4,document:{}}),{DB:db},400);
const missing={prepare(){return {bind(){return {async first(){return null;}};}}}};
await check('incorrect token hash',req('GET'),{DB:missing},404);
const failing={prepare(){throw new Error('secret internal DB error');}};
const fail=await handleHolyAngelApi(req('GET'),{DB:failing});
assert.equal(fail.status,503);assert.doesNotMatch(await fail.text(),/secret internal/);passed++;

// Stateful DB imitation: confirm successful GET/PUT, stale revision 409, and data retained.
const {createCombinedWorkspace}=await import('../js/holy-angel-combined-workspace.mjs');
const plan={version:1,plans:[],partsBySlot:{arm:0,feet:0,accessory:0,head:0,body:0},ownedRelics:{chalice:0,medal:0,wing:0,fruit:0},settings:{tickets:0,startAt:'2026-10-11T18:30',usedToday:false,strategy:'complete-cycle',roundsPerWeek:3,weeks:4,gauge:0,selected:'none',freeSwitches:1,abandon:false}};
const initial=createCombinedWorkspace({planV1:plan});
let saved=JSON.stringify(initial),remote=0,writes=0;
const stateDb={prepare(sql){return {bind(...args){return {
 async first(){return {document_json:saved,remote_revision:remote};},
 async run(){if(remote!==args[4])return {meta:{changes:0}};saved=args[0];remote++;writes++;return {meta:{changes:1}};}
};}}}};
const getSaved=async()=>handleHolyAngelApi(req('GET'),{DB:stateDb});
const first=await getSaved();assert.equal(first.status,200);passed++;
const before=await first.json();assert.equal(before.remoteRevision,0);passed++;
const edit={...before.document,revision:before.document.revision+1};
const put=(rev,doc)=>handleHolyAngelApi(req('PUT',base,{expectedRevision:rev,document:doc}),{DB:stateDb});
const okay=await put(0,edit);assert.equal(okay.status,200);passed++;
assert.equal((await okay.json()).remoteRevision,1);passed++;
const stale=await put(0,before.document);assert.equal(stale.status,409);passed++;
assert.equal(writes,1);passed++;
const after=await getSaved();assert.equal(after.status,200);passed++;
const latest=await after.json();assert.deepEqual(latest.document,edit);passed++;
assert.equal(latest.remoteRevision,1);passed++;

console.log('PASS '+passed+' cloud API isolated contract smoke checks (no real D1)');
