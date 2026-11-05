import {spawnSync} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
await mkdir('verification/private',{recursive:true});
const cases=[
 ['short.mp4','160x90',30,2.033,['-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart']],
 ['350frames.mp4','160x90',5,35,['-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart']],
 ['long.mp4','160x90',1,600,['-c:v','libx264','-g','1','-pix_fmt','yuv420p','-movflags','+faststart']],
 ['portrait.webm','90x160',10,1,['-c:v','libvpx-vp9']]
];
for(const [name,size,rate,duration,codec]of cases){
 const r=spawnSync('ffmpeg',['-v','error','-y','-f','lavfi','-i',`testsrc2=size=${size}:rate=${rate}`,'-t',String(duration),...codec,'verification/private/'+name],{stdio:'inherit'});
 if(r.error||r.status!==0)throw r.error||Error('ffmpeg failed: '+name);
}
console.log('Created four synthetic video fixtures (no archived artwork).');
