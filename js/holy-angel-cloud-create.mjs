// Isolated workspace creation, disabled unless explicitly configured for testing.
import {serializeCombinedWorkspace} from './holy-angel-combined-workspace.mjs';
const encoder=new TextEncoder();
const randomId=()=>{const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');};
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
const reply=(body,status)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
export async function createHolyAngelTestWorkspace(request,env){
  if(env?.HOLY_ANGEL_TEST_CREATE_ENABLED!=='true')return reply({error:'新規作成は停止しています'},503);
  if(request.method!=='POST')return reply({error:'操作できません'},405);
  if(!env.DB||!env.TURNSTILE_SECRET)return reply({error:'安全設定が不足しています'},503);
  const expectedOrigin=env.HOLY_ANGEL_ALLOWED_ORIGIN;
  if(!expectedOrigin||request.headers.get('Origin')!==expectedOrigin)return reply({error:'許可されていない接続元です'},403);
  if(Number(request.headers.get('content-length'))>68000)return reply({error:'データが大きすぎます'},413);
  let body;
  try{const raw=await request.text();if(encoder.encode(raw).byteLength>68000)return reply({error:'データが大きすぎます'},413);body=JSON.parse(raw);}
  catch{return reply({error:'データの形式が不正です'},400);}
  if(typeof body?.challenge!=='string'||body.challenge.length>2048)return reply({error:'本人確認が必要です'},400);
  let documentJson;
  try{documentJson=serializeCombinedWorkspace(body.document);}
  catch{return reply({error:'保存データが不正です'},400);}
  let valid=false;
  try{
    const data=new FormData();data.set('secret',env.TURNSTILE_SECRET);data.set('response',body.challenge);
    const verification=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',body:data});
    valid=verification.ok&&(await verification.json())['success']===true;
  }catch{return reply({error:'本人確認を完了できませんでした'},503);}
  if(!valid)return reply({error:'本人確認ができませんでした'},403);
  // Atomic lifetime cap for the isolated test DB (fail closed if quota table is missing).
  // No reset operation: this deliberately limits all test workspace creations to 25.
  // Quota enforcement is a database trigger on workspaces INSERT.
  // Both the insert and quota increment commit or roll back together.
  const id=randomId(),token=randomId(),hash=await digest(token);
  try{
    const result=await env.DB.prepare('INSERT INTO workspaces(id,edit_token_hash,document_json,remote_revision,created_at,updated_at) VALUES(?,?,?,0,?,?)').bind(id,hash,documentJson,new Date().toISOString(),new Date().toISOString()).run();
    if(result.meta?.changes!==1)return reply({error:'保存できませんでした'},503);
  }catch{return reply({error:'保存できませんでした（上限またはDBエラー）'},503);}
  return reply({id,token,remoteRevision:0},201);
}
