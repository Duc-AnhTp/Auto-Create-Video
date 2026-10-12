import { WorkflowError } from "../../../../platform/workflow-error.js";
import type { DatabaseSync } from "node:sqlite";

/** Per-series durable data. The memory implementation is restricted to non-production Bible fallback. */
import type { Provenance, ReferenceProvenance, ProductionArtifact, ProviderAttemptGroup, AttemptLease } from "../../../../contracts/production.js";
export type { Provenance, ReferenceProvenance, ProductionArtifact, ProviderAttemptGroup, AttemptLease } from "../../../../contracts/production.js";
export class ProductionRepository {
  private references = new Map<string, ReferenceProvenance>();
  private artifacts = new Map<string, ProductionArtifact>();
  private groups = new Map<string, ProviderAttemptGroup>();
  private leases = new Map<string, AttemptLease>();
  private revision = 0;
  private indexes = new Map<string, string>();
  private receipts = new Map<string,string>();
  constructor(private db: DatabaseSync | null) {}
  invoiceReceipt(id:string):string|null{return this.db?String(this.db.prepare('SELECT payload FROM provider_invoice_receipts WHERE id=?').get(id)?.payload??'')||null:this.receipts.get(id)??null;}
  putInvoiceReceipt(id:string,attemptId:string,payload:string):void{if(this.db)this.db.prepare('INSERT OR IGNORE INTO provider_invoice_receipts VALUES(?,?,?)').run(id,attemptId,payload);else this.receipts.set(id,payload);}
  unresolvedUsage(seriesId:string):number{return this.db?Number(this.db.prepare("SELECT count(*) AS n FROM legacy_usage_ownership WHERE status='needs_review' AND (candidates='[]' OR EXISTS (SELECT 1 FROM json_each(candidates) WHERE value=?))").get(seriesId)?.n??0):0;}
  legacyUsageReview(seriesId:string):Record<string,unknown>[]{return this.db?this.db.prepare("SELECT l.id,l.episode_number,l.shot_id,l.provider,l.type,l.cost_usd,o.candidates FROM legacy_usage_ownership o JOIN api_usage_logs l ON l.id=o.log_id WHERE o.status='needs_review' AND (o.candidates='[]' OR EXISTS(SELECT 1 FROM json_each(o.candidates) WHERE value=?)) ORDER BY l.id LIMIT 100").all(seriesId):[];}

