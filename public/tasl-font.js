// Every Canvas (including export workers) uses the same bundled Regular face.
import {NOTO_RANGES} from './tasl-font-coverage.js';
export const TASL_FONT_FAMILY='TASL Noto Mono';
export const TASL_FONT_SHA256='4d01725be822d144cf9a56ade981e6fb920cd7a610b8fc24cc601a920beea5b9';
const url=new URL('./fonts/NotoSansMonoCJKjp-Regular.otf',import.meta.url).href;
// The exporter is bundled; share one state with the unbundled renderer.
const key=Symbol.for('tasl.noto.font.v1');
const state=globalThis[key]??=( {promise:null,face:null,error:null,checked:new Set()} );
function fontSet(){return globalThis.document?.fonts||globalThis.fonts;}
export function ensureTaslFont(){
 if(state.promise)return state.promise;
 state.promise=(async()=>{
  const fonts=fontSet();
  if(!fonts||typeof FontFace==='undefined')throw Error('この環境では同梱Notoフォントを読み込めません');
  // No local() source: an OS installation can never satisfy this request.
  let face=[...fonts].find(f=>f.family.replaceAll('"','').replaceAll("'","")===TASL_FONT_FAMILY);
  if(!face){face=new FontFace(TASL_FONT_FAMILY,'url("'+url+'")',{style:'normal',weight:'400',display:'block'});fonts.add(face);}
  await face.load();
  if(face.status!=='loaded')throw Error('同梱Notoフォントの読み込みが完了しませんでした');
  state.face=face;
  return face;
 })().catch(error=>{
  state.error=error;
  throw Error('Notoフォントを読み込めないため文字描画を中止しました。接続を確認して再読み込みしてください。 '+error.message);
 });
 return state.promise;
}
export function requireTaslFont(){
 if(state.face?.status!=='loaded'||!fontSet()?.has(state.face))
  throw Error('同梱Notoフォントの読み込みが完了していません');
}
export function taslCanvasFont(px){requireTaslFont();return px+'px "'+TASL_FONT_FAMILY+'"';}
export function assertTaslGlyphs(text){
 for(const char of text){
  const cp=char.codePointAt(0);
  if(cp===9||cp===10||cp===13||state.checked.has(cp))continue;
  let lo=0,hi=NOTO_RANGES.length-1,found=false;
  while(lo<=hi){const m=(lo+hi)>>1,[a,b]=NOTO_RANGES[m];if(cp<a)hi=m-1;else if(cp>b)lo=m+1;else{found=true;break;}}
  if(!found)throw Error('同梱Notoに字形がありません: U+'+cp.toString(16).toUpperCase().padStart(4,'0'));
  state.checked.add(cp);
 }
}
