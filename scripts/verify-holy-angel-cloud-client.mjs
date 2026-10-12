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
console.log('PASS '+checks+' cloud client isolated checks, offline only');