  static migrate(db: DatabaseSync): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS production_references(path TEXT PRIMARY KEY, series_id TEXT NOT NULL, entity_id TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS production_artifacts(id TEXT PRIMARY KEY, series_id TEXT NOT NULL, episode INTEGER NOT NULL, kind TEXT NOT NULL, path TEXT NOT NULL UNIQUE, payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_artifacts_episode ON production_artifacts(series_id,episode,kind);
      CREATE TABLE IF NOT EXISTS provider_attempt_groups(id TEXT PRIMARY KEY,series_id TEXT NOT NULL,episode INTEGER NOT NULL,shot_id TEXT NOT NULL,spec_hash TEXT NOT NULL,winner_id TEXT,payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_attempt_group_spec ON provider_attempt_groups(series_id,episode,shot_id,spec_hash);
      CREATE TABLE IF NOT EXISTS provider_attempt_ownership(attempt_id TEXT PRIMARY KEY,owner TEXT NOT NULL,version INTEGER NOT NULL,lease_until INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS production_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,attempt_id TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS canonical_revision(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL);
      INSERT OR IGNORE INTO canonical_revision(id,revision) VALUES(1,0);
      CREATE TABLE IF NOT EXISTS semantic_indexes(cache_key TEXT PRIMARY KEY,payload TEXT NOT NULL);
    `);
  }
  transaction<T>(fn: () => T): T {
    if (!this.db) return fn();
    if(this.db.isTransaction)return fn();
    this.db.exec("BEGIN IMMEDIATE");
    try { const value = fn(); this.db.exec("COMMIT"); return value; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  putReference(value: ReferenceProvenance): void {
    if (this.db) this.db.prepare("INSERT INTO production_references VALUES(?,?,?,?) ON CONFLICT(path) DO UPDATE SET payload=excluded.payload,series_id=excluded.series_id,entity_id=excluded.entity_id")
      .run(value.path,value.seriesId,value.entityId,JSON.stringify(value));
    else this.references.set(value.path,structuredClone(value));
  }
  getReference(path: string): ReferenceProvenance | null {
    const row = this.db?.prepare("SELECT payload FROM production_references WHERE path=?").get(path);
    return row ? JSON.parse(String(row.payload)) : this.references.get(path) ?? null;
  }
  listReferences(seriesId:string):ReferenceProvenance[] {
    return this.db ? this.db.prepare("SELECT payload FROM production_references WHERE series_id=? ORDER BY path").all(seriesId).map(row=>JSON.parse(String(row.payload))) : [...this.references.values()].filter(ref=>ref.seriesId===seriesId);
  }
  putArtifact(value: ProductionArtifact): ProductionArtifact {
    const existing = this.findArtifact(value.path);
    value = { ...value, id: existing?.id ?? value.id };
    if (this.db) this.db.prepare("INSERT INTO production_artifacts VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,kind=excluded.kind")
      .run(value.id,value.seriesId,value.episodeNumber,value.kind,value.path,JSON.stringify(value));
    else this.artifacts.set(value.id,structuredClone(value));
    return value;
  }
  getArtifact(id: string): ProductionArtifact | null {
    const row = this.db?.prepare("SELECT payload FROM production_artifacts WHERE id=?").get(id);
    return row ? JSON.parse(String(row.payload)) : this.artifacts.get(id) ?? null;
  }
  findArtifact(path: string): ProductionArtifact | null {
    const row = this.db?.prepare("SELECT payload FROM production_artifacts WHERE path=?").get(path);
    return row ? JSON.parse(String(row.payload)) : [...this.artifacts.values()].find(a => a.path === path) ?? null;
  }
  listArtifacts(seriesId: string, episode: number): ProductionArtifact[] {
    if (this.db) return this.db.prepare("SELECT payload FROM production_artifacts WHERE series_id=? AND episode=? ORDER BY rowid DESC").all(seriesId,episode).map(r=>JSON.parse(String(r.payload)));
    return [...this.artifacts.values()].filter(a=>a.seriesId===seriesId && a.episodeNumber===episode).reverse();
  }
  putGroup(value: ProviderAttemptGroup): void {
    if (this.db) this.db.prepare("INSERT INTO provider_attempt_groups VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET winner_id=excluded.winner_id,payload=excluded.payload")
      .run(value.id,value.seriesId,value.episodeNumber,value.shotId,value.specHash,value.winnerId ?? null,JSON.stringify(value));
    else this.groups.set(value.id,structuredClone(value));
  }
  getGroup(id: string): ProviderAttemptGroup | null {
    const row = this.db?.prepare("SELECT payload FROM provider_attempt_groups WHERE id=?").get(id);
    return row ? JSON.parse(String(row.payload)) : this.groups.get(id) ?? null;
  }
  findGroup(seriesId: string, episode: number, shotId: string, hash: string): ProviderAttemptGroup | null {
    if (this.db) { const row=this.db.prepare("SELECT payload FROM provider_attempt_groups WHERE series_id=? AND episode=? AND shot_id=? AND spec_hash=? ORDER BY rowid DESC LIMIT 1").get(seriesId,episode,shotId,hash); return row?JSON.parse(String(row.payload)):null; }
    return [...this.groups.values()].reverse().find(g=>g.seriesId===seriesId&&g.episodeNumber===episode&&g.shotId===shotId&&g.specHash===hash)??null;
  }
  listGroups(): ProviderAttemptGroup[] {
    return this.db ? this.db.prepare("SELECT payload FROM provider_attempt_groups").all().map(r=>JSON.parse(String(r.payload))) : [...this.groups.values()];
  }
  chooseWinner(groupId: string, attemptId: string): boolean {
    return this.transaction(()=>{ const group=this.getGroup(groupId); if(!group || group.winnerId) return group?.winnerId===attemptId;
      group.winnerId=attemptId; group.status="completed"; this.putGroup(group); return true; });
  }
  claim(id: string, owner: string, now=Date.now(), duration=120_000): AttemptLease | null {
    return this.transaction(()=>{ const row=this.db?.prepare("SELECT owner,version,lease_until FROM provider_attempt_ownership WHERE attempt_id=?").get(id);
      const previous:AttemptLease|undefined=row?{id,owner:String(row.owner),version:Number(row.version),expiresAt:Number(row.lease_until)}:this.leases.get(id);
      if(previous && previous.owner!==owner && previous.expiresAt>now) return null;
      const lease={id,owner,version:(previous?.version??0)+1,expiresAt:now+duration};
      if(this.db) this.db.prepare("INSERT INTO provider_attempt_ownership VALUES(?,?,?,?) ON CONFLICT(attempt_id) DO UPDATE SET owner=excluded.owner,version=excluded.version,lease_until=excluded.lease_until").run(id,owner,lease.version,lease.expiresAt);
      else this.leases.set(id,lease); return lease; });
  }
  heartbeat(lease: AttemptLease, now=Date.now()): boolean {
    if(this.db) return Number(this.db.prepare("UPDATE provider_attempt_ownership SET lease_until=? WHERE attempt_id=? AND owner=? AND version=? AND lease_until>?").run(now+120_000,lease.id,lease.owner,lease.version,now).changes)===1;
    const current=this.leases.get(lease.id); if(!current||current.owner!==lease.owner||current.version!==lease.version||current.expiresAt<=now)return false; current.expiresAt=now+120_000; return true;
  }
  withLease<T>(lease: AttemptLease, fn:()=>T):T {
    return this.transaction(()=>{ const row=this.db?.prepare("SELECT owner,version,lease_until FROM provider_attempt_ownership WHERE attempt_id=?").get(lease.id);
      const current=row?{owner:String(row.owner),version:Number(row.version),expiresAt:Number(row.lease_until)}:this.leases.get(lease.id);
      if(!current||current.owner!==lease.owner||current.version!==lease.version||current.expiresAt<=Date.now())throw new WorkflowError("WORKER_LEASE_LOST", "WORKER_LEASE_LOST", "lease_lost"); return fn(); });
  }
  release(lease:AttemptLease):void {
    if(this.db)this.db.prepare("UPDATE provider_attempt_ownership SET lease_until=0 WHERE attempt_id=? AND owner=? AND version=?").run(lease.id,lease.owner,lease.version);
    else {const row=this.leases.get(lease.id);if(row?.version===lease.version&&row.owner===lease.owner)row.expiresAt=0;}
  }
  audit(attemptId:string,payload:Record<string,unknown>):void {
    this.db?.prepare("INSERT INTO production_audit(attempt_id,payload,created_at) VALUES(?,?,?)").run(attemptId,JSON.stringify(payload),new Date().toISOString());
  }
  listAudit(attemptId:string):Record<string,unknown>[]{return this.db?this.db.prepare("SELECT payload FROM production_audit WHERE attempt_id=? ORDER BY id").all(attemptId).map(row=>JSON.parse(String(row.payload))):[];}
  getRevision():number { return this.db?Number(this.db.prepare("SELECT revision FROM canonical_revision WHERE id=1").get()?.revision??0):this.revision; }
  bumpRevision():void { if(this.db)this.db.exec("UPDATE canonical_revision SET revision=revision+1 WHERE id=1");else this.revision++; }
  getIndex(key:string):string|null {const row=this.db?.prepare("SELECT payload FROM semantic_indexes WHERE cache_key=?").get(key);return row?String(row.payload):this.indexes.get(key)??null;}
  putIndex(key:string,payload:string):void {if(this.db){this.db.prepare("INSERT OR REPLACE INTO semantic_indexes VALUES(?,?)").run(key,payload);this.db.exec("DELETE FROM semantic_indexes WHERE rowid NOT IN (SELECT rowid FROM semantic_indexes ORDER BY rowid DESC LIMIT 8)");}else this.indexes.set(key,payload);}
}
