import { z } from "zod";
import type { CharacterRecord, LocationRecord } from "./story.js";
import type { UnifiedTimeline } from "./timeline.js";
export interface BibleView {characters?:CharacterRecord[];locations?:LocationRecord[]}
export interface DraftResponse {text:string;version:number}
export interface ArtifactsResponse {timeline:UnifiedTimeline|null;files:string[]}
export interface BackupSnapshot {id:string;createdAt:string;fileCount:number}
export const StoryImportResultSchema=z.object({sourceId:z.string(),planId:z.string(),summary:z.unknown(),warnings:z.array(z.string()),message:z.string()});
export type StoryImportResult=z.infer<typeof StoryImportResultSchema>;
