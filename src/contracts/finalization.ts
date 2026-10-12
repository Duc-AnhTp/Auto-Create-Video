import {z} from 'zod';
const Transition=z.object({type:z.enum(['cut','crossfade','fade_to_black']),durationSec:z.number()});
export const FinalizeScriptSchema=z.object({
 title:z.string().optional(),logline:z.string().optional(),fps:z.number().positive().optional(),aspectRatio:z.enum(['9:16','16:9','1:1']).optional(),
 scenes:z.array(z.object({sceneId:z.string().optional(),sceneNumber:z.number().optional(),locationName:z.string().optional(),timeOfDay:z.string().optional(),description:z.string().optional(),
 charactersPresent:z.array(z.union([z.string(),z.object({characterId:z.string(),wardrobeId:z.string().optional()})])).optional(),propsPresent:z.array(z.string()).optional(),
 shots:z.array(z.object({shotId:z.string(),durationSec:z.number().positive().optional(),visualPrompt:z.string().optional(),trimStartSec:z.number().optional(),trimEndSec:z.number().optional(),transitionIn:Transition.optional(),transitionOut:Transition.optional(),dialogues:z.array(z.object({text:z.string().optional()}).passthrough()).optional()}).passthrough()).default([])
 }).passthrough()).default([])
}).passthrough();
export type FinalizeScript=z.infer<typeof FinalizeScriptSchema>;
export const TakeQaEvidenceSchema=z.object({isMockVector:z.boolean().optional(),status:z.string().optional(),qa_status:z.string().optional(),notes:z.union([z.string(),z.array(z.string())]).optional()}).passthrough();
