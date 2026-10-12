import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {z} from 'zod';
import type {ApprovedTimeline} from '../../ports/approved-timeline.js';
import {containedPath} from '../../../../platform/filesystem/containment.js';
import {atomicWriteFile} from '../../../../platform/filesystem/atomic-publication.js';
const Timeline=z.object({videoTrack:z.array(z.object({shotId:z.string(),approvedClipPath:z.string().optional()}).passthrough()).optional()}).passthrough();
export function createApprovedTimeline():ApprovedTimeline{return {async update(seriesId,episode,shotId,take){
 const dir=resolve('output','series',seriesId,'ep-'+String(episode).padStart(2,'0'));if(!existsSync(dir)||!take.local_path)return;
 containedPath(resolve('output'),dir);
 const candidates = [
   join(dir, 'timeline.json'),
   join(dir, 'assembly', 'timeline.json'),
   join(dir, 'artifacts', 'unified_timeline.json'),
   join(dir, 'artifacts', 'timeline.json'),
   join(dir, 'unified_timeline.json'),
 ];
 for (const file of candidates) {
   if (!existsSync(file)) continue;
   try {
     const timeline = Timeline.parse(JSON.parse(await readFile(file, 'utf8')));
     const shot = timeline.videoTrack?.find(item => item.shotId === shotId || item.shotId === take.shot_id);
     if (shot) {
       shot.approvedClipPath = take.local_path;
       await atomicWriteFile(file, JSON.stringify(timeline, null, 2), 'utf8');
     }
   } catch {}
 }
}};}
