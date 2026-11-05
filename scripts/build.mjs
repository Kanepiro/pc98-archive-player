import {cp,mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {createHash} from 'node:crypto';
const sources=['src/mms/core.hpp','src/mms/engine.hpp','src/mms/bridge.cpp'];
const hash=createHash('sha256');for(const f of sources)hash.update(await readFile(f));
const expected=(await readFile('src/mms/wasm-source.sha256','utf8')).trim();
if(hash.digest('hex')!==expected)throw Error('MMS sources changed: run npm run build:wasm with Emscripten 3.1.69 before committing.');
await mkdir('dist',{recursive:true});await cp('public','dist',{recursive:true});
await cp('licenses','dist/licenses',{recursive:true});await cp('LICENSE','dist/LICENSE');
// Bundle the exporter and its AAC fallback locally for offline use; keep license notices.
await build({entryPoints:['public/mp4-export.js'],outfile:'dist/mp4-export.js',platform:'browser',format:'esm',bundle:true,minify:true,legalComments:'eof'});
await cp('node_modules/mediabunny/LICENSE','dist/licenses/mediabunny.txt');
await cp('node_modules/@mediabunny/aac-encoder/LICENSE','dist/licenses/mediabunny-aac-encoder.txt');
await cp('node_modules/@mediabunny/aac-encoder/licenses/ffmpeg','dist/licenses/ffmpeg-aac',{recursive:true});
async function walk(dir,prefix=''){const a=[];for(const e of await readdir(dir,{withFileTypes:true})){if(e.isDirectory())a.push(...await walk(dir+'/'+e.name,prefix+e.name+'/'));else if(e.name!=='sw.js')a.push(prefix+e.name);}return a;}
const names=(await walk('dist')).sort();
const digest=createHash('sha256');for(const name of names)digest.update(await readFile('dist/'+name));
const version=digest.digest('hex').slice(0,16);
await writeFile('dist/sw.js',`const CACHE='pc98-${version}',ASSETS=${JSON.stringify(['/',...names.map(n=>'/'+n)])};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS.map(asset=>asset+'?__pc98=${version}'))).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('pc98-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('message',event=>{if(event.data?.type==='activate')self.skipWaiting();});
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE);
  if(event.request.mode==='navigate'){
   try{const response=await fetch(event.request);if(response.ok)cache.put(event.request,response.clone());return response;}
   catch(e){const cached=await cache.match(event.request,{ignoreSearch:true})||await cache.match('/');if(cached)return cached;throw e;}
  }
  // Installed assets are versioned; query-free requests use that exact build.
  // Query-bearing requests prefer network to avoid mixing old/new entry modules.
  const hasQuery=new URL(event.request.url).search.length>0;
  const cached=await cache.match(event.request,{ignoreSearch:!hasQuery});
  if(cached)return cached;
  try{return await fetch(event.request);}
  catch(e){
   // Versioned entry scripts are available offline through their cached base path.
   const fallback=await cache.match(event.request,{ignoreSearch:true});
   if(fallback)return fallback;
   throw e;
  }
 })());
});\n`);
console.log('Built '+names.length+' assets, cache '+version);