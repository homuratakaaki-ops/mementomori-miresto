// Stage 14: isolated client transport only. No automatic sync or local storage writes.
import {parseCombinedWorkspace,serializeCombinedWorkspace} from './holy-angel-combined-workspace.mjs';
export class SyncError extends Error {
  constructor(code,message){ super(message); this.name='SyncError'; this.code=code; }
}
function endpoint(baseUrl,id) {
  if(!/^[A-Za-z0-9_-]{20,100}$/.test(id))throw new SyncError('invalid','編集リンクの識別番号が正しくありません');
  const url=new URL(baseUrl);
  if(url.protocol!=='https:')throw new SyncError('invalid','HTTPS接続が必要です');
  return new URL('/api/v1/workspaces/'+id,url).href;
}
function headers(token,write=false){
  if(!/^[A-Za-z0-9_-]{43,128}$/.test(token))throw new SyncError('invalid','編集リンクの秘密キーが正しくありません');
  return {'Authorization':'Bearer '+token,...(write?{'Content-Type':'application/json'}:{})};
}
async function requestSafe(fetchImpl,url,options) {
  try{return await fetchImpl(url,{...options,cache:'no-store'});}
  catch{throw new SyncError('offline','通信できません。端末のデータを残してください');}
}
export async function readHolyAngelRemote({baseUrl,id,token,fetchImpl=fetch}){
  const response=await requestSafe(fetchImpl,endpoint(baseUrl,id),{method:'GET',headers:headers(token)});
  if(!response.ok)throw new SyncError('http-'+response.status,'クラウドのデータを読み込めませんでした');
  let payload;
  try{payload=await response.json();}catch{throw new SyncError('invalid','保存データの応答が不正です');}
  if(!Number.isSafeInteger(payload?.remoteRevision)||payload.remoteRevision<0)
    throw new SyncError('invalid','クラウドの更新番号が不正です');
  let document;
  try{document=parseCombinedWorkspace(JSON.stringify(payload.document));}
  catch{throw new SyncError('invalid','クラウドの保存データが不正です');}
  return {document,remoteRevision:payload.remoteRevision};
}
export async function saveHolyAngelRemote({baseUrl,id,token,document,remoteRevision,fetchImpl=fetch}){
  if(!Number.isSafeInteger(remoteRevision)||remoteRevision<0)
    throw new SyncError('invalid','クラウドの更新番号が不正です');
  // Serialize before network send, never mutate caller's local draft.
  const safeDocument=JSON.parse(serializeCombinedWorkspace(document));
  const response=await requestSafe(fetchImpl,endpoint(baseUrl,id),{
    method:'PUT',headers:headers(token,true),
    body:JSON.stringify({expectedRevision:remoteRevision,document:safeDocument})
  });
  if(response.status===409)throw new SyncError('conflict','別の端末が先に保存しました。この端末の変更は残してください');
  if(!response.ok)throw new SyncError('http-'+response.status,'保存できませんでした。この端末の変更は残してください');
  let payload;
  try{payload=await response.json();}catch{throw new SyncError('invalid','保存完了の応答を確認できませんでした');}
  if(payload?.remoteRevision!==remoteRevision+1)
    throw new SyncError('invalid','保存完了の更新番号が一致しません');
  return {remoteRevision:payload.remoteRevision};
}
