import {SqliteStoryStore} from './sqlite-story-store.js';
export function openCliSeries(path:string){const store=new SqliteStoryStore(path);let closed=false;return {store,dispose(){if(closed)return;closed=true;store.close();}};}
