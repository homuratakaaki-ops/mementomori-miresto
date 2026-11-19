// Offline contract simulation, NOT the Cloudflare Worker nor a D1 integration test.
// Demonstrates the outcomes the future server must produce, including conflicts.
import assert from 'node:assert/strict';

const MAX_BYTES=64000;
const records=new Map();
let checks=0;
function eq(actual,expected,label){assert.deepEqual(actual,expected,label);checks++;}
function utf8(text){return Buffer.byteLength(text,'utf8');}
function create(id,token,doc){
  if(records.has(id))return {status:409};
  const json=JSON.stringify(doc);
  if(utf8(json)>MAX_BYTES)return {status:413};
  records.set(id,{token,remoteRevision:0,document:json,deleted:false});
  return {status:201,remoteRevision:0};
}
function read(id,token){
  const row=records.get(id);
  if(!row||row.deleted||row.token!==token)return {status:404};
  return {status:200,remoteRevision:row.remoteRevision,document:JSON.parse(row.document)};
}
function save(id,token,expectedRevision,doc,{outage=false}={}){
  if(outage)return {status:503};
  const row=records.get(id);
  if(!row||row.deleted||row.token!==token)return {status:404};
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)return {status:400};
  const json=JSON.stringify(doc);
  if(utf8(json)>MAX_BYTES)return {status:413};
  if(row.remoteRevision!==expectedRevision)return {status:409,serverRevision:row.remoteRevision};
  // Mock represents ONE atomic UPDATE ... WHERE remote_revision = expectedRevision.
  // The actual D1 SQL atomicity, permission checks and concurrent writes
  // MUST be tested separately against a live test D1 database.
  row.document=json;row.remoteRevision++;
  return {status:200,remoteRevision:row.remoteRevision};
}
function revoke(id,token,expectedRevision){
  const row=records.get(id);
  if(!row||row.deleted||row.token!==token)return {status:404};
  if(row.remoteRevision!==expectedRevision)return {status:409};
  row.deleted=true;return {status:204};
}
const id='mock-workspace',owner='test-owner-token',stranger='wrong-token';
const doc={schemaVersion:3,revision:0,planData:{plans:[]},actualData:null};
eq(create(id,owner,doc),{status:201,remoteRevision:0},'create one workspace');
eq(create(id,owner,doc).status,409,'cannot create duplicate workspace');
eq(read(id,stranger).status,404,'wrong token cannot read');
eq(save(id,stranger,0,doc).status,404,'wrong token cannot overwrite');
eq(read(id,owner).remoteRevision,0,'initial remote revision zero');
const first=read(id,owner),second=read(id,owner);
const a={...first.document,revision:1,planData:{plans:['new']}};
eq(save(id,owner,first.remoteRevision,a).status,200,'device A saved');
const staleDoc={...second.document,revision:1,planData:{plans:['stale']}};
const fail=save(id,owner,second.remoteRevision,staleDoc);
eq(fail.status,409,'device B stale write is rejected');
eq(fail.serverRevision,1,'server revision returned for conflict');
eq(read(id,owner).document.planData.plans,['new'],'device A change preserved');
eq(staleDoc.planData.plans,['stale'],'device B unsynced change preserved locally');
eq(save(id,owner,1,{value:'猫'.repeat(22000)}).status,413,'UTF-8 over 64,000 bytes rejected');
eq(save(id,owner,1,{value:1},{outage:true}).status,503,'outage does not acknowledge save');
eq(read(id,owner).remoteRevision,1,'failed save did not modify revision');
eq(read(id,owner).document.planData.plans,['new'],'outage did not destroy saved value');
eq(save(id,owner,1,{...a,revision:3}).remoteRevision,2,'remote rev independent from local doc rev');
eq(revoke(id,stranger,2).status,404,'wrong token cannot revoke');
eq(revoke(id,owner,0).status,409,'stale deletion blocked');
eq(revoke(id,owner,2).status,204,'authorized current deletion');
eq(read(id,owner).status,404,'revoked link not readable');
eq(save(id,owner,2,a).status,404,'revoked link cannot update');
console.log('PASS '+checks+' MOCK cloud-sync contract checks (no Cloudflare/D1 access)');
