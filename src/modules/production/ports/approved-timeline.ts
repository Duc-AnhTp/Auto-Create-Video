import type {ShotTakeRecord} from '../../../contracts/story.js';
export interface ApprovedTimeline {update(seriesId:string,episode:number,shotId:string,take:ShotTakeRecord):Promise<void>;}
