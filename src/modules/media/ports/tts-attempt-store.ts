export interface TtsAttempt {
 id:string; state:'prepared'|'submitting'|'accepted'|'downloaded'|'completed'|'uncertain';
 seriesId?:string; provider:string; remoteId?:string; audioPath?:string; sha256?:string; error?:string;
}
export interface TtsAttemptStore {
 get(id:string):TtsAttempt|null;
 begin(attempt:TtsAttempt):boolean;
 save(attempt:TtsAttempt):void;
 close():void;
}
