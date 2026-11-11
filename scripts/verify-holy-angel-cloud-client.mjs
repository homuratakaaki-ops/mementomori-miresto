import assert from 'node:assert/strict';
import {SyncError} from '../js/holy-angel-cloud-client.mjs';
assert.equal(new SyncError('conflict','競合').code,'conflict');

import {readHolyAngelRemote,saveHolyAngelRemote} from '../js/holy-angel-cloud-client.mjs';
const baseUrl='https://test.example',id='w'.repeat(24),token='T'.repeat(43);
const response=(payload,status=200)=>async()=>new Response(JSON.stringify(payload),{status});
let checks=1;
await assert.rejects(readHolyAngelRemote({baseUrl,id,token,fetchImpl:response({},200)}),{code:'invalid'});checks++;
await assert.rejects(readHolyAngelRemote({baseUrl,id,token,fetchImpl:response({},403)}),{code:'http-403'});checks++;
await assert.rejects(saveHolyAngelRemote({baseUrl,id,token,document:{},remoteRevision:0,fetchImpl:response({},200)}),{code:'invalid'});checks++;
await assert.rejects(readHolyAngelRemote({baseUrl:'http://test.example',id,token,fetchImpl:response({},200)}),{code:'invalid'});checks++;
await assert.rejects(readHolyAngelRemote({baseUrl,id,token,fetchImpl:async()=>{throw Error('offline')}}),{code:'offline'});checks++;

// Valid v3 document and an in-memory transport simulating two devices.
const {createCombinedWorkspace}=await import('../js/holy-angel-combined-workspace.mjs');
const plan={version:1,plans:[{equipmentId:'armA',name:'腕',slot:'arm',current:'240',target:'280',steps:''}],partsBySlot:{arm:0,feet:0,accessory:0,head:0,body:0},ownedRelics:{chalice:0,medal:0,wing:0,fruit:0},settings:{tickets:0,startAt:'2026-10-11T18:30',usedToday:false,strategy:'complete-cycle',roundsPerWeek:3,weeks:4,gauge:0,selected:'none',freeSwitches:1,abandon:false}};
let stored=createCombinedWorkspace({planV1:plan}),revision=0,writes=0;
const transport=async(url,options)=>{
  assert.equal(url,'https://test.example/api/v1/workspaces/'+id);checks++;
  assert.equal(options.headers.Authorization,'Bearer '+token);checks++;
  if(options.method==='GET')return new Response(JSON.stringify({document:stored,remoteRevision:revision}),{status:200});
  const data=JSON.parse(options.body);
  if(data.expectedRevision!==revision)return new Response('{}',{status:409});
  stored=structuredClone(data.document);revision++;writes++;
  return new Response(JSON.stringify({remoteRevision:revision}),{status:200});
};
const deviceA=await readHolyAngelRemote({baseUrl,id,token,fetchImpl:transport});
const deviceB=await readHolyAngelRemote({baseUrl,id,token,fetchImpl:transport});
assert.deepEqual(deviceA.document,stored);checks++;
const edited=structuredClone(deviceA.document);edited.revision++;
const saved=await saveHolyAngelRemote({baseUrl,id,token,document:edited,remoteRevision:deviceA.remoteRevision,fetchImpl:transport});
assert.equal(saved.remoteRevision,1);checks++;
await assert.rejects(saveHolyAngelRemote({baseUrl,id,token,document:deviceB.document,remoteRevision:deviceB.remoteRevision,fetchImpl:transport}),{code:'conflict'});checks++;
assert.equal(writes,1);checks++;
const restored=await readHolyAngelRemote({baseUrl,id,token,fetchImpl:transport});
assert.deepEqual(restored.document,edited);checks++;
assert.equal(restored.remoteRevision,1);checks++;
assert.deepEqual(deviceB.document,createCombinedWorkspace({planV1:plan}));checks++;

console.log('PASS '+checks+' cloud client isolated checks, offline only');

