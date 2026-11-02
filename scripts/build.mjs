import {cp,mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const sources=['src/mms/core.hpp','src/mms/engine.hpp','src/mms/bridge.cpp'];
const hash=createHash('sha256');for(const f of sources)hash.update(await readFile(f));
const expected=(await readFile('src/mms/wasm-source.sha256','utf8')).trim();
if(hash.digest('hex')!==expected)throw Error('MMS sources changed: run npm run build:wasm with Emscripten 3.1.69 before committing.');
await mkdir('dist',{recursive:true});await cp('public','dist',{recursive:true});
await cp('licenses','dist/licenses',{recursive:true});await cp('LICENSE','dist/LICENSE');
async function walk(dir,prefix=''){const a=[];for(const e of await readdir(dir,{withFileTypes:true})){if(e.isDirectory())a.push(...await walk(dir+'/'+e.name,prefix+e.name+'/'));else if(e.name!=='sw.js')a.push(prefix+e.name);}return a;}
const names=(await walk('dist')).sort();
const digest=createHash('sha256');for(const name of names)digest.update(await readFile('dist/'+name));
const version=digest.digest('hex').slice(0,16);
await writeFile('dist/sw.js',`const CACHE='pc98-${version}',ASSETS=${JSON.stringify(['/',...names.map(n=>'/'+n)])};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('pc98-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('message',event=>{if(event.data?.type==='activate')self.skipWaiting();});
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
 event.respondWith(caches.open(CACHE).then(async cache=>(await cache.match(event.request))||fetch(event.request)));
});\n`);
console.log('Built '+names.length+' assets, cache '+version);
