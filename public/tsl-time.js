// Display only. Callers continue to keep full-resolution timestamps and 60Hz ticks.
// Elapsed/current times floor; estimates and total durations ceil.
export function formatSeconds(seconds,kind='elapsed'){
 if(!['elapsed','remaining','total'].includes(kind))throw Error('時間表示の種類が不正です');
 if(!Number.isFinite(seconds))return '—秒';
 const value=Math.max(0,seconds),round=kind==='elapsed'?Math.floor:Math.ceil;
 return round(value)+'秒';
}
