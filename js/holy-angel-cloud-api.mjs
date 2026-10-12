// Stage 14: test-only read/update API. Creation/deletion deliberately disabled.
// Requires Worker bundling and DB binding; do not deploy before integration tests.
// Tokens are high-entropy bearer secrets and must never be logged.
import {serializeCombinedWorkspace} from './holy-angel-combined-workspace.mjs';
const encoder=new TextEncoder();
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
const error=(message,status)=>json({error:message},status);
const notFound=()=>error('データが見つからないか、編集権限がありません',404);
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const digest=async value=>hex(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))));
const maxBody=68000;
export async function handleHolyAngelApi(request,env){
  const url=new URL(request.url);
  const match=/^\/api\/v1\/workspaces\/([A-Za-z0-9_-]{20,100})$/.exec(url.pathname);
  if(!match)return error('未対応の操作です',404);
  if(!['GET','PUT'].includes(request.method))return error('この操作は利用できません',405);
  if(!env?.DB)return error('保存サービスの準備ができていません',503);
  const authorization=request.headers.get('Authorization')||'';
  const token=/^Bearer ([A-Za-z0-9_-]{43,128})$/.exec(authorization)?.[1];
  if(!token)return notFound();
  const id=match[1],tokenHash=await digest(token);
  try{
    const row=await env.DB.prepare('SELECT document_json,remote_revision FROM workspaces WHERE id=? AND edit_token_hash=? AND deleted_at IS NULL').bind(id,tokenHash).first();
    if(!row)return notFound();
    if(request.method==='GET')return json({document:JSON.parse(row.document_json),remoteRevision:row.remote_revision});
    const length=request.headers.get('Content-Length');
    if(length!==null&&Number(length)>maxBody)return error('データが大きすぎます',413);
    const raw=await request.text();
    if(encoder.encode(raw).byteLength>maxBody)return error('データが大きすぎます',413);
    let input;
    try{input=JSON.parse(raw);}catch{return error('データの形式が正しくありません',400);}
    if(!Number.isSafeInteger(input?.expectedRevision)||input.expectedRevision<0)return error('更新番号が正しくありません',400);
    let documentJson;
    try{documentJson=serializeCombinedWorkspace(input.document);}catch{return error('保存データの検査に失敗しました',400);}
    // Conditional SQL update, not read-then-unconditional-write.
    const result=await env.DB.prepare('UPDATE workspaces SET document_json=?,remote_revision=remote_revision+1,updated_at=? WHERE id=? AND edit_token_hash=? AND remote_revision=? AND deleted_at IS NULL').bind(documentJson,new Date().toISOString(),id,tokenHash,input.expectedRevision).run();
    if(result.meta?.changes!==1)return error('別の端末で更新されています。再読み込みして確認してください',409);
    return json({remoteRevision:input.expectedRevision+1});
  }catch{
    // Never print tokens, document contents or database error details.
    return error('保存サービスでエラーが発生しました。端末のデータを残してください',503);
  }
}
