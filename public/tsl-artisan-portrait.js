// Recognition may weight observed source contours, but must never erase them
// or replace a person's eyes, mouth, hair or silhouette with a generic drawing.
// Face importance is already applied in parseArtisanStructure / native op 4.
export function guideArtisanFaces(field,structure,regions){
 return {...structure,faceGuides:0};
}
export function artisanFaceGpuCommands(field,structure,regions){
 // Preserve the native pipeline; there are no invented portrait strokes to run.
 return {commands:[],faceGuides:0};
}
