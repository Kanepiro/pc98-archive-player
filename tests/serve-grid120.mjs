import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const root=resolve(process.env.DIST||'dist'),fixtures=resolve('validation/fixtures');
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.css':'text/css','.json':'application/json','.otf':'font/otf','.png':'image/png','.mp4':'video/mp4','.webm':'video/webm'};
createServer(async(req,res)=>{try{
 const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 const base=path.startsWith('/__')?fixtures:root,target=resolve(base,'.'+(path==='/'?'/index.html':path));
 if(!target.startsWith(base+'/'))throw Error('Path');
 const b=await readFile(target);res.writeHead(200,{'Content-Type':mime[extname(target)]||'application/octet-stream','Cache-Control':'no-store','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'});res.end(b);
}catch{res.writeHead(404);res.end('Missing');}}).listen(Number(process.env.PORT||4197),'127.0.0.1');
