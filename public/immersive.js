// Uses the existing stage/canvas; decoding and playback remain in app.js.
export function setupImmersive({stage,stop}) {
 const close=document.createElement('button');close.id='exit-immersive';close.textContent='戻る';close.setAttribute('aria-label','全画面プレビューを終了');close.hidden=true;stage.append(close);
 let timer,active=false;
 const reveal=()=>{if(!active)return;stage.classList.add('show-exit');clearTimeout(timer);timer=setTimeout(()=>stage.classList.remove('show-exit'),2200);};
 const leave=()=>{active=false;clearTimeout(timer);stage.classList.remove('immersive','show-exit');document.body.classList.remove('immersive-active');close.hidden=true;stop();};
 close.onclick=e=>{e.stopPropagation();if(document.fullscreenElement===stage)document.exitFullscreen().catch(()=>{});leave();};
 stage.addEventListener('pointerdown',reveal);
 close.addEventListener('focus',()=>stage.classList.add('show-exit'));
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&active){if(document.fullscreenElement===stage)document.exitFullscreen().catch(()=>{});leave();}});
 document.addEventListener('fullscreenchange',()=>{if(active&&!document.fullscreenElement)leave();});
 return ()=>{
  active=true;close.hidden=false;stage.classList.add('immersive');document.body.classList.add('immersive-active');reveal();
  // Mobile browsers without Fullscreen API still get a viewport-filling stage.
  try{stage.requestFullscreen?.({navigationUI:'hide'})?.catch(()=>{});}catch{}
 };
}
