// Compatibility router. The original 60px implementation is intentionally unchanged.
import * as legacy from './tsl-mode4-grid60.js';
import {smallProfile,smallGrid,ensureSmallAtlas,makeSmallAtlas,SmallGridConverter,validateSmallOffsets,parseSmallPositions} from './tsl-mode4-small.js';
import {validateOffsets as oldOffsets,parsePositions as oldPositions} from './mode4-position60.js';
export const MODE4_ENGINE=legacy.MODE4_ENGINE;
export function mode4Cell(data={}){return data.mode4CellSize??(data.mode4Cell60?60:0);}
export function isMode4Grid(data={}){return [30,40,60].includes(mode4Cell(data));}
export function mode4Engine(cell=60){return cell===60?MODE4_ENGINE:smallProfile(cell).engine;}
export function mode4Grid(w,h,cell=60){return cell===60?{...legacy.mode4Grid(w,h),mode4CellSize:60}:smallGrid(w,h,cell);}
export function makeMode4Atlas(cell=60){return cell===60?legacy.makeMode4Atlas():makeSmallAtlas(cell);}
export function ensureMode4Atlas(cell=60){return cell===60?legacy.ensureMode4Atlas():ensureSmallAtlas(cell);}
export function createMode4Converter(atlas,cell=60){return cell===60?new legacy.Grid60Converter(atlas):new SmallGridConverter(atlas,cell);}
export function validateOffsets(lines,width,height,bytes,cell=60){return cell===60?oldOffsets(lines,width,height,bytes):validateSmallOffsets(lines,width,height,bytes,cell);}
export function parsePositions(header,frames,width,height,cell=60){return cell===60?oldPositions(header,frames,width,height):parseSmallPositions(header,frames,width,height,cell);}
