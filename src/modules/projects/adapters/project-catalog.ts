import {existsSync} from 'node:fs';
import {readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {log} from '../../../platform/observability/logger.js';
import type {ProjectCatalogStore} from '../ports/project-catalog-store.js';
import type {SeriesMetadataRecord} from '../../../contracts/story.js';
export class SqliteProjectCatalog {
 constructor(private openStore:(path:string)=>ProjectCatalogStore & {close():void}) {}
 private async withBible<T>(path:string,fn:(store:ProjectCatalogStore)=>T|Promise<T>):Promise<T>{const store=this.openStore(path);try{return await fn(store);}finally{store.close();}}
public async listAllSeries(): Promise<Array<Partial<SeriesMetadataRecord> & {id:string;title:string;characterCount:number;locationCount:number;episodeCount:number}>> {
    const seriesDir = join("data", "series");
    if (!existsSync(seriesDir)) return [];

    const entries = await readdir(seriesDir, { withFileTypes: true });
    const list: Array<Partial<SeriesMetadataRecord> & {id:string;title:string;characterCount:number;locationCount:number;episodeCount:number}> = [];

    for (const ent of entries) {
      if (ent.isDirectory()) {
        const dbPath = join(seriesDir, ent.name, "story_bible.db");
        if (existsSync(dbPath)) {
          try {
            await this.withBible(dbPath, (bible) => {
              const meta = bible.getSeriesMetadata(ent.name) || { id: ent.name, title: ent.name };
              const chars = bible.listCharacters(ent.name);
              const locs = bible.listLocations(ent.name);
              const history = bible.getCanonHistory(ent.name);
              list.push({
                ...meta,
                characterCount: chars.length,
                locationCount: locs.length,
                episodeCount: history.length,
              });
            });
          } catch(error) {log.warn(`[PROJECT CATALOG] Cannot read ${dbPath}: ${String(error)}`);}
        }
      }
    }
    return list;
  }
public async getSeriesBibleData(seriesId: string): Promise<{metadata:Partial<SeriesMetadataRecord>&{id:string;title:string};characters:ReturnType<ProjectCatalogStore["listCharacters"]>;locations:ReturnType<ProjectCatalogStore["listLocations"]>;props:ReturnType<ProjectCatalogStore["listKeyProps"]>;worldState:ReturnType<ProjectCatalogStore["getAllWorldState"]>;canonHistory:ReturnType<ProjectCatalogStore["getCanonHistory"]>}> {
    const dbPath = join("data", "series", seriesId, "story_bible.db");
    return await this.withBible(existsSync(dbPath) ? dbPath : ":memory:", (bible) => {
      return {
        metadata: bible.getSeriesMetadata(seriesId) || { id: seriesId, title: seriesId },
        characters: bible.listCharacters(seriesId),
        locations: bible.listLocations(seriesId),
        props: bible.listKeyProps(seriesId),
        worldState: bible.getAllWorldState(seriesId),
        canonHistory: bible.getCanonHistory(seriesId),
      };
    });
  }
}
