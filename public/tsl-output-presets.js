// Optional output dimensions use ordinary TSL comments. Character encoding,
// halfwidth-column geometry, palette and 60 Hz schedule stay unchanged.
export const OUTPUT_PRESETS=Object.freeze({
 'portrait-3x4':Object.freeze({outputWidth:1080,outputHeight:1440}),
 'landscape-4x3':Object.freeze({outputWidth:1440,outputHeight:1080})
});
export function outputPreset(mode){return OUTPUT_PRESETS[mode]||null;}
export function validateOutputSize(width,height){
 if(!Object.values(OUTPUT_PRESETS).some(p=>p.outputWidth===width&&p.outputHeight===height))
  throw Error('指定出力解像度は1080×1440または1440×1080にしてください');
 return {outputWidth:width,outputHeight:height};
}
export function presetGrid(mode,fontPixels=24,native16=false){
 const preset=outputPreset(mode);if(!preset)throw Error('生成モードが不正です');
 if(!Number.isInteger(fontPixels)||fontPixels<16||fontPixels>256)
  throw Error('文字サイズは16〜256pxの整数で指定してください');
 // Exact integer ratios prevent contain padding for a matching input.
 // Each character occupies one halfwidth column, with width/height = 1/2.
 const portrait=mode==='portrait-3x4',unitW=portrait?3:8,unitH=portrait?2:3;
 const target=preset.outputWidth/(native16?8:fontPixels*.6);
 const maximum=Math.min(Math.floor((native16?480:160)/unitW),Math.floor((native16?240:100)/unitH));
 const minimum=Math.max(Math.ceil(4/unitW),Math.ceil(4/unitH));
 const multiple=Math.max(minimum,Math.min(maximum,Math.round(target/unitW)));
 return {width:unitW*multiple,height:unitH*multiple,targetAspect:preset.outputWidth/preset.outputHeight,...preset};
}
