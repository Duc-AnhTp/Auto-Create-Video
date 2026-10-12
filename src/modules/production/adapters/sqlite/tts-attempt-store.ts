import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {migrateQueue} from '../../../../platform/sqlite/queue-schema.js';
import type {TtsAttempt,TtsAttemptStore} from '../../../media/index.js';
export class SqliteTtsAttemptStore implements TtsAttemptStore {
 private db:DatabaseSync;private closed=false;
 constructor(path:string){if(path!==':memory:')mkdirSync(dirname(path),{recursive:true});this.db=new DatabaseSync(path);try{migrateQueue(this.db,path);}catch(error){this.db.close();throw error;}}
 get(id:string):TtsAttempt|null{const row=this.db.prepare('SELECT payload FROM tts_attempts WHERE id=?').get(id);return row?JSON.parse(String(row.payload)):null;}
 begin(attempt:TtsAttempt):boolean{
  this.db.exec('BEGIN IMMEDIATE');
  try {
   const maintenance=attempt.seriesId?this.db.prepare('SELECT token FROM series_maintenance WHERE series_id=?').get(attempt.seriesId):this.db.prepare('SELECT token FROM series_maintenance LIMIT 1').get();
   if(maintenance)throw new Error('PROJECT_BUSY');
   const created=Number(this.db.prepare('INSERT OR IGNORE INTO tts_attempts VALUES(?,?,?,?)').run(attempt.id,'submitting',JSON.stringify({...attempt,state:'submitting'}),Date.now()).changes)===1;
   this.db.exec('COMMIT');return created;
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 save(attempt:TtsAttempt){this.db.prepare('UPDATE tts_attempts SET state=?,payload=?,updated_at=? WHERE id=?').run(attempt.state,JSON.stringify(attempt),Date.now(),attempt.id);}
 close(){if(this.closed)return;this.closed=true;this.db.close();}
}
