"""Same TSL settings/source, full conversion+MP4 timing; no hardware claims."""
import os,sys,json,time,threading,subprocess,hashlib
from pathlib import Path
from types import SimpleNamespace
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root/'native-boost'))
import mp4_native
os.environ['TASL_TEST_WARP']='1'
def exe(name):return str(root/'native-boost'/(name+'.exe'))
report=json.loads((root/'gpu-validation/resident-report.json').read_text(encoding='utf-8'))
runs=[]
for index,name in enumerate(['before','after']):
 tsl=root/'gpu-validation'/('resident-'+name+'.TSL')
 nw,nh=mp4_native.metadata(tsl)
 job=SimpleNamespace(output=tsl,source=root/'dist/__validation.mp4',lock=threading.RLock(),
  mp4_state='',mp4_message='',mp4_encoder='',mp4_done=0,mp4_total=10,mp4_procs=[],mp4_cancel=False)
 start=time.perf_counter()
 ok,reason=mp4_native._encode(job,exe,5,nw,nh,640,360,False,tsl.with_suffix('.mp4'),True)
 elapsed=time.perf_counter()-start
 assert ok,reason
 probe=json.loads(subprocess.check_output([exe('ffprobe'),'-v','error','-show_streams','-show_format','-of','json',str(tsl.with_suffix('.mp4'))]))
 stream=next(s for s in probe['streams'] if s['codec_type']=='video')
 assert (stream['width'],stream['height'])==(640,360)
 assert stream['r_frame_rate']=='5/1'
 assert abs(float(probe['format']['duration'])-2)<.25
 decoded=subprocess.check_output([exe('ffmpeg'),'-v','error','-i',str(tsl.with_suffix('.mp4')),'-an','-f','hash','-hash','sha256','-'])
 runs.append({'variant':name,'mp4Seconds':elapsed,'conversionPlusMp4Seconds':report['video'][index]['wallMs']/1000+elapsed,
  'decodedVideoHash':decoded.decode().strip(),'width':640,'height':360,'fps':stream['r_frame_rate'],
  'frames':stream.get('nb_frames'),'encoder':job.mp4_encoder})
assert runs[0]['decodedVideoHash']==runs[1]['decodedVideoHash'],'MP4 decoded frames differ'
summaries=[]
for name in ['baseline','resident']:
 frames=report['ring'][name];transfers=[f['perf']['transfer'] for f in frames]
 sums={key:sum(t[key] for t in transfers) for key in ['h2dCalls','h2dBytes','d2hCalls','d2hBytes','gpuWaitMs','bufferAllocations','bufferReleases','staticUploads','dispatchCalls']}
 sums.update(variant=name,frames=len(frames),nativeWallMs=sum(f['perf']['nativeWallMs'] for f in frames),
  ringBytes=max(t['residentBytes'] for t in transfers),nmsBudgetReserveBytes=1048576,
  arenaBytes=max(f['perf']['gpuArenaBytes'] for f in frames),
  processVramBytes=max(t['processVramBytes'] for t in transfers),
  processVramBudgetBytes=max(t['processVramBudgetBytes'] for t in transfers),
  frameMeanMs=sum(f['perf']['nativeWallMs'] for f in frames)/len(frames))
 summaries.append(sums)
result={'adapter':report['adapter'],'sameSourceSha256':report['sourceSha256'],'exactText':True,'exactVideoTsl':True,
 'exactDecodedMp4':True,'layoutMeasurements':summaries,'video':report['video'],'mp4':runs,
 'scope':'Layout counters compare the retained v0.3.41 layout path and residency on one process. Whole-video time compares untouched v0.3.41 and the new app, same WARP PC and source. Hardware/whole-device VRAM remains unverified.'}
(root/'gpu-validation/resident-summary.json').write_text(json.dumps(result,indent=2))
print('RESIDENT_SUMMARY',json.dumps({**result,'video':[{'resident':r['resident'],'wallMs':r['wallMs']} for r in report['video']]}))
lines=['# v0.3.42-rc2 GPU常駐 検証結果','','Windows CIのWARPソフトウェア実行。GTX 1050 Tiの実機性能ではありません。','',
 '文字列・全体評価値・TSL・MP4復号後のフレームが一致。容量確保失敗時も同じ文字列と評価値。','両方のアプリで同じ動画を1回予備実行した後、各1回を計測。測定時は途中保存を再利用せず全フレームを変換。','',
 '| 組版計測（23フレーム） | 旧経路 | 常駐経路 |','|---|---:|---:|']
for key in ['nativeWallMs','frameMeanMs','h2dCalls','h2dBytes','d2hCalls','d2hBytes','gpuWaitMs','bufferAllocations','bufferReleases','staticUploads','ringBytes','arenaBytes','processVramBytes','processVramBudgetBytes']:
 lines.append(f'| {key} | {summaries[0][key]:.3f} | {summaries[1][key]:.3f} |')
lines+=['','| 同じ動画・同じ設定 | v0.3.41 | v0.3.42-rc2 |','|---|---:|---:|',
 f"| 文字変換全体 ms | {report['video'][0]['wallMs']:.3f} | {report['video'][1]['wallMs']:.3f} |",
 f"| 変換＋MP4 秒 | {runs[0]['conversionPlusMp4Seconds']:.3f} | {runs[1]['conversionPlusMp4Seconds']:.3f} |",'',
 '転送・確保回数は組版プロセスの計測値。DXGI値もそのプロセスの使用量です。デバイス全体の使用量とは異なります。',
 '追加予算: 10入力枠＋NMS予約1MiBで256MiB以内。既存の組版・輪郭作業領域や認識モデルは別です。',
 '実機では同じ入力・設定で再測定が必要です。WARP測定だけで高速化達成やVRAM安全余裕を確定しません。']
(root/'gpu-validation/RESIDENT-VALIDATION-JA.md').write_text('\n'.join(lines),encoding='utf-8')
