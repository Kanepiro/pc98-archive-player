import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const root=resolve('dist'),mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'};
createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost'),path=resolve(root,'.'+decodeURIComponent(url.pathname)),file=path===root?root+'/index.html':path;
 if(!file.startsWith(root+'/'))throw Error('Invalid path');const b=await readFile(file);
 res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(b);
}catch{res.writeHead(404);res.end('Not found');}}).listen(Number(process.env.PORT||4173),'127.0.0.1',()=>console.log('http://127.0.0.1:'+(process.env.PORT||4173)));
