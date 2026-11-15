import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join,resolve} from 'node:path';
const app=resolve(process.env.APP||'candidate'),out=resolve('native-validation');
await mkdir(out,{recursive:true});
const meta=JSON.parse(await readFile(join(app,'app/mode4-atlas.json'),'utf8')),chars=meta.glyphs,masks=await readFile(join(app,'app/mode4-atlas.bin'));
const parts=[Buffer.from('1.08\r\n1\r\n20\r\n17\r\n1\r\n-1\r\nGrid120 test\r\n# TASL_MODE4_CELL120\r\n# TASL_MODE4_TIMING 5 0.2\r\n\f\r\n1 12\r\n0 0\r\n\f\r\n')];
for(let y=0;y<17;y++){for(let x=0;x<10;x++)parts.push(Buffer.from(chars[y*10+x].cp932));parts.push(Buffer.from('\r\n'));}
parts.push(Buffer.from('\f\r\n\x1a'));
const file=join(out,'all170.TSL');await writeFile(file,Buffer.concat(parts));
const W=1200,H=2040,expected=Buffer.alloc(W*H*4);
for(let g=0;g<170;g++)for(let y=0;y<120;y++)for(let x=0;x<120;x++){
 const ink=masks[g*14400+y*120+x],p=(((g/10|0)*120+y)*W+(g%10)*120+x)*4;
 for(let c=0;c<3;c++)expected[p+c]=Math.round(([18,13,8][c]*(255-ink)+[232,244,227][c]*ink)/255);
}
const runs=[];
for(const exe of ['tsl_render.exe','tsl_render_gpu.exe']){
 const r=spawnSync(join(app,exe),['--input',file,'--fps','5'],{maxBuffer:32*1024*1024,timeout:120000});
 assert.equal(r.status,0,r.stderr?.toString());assert.equal(r.stdout.length,expected.length);
 let different=0,maxError=0;for(let p=0;p<expected.length;p++)if(p%4!==3){const d=Math.abs(expected[p]-r.stdout[p]);if(d)different++;maxError=Math.max(maxError,d);}
 assert.equal(maxError,0,exe+' must use the canonical Noto raster exactly');
 await writeFile(join(out,exe+'.bgra'),r.stdout);
 runs.push({exe,bytes:r.stdout.length,differentRGBBytes:different,maxError,log:r.stderr.toString()});
}
const ff=spawnSync(join(app,'ffmpeg.exe'),['-v','error','-y','-f','rawvideo','-pixel_format','bgr0','-video_size','1200x2040','-framerate','5','-i',join(out,'tsl_render_gpu.exe.bgra'),'-c:v','h264_nvenc','-pix_fmt','yuv420p',join(out,'all170-nvenc.mp4')],{timeout:120000});
const nvenc=ff.status===0,nvencError=ff.stderr?.toString();
if(!nvenc){const cpu=spawnSync(join(app,'ffmpeg.exe'),['-v','error','-y','-f','rawvideo','-pixel_format','bgr0','-video_size','1200x2040','-framerate','5','-i',join(out,'tsl_render_gpu.exe.bgra'),'-c:v','libx264','-pix_fmt','yuv420p',join(out,'all170-cpu.mp4')],{timeout:120000});assert.equal(cpu.status,0,cpu.stderr?.toString());}
await writeFile(join(out,'native-report.json'),JSON.stringify({runs,nvenc,nvencError,fontSHA256:meta.fontSHA256},null,2));console.log(JSON.stringify({runs,nvenc,nvencError}));
