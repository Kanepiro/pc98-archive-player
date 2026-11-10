// Persist small batches of converted ASCII frames. Source videos remain on-device
// and are never copied into IndexedDB (they can be up to 2 GiB).
const DB_NAME='pc98-tsl-checkpoint-v1',KEY='current';
function openDb(){
 return new Promise((resolve,reject)=>{
  if(!('indexedDB' in globalThis)){reject(Error('IndexedDBを利用できません'));return;}
  const request=indexedDB.open(DB_NAME,2);
  request.onupgradeneeded=()=>{
   const db=request.result;
   if(!db.objectStoreNames.contains('job'))db.createObjectStore('job',{keyPath:'key'});
   if(!db.objectStoreNames.contains('chunks'))db.createObjectStore('chunks',{keyPath:'start'});
   if(!db.objectStoreNames.contains('state'))db.createObjectStore('state',{keyPath:'key'});
  };
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error||Error('保存領域を開けません'));
  request.onblocked=()=>reject(Error('別のタブで保存領域を使用中です'));
 });
}
async function transact(mode,enqueue){
 const db=await openDb();
 return new Promise((resolve,reject)=>{
  let value,done=false;
  const tx=db.transaction(['job','chunks','state'],mode);
  const fail=()=>{if(done)return;done=true;db.close();reject(tx.error||Error('途中保存に失敗しました'));};
  tx.onerror=fail;tx.onabort=fail;
  tx.oncomplete=()=>{if(done)return;done=true;db.close();resolve(value);};
  try{enqueue(tx,result=>{value=result;});}catch(e){tx.abort();if(!done){done=true;db.close();reject(e);}}
 });
}
export function fileIdentity(file){
 // Android file pickers may assign a fresh lastModified when reopening the same video.
 // SHA-256 samples are checked before any saved frames are actually reused.
 return JSON.stringify([file.name,file.size]);
}
export async function fingerprint(file){
 // Matching names/timestamps are not sufficient when a video has been replaced.
 const n=Math.min(65536,file.size);
 const first=new Uint8Array(await file.slice(0,n).arrayBuffer());
 const middle=new Uint8Array(await file.slice(Math.max(0,Math.floor(file.size/2)-Math.floor(n/2)),Math.floor(file.size/2)+Math.ceil(n/2)).arrayBuffer());
 const last=new Uint8Array(await file.slice(Math.max(0,file.size-n)).arrayBuffer());
 const sample=new Uint8Array(first.length+middle.length+last.length);
 sample.set(first);sample.set(middle,first.length);sample.set(last,first.length+middle.length);
 const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',sample));
 return [...hash].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export function readCheckpointSummary(){
 return transact('readonly',(tx,set)=>{
  tx.objectStore('job').get(KEY).onsuccess=e=>set(e.target.result||null);
 });
}
export function readCheckpoint(){
 return transact('readonly',(tx,set)=>{
  let job=null,chunks=null,qualityState=null,loadedState=false;
  const report=()=>{if(chunks!==null&&loadedState)set(job?{job,chunks,qualityState}:null);};
  tx.objectStore('job').get(KEY).onsuccess=e=>{job=e.target.result||null;report();};
  tx.objectStore('chunks').getAll().onsuccess=e=>{chunks=e.target.result;report();};
  tx.objectStore('state').get(KEY).onsuccess=e=>{
   qualityState=e.target.result?.value||null;loadedState=true;report();
  };
 });
}
export function beginCheckpoint(job){
 return transact('readwrite',tx=>{
  tx.objectStore('chunks').clear();tx.objectStore('state').clear();
  tx.objectStore('job').put({...job,key:KEY,done:0});
 });
}
export function appendCheckpoint(job,start,parts,qualityState=null){
 if(!parts.length)return Promise.resolve();
 return transact('readwrite',tx=>{
  const store=tx.objectStore('job');
  store.get(KEY).onsuccess=e=>{
   const active=e.target.result;
   if(!active||active.id!==job.id||active.done!==start){tx.abort();return;}
   tx.objectStore('chunks').put({start,count:parts.length,blob:new Blob(parts,{type:'application/octet-stream'})});
   if(qualityState)tx.objectStore('state').put({key:KEY,value:qualityState});
   store.put({...active,done:start+parts.length,updatedAt:Date.now()});
  };
 });
}
export function deleteCheckpoint(){
 return transact('readwrite',tx=>{
  tx.objectStore('chunks').clear();tx.objectStore('state').clear();tx.objectStore('job').delete(KEY);
 });
}
