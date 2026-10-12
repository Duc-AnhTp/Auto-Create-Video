import { log } from '../platform/observability/logger.js';
import { ProviderDispatchStore } from '../modules/production/adapters/sqlite/provider-dispatch-store.js';
import { backfillProductionData } from '../modules/production/adapters/sqlite/backfill.js';
import { WorkflowError } from "../platform/workflow-error.js";
import type { ReferenceProvenance, ProductionArtifact, AttemptLease } from "../contracts/production.js";
import { EntityRepository } from "../modules/story/adapters/sqlite/entity-repository.js";
import { MigrationRepository } from "../platform/sqlite/migrations.js";
import { CanonRepository } from "../modules/story/adapters/sqlite/canon-repository.js";
import { ReferencesRepository } from "../modules/production/adapters/sqlite/references-repository.js";
import { ProviderJobsRepository } from "../modules/production/adapters/sqlite/provider-jobs-repository.js";
import { SourcesRepository } from "../modules/story/adapters/sqlite/sources-repository.js";
import { FatalSqliteError, type BibleManagerOptions, type SeriesMetadataRecord, type CharacterRecord, type CharacterStateRecord, type CharacterWardrobeRecord, type LocationRecord, type LocationStateRecord, type KeyPropRecord, type PropStateRecord, type CharacterKnowledgeRecord, type EpisodeSummaryRecord, type ApiUsageRecord, type ReferenceAssetRecord, type StoryboardKeyframeRecord, type ProviderJobRecord, type SeriesBudgetRecord, type ProviderRateCardRecord, type LlmTokenUsageRecord, type LlmTokenUsageSummary, type BudgetLedgerSummary, type ShotTakeRecord, type AtomicReserveShotTakeParams, type AtomicReserveShotTakeResult, type StateEventRecord, type CanonSnapshotRecord, type EpisodeLifecycleStatus, type EpisodeLifecycleRecord, type CanonMigrationRecord, type SourceWorkRecord, type SourceRevisionRecord, type SourceUnitRecord, type SourceBlockRecord, type StoryBeatRecord, type StoryThreadRecord, type KnowledgeStateRecord, type SeriesPlanRecord, type PlannedEpisodeRecord, type CoverageLedgerRecord, type AnalysisReviewItemRecord, type ChekhovGunRecord, type NarrativeDelta, type BibleMemoryStore } from "../contracts/story.js";
import type { DatabaseSession } from "../platform/sqlite/session.js";
import type { CanonRepositorySession } from "../modules/story/adapters/sqlite/canon-repository.js";
import type { ProviderJobsRepositorySession } from "../modules/production/adapters/sqlite/provider-jobs-repository.js";
import type { StoryStore } from "./ports/workflow-store.js";
export * from "../contracts/story.js";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { ProductionRepository } from "../modules/production/adapters/sqlite/production-repository.js";
import { type ProviderAttemptGroup } from "../contracts/production.js";
import { type ContinuityAuditResult, type StoryBiblePayload, type LlmInvoker } from "../modules/story/application/continuity-auditor.js";
import { TimelineBranchManager, type TimelineBranchRecord, type ForkBranchOptions, type MultiverseBranchDiff, } from "../modules/story/adapters/sqlite/timeline-branch-manager.js";
export { TimelineBranchManager, type TimelineBranchRecord, type ForkBranchOptions, type MultiverseBranchDiff, };
const nodeRequire = createRequire(import.meta.url);
/**
 * Story Bible Manager for Episodic AI Series.
 * Implements Versioned Canon State Manager with transactional commits and strict SQLite persistence.
 */
export class SqliteStoryStore implements StoryStore {
    private static openInstances: Set<SqliteStoryStore> = new Set();
    private db: any = null;
    private entities = new EntityRepository(() => this.databaseSession(), { listStateEvents: options => this.canonRepository.listStateEvents(options) });
    private migrationRepository = new MigrationRepository(() => this.databaseSession(), (session, versions) => { if (!session.db)
        return; ProductionRepository.migrate(session.db); backfillProductionData({ ...session, store: { listProviderJobs: (...args) => this.providerJobsRepository.listProviderJobs(...args), createOrUpdateProviderJob: (...args) => this.providerJobsRepository.createOrUpdateProviderJob(...args) } }, versions); });
    private canonRepository = new CanonRepository(() => this.canonSession());
    private referencesRepository = new ReferencesRepository(() => this.databaseSession());
    private providerJobsRepository = new ProviderJobsRepository(() => this.providerJobsSession());
    private sourcesRepository = new SourcesRepository(() => this.databaseSession());
    private databaseSession(): DatabaseSession { return { db: this.db, memoryStore: this.memoryStore, isFallback: this.isFallback }; }
    private canonSession(): CanonRepositorySession { return { ...this.databaseSession(), entities: { listCharacters: (...args) => this.entities.listCharacters(...args), listKeyProps: (...args) => this.entities.listKeyProps(...args), getSeriesMetadata: (...args) => this.entities.getSeriesMetadata(...args), getCharacter: (...args) => this.entities.getCharacter(...args), updateCharacterStatus: (...args) => this.entities.updateCharacterStatus(...args), setCharacterActiveWardrobe: (...args) => this.entities.setCharacterActiveWardrobe(...args), getKeyProp: (...args) => this.entities.getKeyProp(...args), transferKeyProp: (...args) => this.entities.transferKeyProp(...args), addKnowledge: (...args) => this.entities.addKnowledge(...args), recordKnowledgeState: (...args) => this.sourcesRepository.recordKnowledgeState(...args), getWorldState: (...args) => this.entities.getWorldState(...args), setWorldState: (...args) => this.entities.setWorldState(...args), getCharacterKnowledge: (...args) => this.entities.getCharacterKnowledge(...args), getWardrobe: (...args) => this.entities.getWardrobe(...args), listLocations: (...args) => this.entities.listLocations(...args), getWorldStateForEpisode: (...args) => this.entities.getWorldStateForEpisode(...args), getAllWorldState: (...args) => this.entities.getAllWorldState(...args), getLocation: (...args) => this.entities.getLocation(...args), recordEpisodeSummary: (...args) => this.entities.recordEpisodeSummary(...args), listWardrobesForCharacter: (...args) => this.entities.listWardrobesForCharacter(...args), listEpisodeSummaries: (...args) => this.entities.listEpisodeSummaries(...args) }, branches: this.branchManager, branchCanon: { getSnapshotForEpisode: (...args) => this.canonRepository.getSnapshotForEpisode(...args), getCanonSnapshot: (...args) => this.canonRepository.getCanonSnapshot(...args) } }; }
    private providerJobsSession(): ProviderJobsRepositorySession { return { ...this.databaseSession(), store: { getSeriesMetadata: (...args) => this.entities.getSeriesMetadata(...args), transaction: (...args) => this.transaction(...args), findGroup: (...args) => this.findGroup(...args), listGroups: () => this.listGroups(), putGroup: (...args) => this.putGroup(...args), getGroup: (...args) => this.getGroup(...args) } }; }
    private productionRepository?: ProductionRepository;
    private disposables = new Set<() => void>();
    public addDisposable(close: () => void): void { this.disposables.add(close); }
    private productionState(): ProductionRepository { return this.productionRepository ??= new ProductionRepository(this.db); }
    public transaction<T>(fn: () => T): T { return this.productionState().transaction(fn); }
    public putReference(value: ReferenceProvenance): void { return this.productionState().putReference(value); }
    public getReference(path: string): ReferenceProvenance | null { return this.productionState().getReference(path); }
    public listReferences(seriesId: string): ReferenceProvenance[] { return this.productionState().listReferences(seriesId); }
    public putArtifact(value: ProductionArtifact): ProductionArtifact { return this.productionState().putArtifact(value); }
    public getArtifact(id: string): ProductionArtifact | null { return this.productionState().getArtifact(id); }
    public findArtifact(path: string): ProductionArtifact | null { return this.productionState().findArtifact(path); }
    public listArtifacts(seriesId: string, episode: number): ProductionArtifact[] { return this.productionState().listArtifacts(seriesId, episode); }
    public putGroup(value: ProviderAttemptGroup): void { return this.productionState().putGroup(value); }
    public getGroup(id: string): ProviderAttemptGroup | null { return this.productionState().getGroup(id); }
    public findGroup(seriesId: string, episode: number, shotId: string, hash: string): ProviderAttemptGroup | null { return this.productionState().findGroup(seriesId, episode, shotId, hash); }
    public listGroups(): ProviderAttemptGroup[] { return this.productionState().listGroups(); }
    public chooseWinner(groupId: string, attemptId: string): boolean { return this.productionState().chooseWinner(groupId, attemptId); }
    public claim(id: string, owner: string, now?: number, duration?: number): AttemptLease | null { return this.productionState().claim(id, owner, now, duration); }
    public heartbeat(lease: AttemptLease, now?: number): boolean { return this.productionState().heartbeat(lease, now); }
    public withLease<T>(lease: AttemptLease, fn: () => T): T { return this.productionState().withLease(lease, fn); }
    public release(lease: AttemptLease): void { return this.productionState().release(lease); }
    public audit(attemptId: string, payload: Record<string, unknown>): void { return this.productionState().audit(attemptId, payload); }
    public listAudit(attemptId: string): Record<string, unknown>[] { return this.productionState().listAudit(attemptId); }
    public getRevision(): number { return this.productionState().getRevision(); }
    public bumpRevision(): void { return this.productionState().bumpRevision(); }
    public getIndex(key: string): string | null { return this.productionState().getIndex(key); }
    public putIndex(key: string, payload: string): void { return this.productionState().putIndex(key, payload); }
    public invoiceReceipt(id:string):string|null{return this.productionState().invoiceReceipt(id);}
    public putInvoiceReceipt(id:string,attemptId:string,payload:string):void{return this.productionState().putInvoiceReceipt(id,attemptId,payload);}
    public unresolvedUsage(seriesId:string):number{return this.productionState().unresolvedUsage(seriesId);}
    public legacyUsageReview(seriesId:string):Record<string,unknown>[]{return this.productionState().legacyUsageReview(seriesId);}
    private dbPath: string;
    private options: BibleManagerOptions;
    public isFallback = false;
    private memoryStore: BibleMemoryStore;
    public branchManager!: TimelineBranchManager;
    constructor(dbPath: string = "story_bible.db", options: BibleManagerOptions = {}) {
        this.dbPath = dbPath;
        this.options = options;
        this.memoryStore = {
            series: null,
            characters: new Map(),
            character_states: [],
            wardrobes: new Map(),
            locations: new Map(),
            location_states: [],
            props: new Map(),
            prop_states: [],
            knowledge: [],
            world_state: new Map(),
            episodes: new Map(),
            api_logs: [],
            shot_takes: new Map(),
            state_events: [],
            canon_snapshots: new Map(),
            episode_lifecycle: new Map(),
            applied_commits: new Map(),
            migrations: [],
            reference_assets: new Map(),
            storyboard_keyframes: new Map(),
            provider_jobs: new Map(),
            series_budgets: new Map(),
            provider_rate_cards: new Map(),
            llm_token_usage: [],
            source_works: new Map(),
            source_revisions: new Map(),
            source_units: new Map(),
            source_blocks: new Map(),
            story_beats: new Map(),
            story_threads: new Map(),
            knowledge_states: [],
            series_plans: new Map(),
            planned_episodes: new Map(),
            coverage_ledgers: new Map(),
            analysis_review_queue: new Map(),
            chekhov_guns: new Map(),
        };
        const seriesMatch = resolve(dbPath).match(/[\\/]data[\\/]series[\\/]([^\\/]+)[\\/]story_bible\.db$/);
        if (dbPath !== ":memory:" && seriesMatch) {
            const owned = options.seriesCoordinator ? undefined : new ProviderDispatchStore(process.env.STUDIO_JOB_DB);
            try {
                const leave = (options.seriesCoordinator ?? owned!.seriesCoordinator).enter(seriesMatch[1], options.maintenanceToken);
                this.addDisposable(() => { leave(); owned?.close(); });
            } catch (error) { owned?.close(); throw error; }
        }
        try { this.initDb(); } catch (error) { this.close(); throw error; }
    }
    private initDb() {
        const isProduction = process.env.NODE_ENV === "production" || process.env.CLI_MODE === "1";
        const enforceStrict = this.options.strictSqlite ?? isProduction;
        const dir = dirname(this.dbPath);
        if (dir && dir !== "." && !existsSync(dir)) {
            try {
                mkdirSync(dir, { recursive: true });
            }
            catch (err: any) {
                if (enforceStrict) {
                    throw new FatalSqliteError(`Fatal: Cannot create SQLite database directory at '${dir}': ${err.message}`);
                }
            }
        }
        let sqliteAvailable = false;
        try {
            let DatabaseSync: any;
            const builtin = (process as any).getBuiltinModule?.("node:sqlite");
            if (builtin?.DatabaseSync) {
                DatabaseSync = builtin.DatabaseSync;
            }
            else {
                const sqlite = nodeRequire("node:sqlite");
                DatabaseSync = sqlite?.DatabaseSync;
            }
            if (DatabaseSync) {
                sqliteAvailable = true;
                this.db = new DatabaseSync(this.dbPath);
                SqliteStoryStore.openInstances.add(this);
                try {
                    this.db.exec("PRAGMA journal_mode = WAL;");
                    this.db.exec("PRAGMA busy_timeout = 5000;");
                }
                catch (cleanupError) { log.warn('[SQLITE CLEANUP] '+String(cleanupError)); }
                // Preserve a consistent SQLite snapshot before upgrading an existing database.
                if (this.dbPath !== ":memory:") {
                    const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
                        name: string;
                    }[];
                    if (tables.length) {
                        const hasVersions = tables.some(table => table.name === "canon_migrations");
                        const version = hasVersions ? Number(this.db.prepare("SELECT COALESCE(MAX(version),0) AS version FROM canon_migrations").get().version) : 0;
                        if (version > 13)
                            throw new WorkflowError("UNSUPPORTED_BIBLE_SCHEMA", "UNSUPPORTED_BIBLE_SCHEMA", "failed");
                        const integrity = this.db.prepare("PRAGMA integrity_check").get();
                        if (Object.values(integrity).some(value => value !== "ok"))
                            throw new WorkflowError("BIBLE_INTEGRITY_FAILED", "BIBLE_INTEGRITY_FAILED", "failed");
                        if (version < 13) {
                            const backupPath = this.dbPath + ".pre-v13-" + Date.now() + ".bak";
                            this.db.exec("VACUUM INTO '" + backupPath.replace(/'/g, "''") + "'");
                        }
                    }
                }
                this.db.exec("BEGIN IMMEDIATE;");
                try {
                    this.applySchemaSql();
                    this.db.exec("COMMIT;");
                }
                catch (error) {
                    try {
                        this.db.exec("ROLLBACK;");
                    }
                    catch (cleanupError) { log.warn('[SQLITE CLEANUP] '+String(cleanupError)); }
                    throw error;
                }
                this.runMigrations();
                this.branchManager = new TimelineBranchManager(this.db, this.isFallback);
                return;
            }
            if (enforceStrict) {
                throw new FatalSqliteError(`Fatal: node:sqlite DatabaseSync is unavailable in environment. Ephemeral memory fallback is prohibited in production.`);
            }
            this.isFallback = true;
        }
        catch (err: any) {
            if (this.db) {
                try {
                    this.db.close();
                }
                catch (cleanupError) { log.warn('[SQLITE CLEANUP] '+String(cleanupError)); }
                this.db = null;
            }
            SqliteStoryStore.openInstances.delete(this);
            if (enforceStrict || sqliteAvailable) {
                throw new FatalSqliteError(`Fatal: Failed to initialize SQLite database at '${this.dbPath}': ${err.message}`);
            }
            this.isFallback = true;
        }
        this.branchManager = new TimelineBranchManager(this.db, this.isFallback);
    }
    public close(): void {
        for (const dispose of this.disposables)
            dispose();
        this.disposables.clear();
        if (this.db && typeof this.db.close === "function") {
            try {
                this.db.close();
            }
            catch (cleanupError) { log.warn('[SQLITE CLEANUP] '+String(cleanupError)); }
            this.db = null;
        }
        SqliteStoryStore.openInstances.delete(this);
    }
    public static closeForPath(dbPath: string): void {
        const target = resolve(dbPath);
        for (const inst of Array.from(SqliteStoryStore.openInstances)) {
            if (inst.dbPath !== ":memory:" && resolve(inst.dbPath) === target) {
                try {
                    inst.close();
                }
                catch (cleanupError) { log.warn('[SQLITE CLEANUP] '+String(cleanupError)); }
            }
        }
    }
    public static closeAll(): void {
        for (const inst of Array.from(SqliteStoryStore.openInstances)) {
            try {
                inst.close();
            }
            catch (cleanupError) { log.warn('[SQLITE CLEANUP] '+String(cleanupError)); }
        }
        SqliteStoryStore.openInstances.clear();
    }
    public getDbPath(): string {
        return this.dbPath;
    }
    public getAppliedMigrations(): CanonMigrationRecord[] {
        if (this.db && !this.isFallback) {
            return this.db.prepare("SELECT * FROM canon_migrations ORDER BY version ASC").all() as CanonMigrationRecord[];
        }
        return [...this.memoryStore.migrations].sort((a, b) => a.version - b.version);
    }
    public isMigrationApplied(version: number): boolean {
        if (this.db && !this.isFallback) {
            const row = this.db.prepare("SELECT version FROM canon_migrations WHERE version = ?").get(version);
            return Boolean(row);
        }
        return this.memoryStore.migrations.some((m) => m.version === version);
    }
    private runMigrations(): void { return this.migrationRepository.runMigrations(); }
    private applyV6Migration(): void { return this.migrationRepository.applyV6Migration(); }
    private addColumnIfMissing(sql: string): void { return this.migrationRepository.addColumnIfMissing(sql); }
    private applyV7Migration(): void { return this.migrationRepository.applyV7Migration(); }
    private applyV8Migration(): void { return this.migrationRepository.applyV8Migration(); }
    private applySchemaSql() { return this.migrationRepository.applySchemaSql(); }
    // ── Series Metadata Operations ────────────────────────────────────────────
    public upsertSeriesMetadata(meta: SeriesMetadataRecord): void { return this.entities.upsertSeriesMetadata(meta); }
    public getSeriesMetadata(id?: string): SeriesMetadataRecord | null { return this.entities.getSeriesMetadata(id); }
    public upsertCharacter(char: CharacterRecord): void { return this.entities.upsertCharacter(char); }
    public getCharacter(id: string, seriesId?: string): CharacterRecord | null { return this.entities.getCharacter(id, seriesId); }
    public listCharacters(seriesId?: string): CharacterRecord[] { return this.entities.listCharacters(seriesId); }
    public updateCharacterStatus(id: string, status: CharacterRecord["status"], distinguishingMarks?: string): void { return this.entities.updateCharacterStatus(id, status, distinguishingMarks); }
    public upsertWardrobe(wardrobe: CharacterWardrobeRecord): void { return this.entities.upsertWardrobe(wardrobe); }
    public getWardrobe(id: string): CharacterWardrobeRecord | null { return this.entities.getWardrobe(id); }
    public listWardrobesForCharacter(characterId: string): CharacterWardrobeRecord[] { return this.entities.listWardrobesForCharacter(characterId); }
    public getCharacterWardrobe(characterId: string): CharacterWardrobeRecord | null { return this.entities.getCharacterWardrobe(characterId); }
    public setCharacterActiveWardrobe(characterId: string, wardrobeId: string): void { return this.entities.setCharacterActiveWardrobe(characterId, wardrobeId); }
    public upsertLocation(loc: LocationRecord): void { return this.entities.upsertLocation(loc); }
    public getLocation(id: string, seriesId?: string): LocationRecord | null { return this.entities.getLocation(id, seriesId); }
    public listLocations(seriesId?: string): LocationRecord[] { return this.entities.listLocations(seriesId); }
    public upsertKeyProp(prop: KeyPropRecord): void { return this.entities.upsertKeyProp(prop); }
    public upsertProp(prop: KeyPropRecord): void { return this.entities.upsertProp(prop); }
    public getProp(id: string): KeyPropRecord | null { return this.entities.getProp(id); }
    public getPropTransfers(propId: string): Array<{
        prop_id: string;
        from_holder_id?: string | null;
        to_holder_id?: string | null;
        episode_number: number;
        created_at: string;
    }> { return this.entities.getPropTransfers(propId); }
    public getKeyProp(id: string, seriesId?: string): KeyPropRecord | null { return this.entities.getKeyProp(id, seriesId); }
    public listKeyProps(seriesId?: string): KeyPropRecord[] { return this.entities.listKeyProps(seriesId); }
    public transferKeyProp(propId: string, newHolderId?: string, status?: KeyPropRecord["status"]): void { return this.entities.transferKeyProp(propId, newHolderId, status); }
    public addKnowledge(characterId: string, factKey: string, revealedInEpisode: number, notes?: string): void { return this.entities.addKnowledge(characterId, factKey, revealedInEpisode, notes); }
    public getCharacterKnowledge(characterId: string, upToEpisode?: number): CharacterKnowledgeRecord[] { return this.entities.getCharacterKnowledge(characterId, upToEpisode); }
    public setWorldState(key: string, value: unknown, episodeNumber: number, seriesId?: string): void { return this.entities.setWorldState(key, value, episodeNumber, seriesId); }
    public getWorldState(key: string, seriesId?: string): unknown | null { return this.entities.getWorldState(key, seriesId); }
    public getWorldStateForEpisode(seriesId: string, episodeNumber: number): Record<string, unknown> { return this.entities.getWorldStateForEpisode(seriesId, episodeNumber); }
    public listCharactersForEpisode(seriesId: string, episode: number): CharacterRecord[] { return this.canonRepository.listCharactersForEpisode(seriesId, episode); }
    public listKeyPropsForEpisode(seriesId: string, episode: number): KeyPropRecord[] { return this.canonRepository.listKeyPropsForEpisode(seriesId, episode); }
    public getAllWorldState(seriesId?: string): Record<string, unknown> { return this.entities.getAllWorldState(seriesId); }
    public recordEpisodeSummary(record: EpisodeSummaryRecord): void { return this.entities.recordEpisodeSummary(record); }
    public getEpisodeSummary(episodeNumber: number, seriesId?: string): EpisodeSummaryRecord | null { return this.entities.getEpisodeSummary(episodeNumber, seriesId); }
    public listEpisodeSummaries(seriesId?: string): EpisodeSummaryRecord[] { return this.entities.listEpisodeSummaries(seriesId); }
    public getCanonHistory(seriesId?: string): EpisodeSummaryRecord[] {
        return this.listEpisodeSummaries(seriesId);
    }
    /**
     * Applies approved delta changes to the Story Bible after episode completion.
     * Tracks character/prop state transitions and emits state_events.
     */
    public applyNarrativeDelta(episodeNumber: number, delta: NarrativeDelta, options?: {
        seriesId?: string;
        confirmationSource?: StateEventRecord["confirmation_source"];
        storyTime?: string;
        sceneId?: string | null;
    }): void { return this.transaction(() => this.canonRepository.applyNarrativeDelta(episodeNumber, delta, options)); }
    // ── Context Prompt Generation & Negative Constraints ─────────────────────
    /**
     * Generates a concise context injection prompt for LLM script generators
     * to ensure narrative and visual coherence before writing or normalizing a new episode.
     */
    public generateContextPrompt(episodeNumber: number, activeCharacterIds: string[] = [], seriesId?: string): string { return this.canonRepository.generateContextPrompt(episodeNumber, activeCharacterIds, seriesId); }
    /**
     * Returns a list of strict negative constraints that MUST NOT be violated.
     */
    public getNegativeConstraints(episodeNumber: number, seriesId?: string): string[] { return this.canonRepository.getNegativeConstraints(episodeNumber, seriesId); }
    // ── Cost Tracking & Budget Guard ─────────────────────────────────────────
    public logApiUsage(record: ApiUsageRecord & {
        series_id?: string;
    }): void { return this.providerJobsRepository.logApiUsage(record); }
    public getEpisodeCost(episodeNumber: number, seriesId?: string): number { return this.providerJobsRepository.getEpisodeCost(episodeNumber, seriesId); }
    // ── Continuity Auditor Integration ──────────────────────────────────────
    /**
     * Exports the consolidated Story Bible state prior to the target episode.
     */
    public exportBiblePayload(episodeNumber: number, seriesId?: string): StoryBiblePayload { return this.canonRepository.exportBiblePayload(episodeNumber, seriesId); }
    /**
     * Evaluates a draft script against the Story Bible using the ContinuityAuditor.
     */
    public async auditDraftScript(episodeNumber: number, draftScript: string, invoker?: LlmInvoker | {
        llmInvoker?: LlmInvoker;
        promptTemplate?: string;
    }): Promise<ContinuityAuditResult> { return this.canonRepository.auditDraftScript(episodeNumber, draftScript, invoker); }
    // ── Narrative Delta Validation & Commit Idempotency ──────────────────────
    public validateNarrativeDelta(delta: NarrativeDelta, seriesId?: string): {
        valid: boolean;
        errors: string[];
    } { return this.canonRepository.validateNarrativeDelta(delta, seriesId); }
    public isCommitApplied(commitId: string): boolean { return this.canonRepository.isCommitApplied(commitId); }
    /**
     * Commits an approved episode to the Story Bible with transactional atomicity:
     * 1. Validates delta references against existing canon entities.
     * 2. Checks commit idempotency (never applied twice).
     * 3. Enforces episode lifecycle (dry-runs, unapproved drafts cannot mutate canon).
     * 4. Atomically records summary, applies delta, logs state_events, marks lifecycle committed,
     *    and invalidates downstream episodes in a single SQLite transaction.
     */
    public commitEpisode(summaryOrOptions: EpisodeSummaryRecord | {
        episodeNumber?: number;
        episode_number?: number;
        title?: string;
        logline?: string;
        majorEvents?: string[];
        major_events?: string[];
        delta?: NarrativeDelta;
        delta_changes?: Record<string, unknown>;
        commitId?: string;
        seriesId?: string;
        force?: boolean;
        created_at?: string;
    }, deltaArg?: NarrativeDelta, optionsArg?: {
        commitId?: string;
        seriesId?: string;
        confirmationSource?: StateEventRecord["confirmation_source"];
        storyTime?: string;
        force?: boolean;
    }): {
        applied: boolean;
        commitId: string;
        reason?: string;
        episode_number: number;
        title: string;
    } { return this.canonRepository.commitEpisode(summaryOrOptions, deltaArg, optionsArg); }
    // ── State Events Operations ──────────────────────────────────────────────
    public recordStateEvent(event: StateEventRecord): void { return this.canonRepository.recordStateEvent(event); }
    public listStateEvents(options?: {
        seriesId?: string;
        episodeNumber?: number;
        entityType?: string;
        entityId?: string;
    }): StateEventRecord[] { return this.canonRepository.listStateEvents(options); }
    // ── Character, Prop & Location State Operations (Archetype vs Episodic) ──
    public getCharacterArchetype(characterId: string): Omit<CharacterRecord, "status" | "current_wardrobe_id" | "distinguishing_marks"> | null { return this.canonRepository.getCharacterArchetype(characterId); }
    public getCharacterState(characterId: string, episodeNumber?: number): CharacterStateRecord | null { return this.canonRepository.getCharacterState(characterId, episodeNumber); }
    public setCharacterState(state: CharacterStateRecord): void { return this.canonRepository.setCharacterState(state); }
    public getPropArchetype(propId: string): Omit<KeyPropRecord, "current_holder_id" | "status"> | null { return this.canonRepository.getPropArchetype(propId); }
    public getPropState(propId: string, episodeNumber?: number): PropStateRecord | null { return this.canonRepository.getPropState(propId, episodeNumber); }
    public setPropState(state: PropStateRecord): void { return this.canonRepository.setPropState(state); }
    public getLocationArchetype(locationId: string): Omit<LocationRecord, "atmospheric_rules" | "lighting_mood"> | null { return this.canonRepository.getLocationArchetype(locationId); }
    public getLocationState(locationId: string, episodeNumber?: number): LocationStateRecord | null { return this.canonRepository.getLocationState(locationId, episodeNumber); }
    public setLocationState(state: LocationStateRecord): void { return this.canonRepository.setLocationState(state); }
    // ── Episode Lifecycle State Machine ──────────────────────────────────────
    public getEpisodeLifecycle(seriesId: string, episodeNumber: number): EpisodeLifecycleRecord | null { return this.canonRepository.getEpisodeLifecycle(seriesId, episodeNumber); }
    public setEpisodeLifecycle(recordOrEpisodeNumber: {
        seriesId: string;
        episodeNumber: number;
        status: EpisodeLifecycleStatus;
        snapshotId?: string | null;
        reviewNotes?: string | null;
        needsReview?: boolean;
        storyboardApprovedAt?: string | null;
        storyboard_approved_at?: string | null;
    } | number, statusPositional?: EpisodeLifecycleStatus, reviewNotesPositional?: string | null, seriesIdPositional?: string): void { return this.canonRepository.setEpisodeLifecycle(recordOrEpisodeNumber, statusPositional, reviewNotesPositional, seriesIdPositional); }
    public invalidateDownstreamEpisodes(seriesId: string, fromEpisodeNumber: number, reason: string): number { return this.canonRepository.invalidateDownstreamEpisodes(seriesId, fromEpisodeNumber, reason); }
    // ── Immutable Canon Snapshots ────────────────────────────────────────────
    public createCanonSnapshot(seriesId: string, episodeNumber: number, snapshotVersion: number = 1, branchId?: string): CanonSnapshotRecord { return this.canonRepository.createCanonSnapshot(seriesId, episodeNumber, snapshotVersion, branchId); }
    public getCanonSnapshot(snapshotId: string): CanonSnapshotRecord | null { return this.canonRepository.getCanonSnapshot(snapshotId); }
    public getSnapshotForEpisode(seriesId: string, episodeNumber: number): CanonSnapshotRecord | null { return this.canonRepository.getSnapshotForEpisode(seriesId, episodeNumber); }
    public listCanonSnapshots(seriesId: string, episodeNumber?: number): CanonSnapshotRecord[] { return this.canonRepository.listCanonSnapshots(seriesId, episodeNumber); }
    // ── Branching Timeline / Multiverse Operations ────────────────────────────
    public ensureRootCanonicalBranch(seriesId: string): TimelineBranchRecord { return this.canonRepository.ensureRootCanonicalBranch(seriesId); }
    public forkBranch(seriesId: string, options: ForkBranchOptions): TimelineBranchRecord { return this.canonRepository.forkBranch(seriesId, options); }
    public listBranches(seriesId: string): TimelineBranchRecord[] { return this.canonRepository.listBranches(seriesId); }
    public getBranch(branchId: string): TimelineBranchRecord | null { return this.canonRepository.getBranch(branchId); }
    public getActiveCanonicalBranch(seriesId: string): TimelineBranchRecord | null { return this.canonRepository.getActiveCanonicalBranch(seriesId); }
    public promoteBranchToCanonical(seriesId: string, branchId: string): void { return this.canonRepository.promoteBranchToCanonical(seriesId, branchId); }
    public compareBranches(seriesId: string, branchAId: string, branchBId: string): MultiverseBranchDiff { return this.canonRepository.compareBranches(seriesId, branchAId, branchBId); }
    // ── Shot Takes Operations ────────────────────────────────────────────────
    public recordShotTake(take: ShotTakeRecord): void { return this.referencesRepository.recordShotTake(take); }
    public upsertShotTake(take: ShotTakeRecord): void { return this.referencesRepository.upsertShotTake(take); }
    /**
     * Atomically reserves the next available take number, take ID, and reservation path
     * under concurrency across multiple workers or processes.
     * Acquires an immediate SQLite write lock with BEGIN IMMEDIATE TRANSACTION; to eliminate race conditions.
     * Enforces composite uniqueness on (series_id, episode_number, shot_id, take_number).
     */
    public atomicReserveShotTake(params: AtomicReserveShotTakeParams): AtomicReserveShotTakeResult { return this.referencesRepository.atomicReserveShotTake(params); }
    public getShotTake(takeId: string): ShotTakeRecord | null { return this.referencesRepository.getShotTake(takeId); }
    public getEquivalentShotIds(shotId: string): string[] { return this.referencesRepository.getEquivalentShotIds(shotId); }
    public listShotTakes(seriesId: string, episodeNumber: number, shotId?: string): ShotTakeRecord[] { return this.referencesRepository.listShotTakes(seriesId, episodeNumber, shotId); }
    public updateShotTakeQa(takeId: string, qa: {
        qa_status: "PASS" | "WARN" | "FAIL" | "NOT_RUN" | "UNAVAILABLE";
        qa_score?: number;
        qa_notes?: string;
        qa_report_json?: string;
    }): void { return this.referencesRepository.updateShotTakeQa(takeId, qa); }
    public approveShotTake(takeId: string): void { return this.referencesRepository.approveShotTake(takeId); }
    public selectShotTake(takeId: string): void { return this.referencesRepository.selectShotTake(takeId); }
    public rejectShotTake(takeId: string, rejectionReason?: string): void { return this.referencesRepository.rejectShotTake(takeId, rejectionReason); }
    public getApprovedTakeForShot(seriesId: string, episodeNumber: number, shotId: string): ShotTakeRecord | null { return this.referencesRepository.getApprovedTakeForShot(seriesId, episodeNumber, shotId); }
    public getNextTakeNumber(seriesId: string, episodeNumber: number, shotId: string): number { return this.referencesRepository.getNextTakeNumber(seriesId, episodeNumber, shotId); }
    public getSeriesCostAndTakesSummary(seriesId: string): {
        totalTakes: number;
        approvedTakes: number;
        totalCostUsd: number;
        episodes: Array<{
            episodeNumber: number;
            takeCount: number;
            approvedCount: number;
            costUsd: number;
        }>;
    } { return this.referencesRepository.getSeriesCostAndTakesSummary(seriesId); }
    // ── Versioned Reference Asset Operations (V3) ─────────────────────────────
    public addReferenceAsset(asset: ReferenceAssetRecord): void { return this.referencesRepository.addReferenceAsset(asset); }
    public getReferenceAsset(assetId: string): ReferenceAssetRecord | null { return this.referencesRepository.getReferenceAsset(assetId); }
    public listReferenceAssets(seriesId: string, entityType?: string, entityId?: string, activeOnly: boolean = true): ReferenceAssetRecord[] { return this.referencesRepository.listReferenceAssets(seriesId, entityType, entityId, activeOnly); }
    public deprecateReferenceAsset(assetId: string): void { return this.referencesRepository.deprecateReferenceAsset(assetId); }
    // ── Storyboard Keyframe Operations (V3) ───────────────────────────────────
    public recordStoryboardKeyframe(keyframe: StoryboardKeyframeRecord): void { return this.referencesRepository.recordStoryboardKeyframe(keyframe); }
    public getStoryboardKeyframe(keyframeId: string): StoryboardKeyframeRecord | null { return this.referencesRepository.getStoryboardKeyframe(keyframeId); }
    public listStoryboardKeyframes(seriesId: string, episodeNumber: number, shotId?: string): StoryboardKeyframeRecord[] { return this.referencesRepository.listStoryboardKeyframes(seriesId, episodeNumber, shotId); }
    public getApprovedStoryboardForShot(seriesId: string, episodeNumber: number, shotId: string): StoryboardKeyframeRecord | null { return this.referencesRepository.getApprovedStoryboardForShot(seriesId, episodeNumber, shotId); }
    public approveStoryboardKeyframe(keyframeId: string, isApproved: boolean = true): void { return this.referencesRepository.approveStoryboardKeyframe(keyframeId, isApproved); }
    // ============================================================================
    // PROVIDER JOBS & RESILIENT ORCHESTRATION (MIGRATION V4)
    // ============================================================================
    public createOrUpdateProviderJob(job: ProviderJobRecord): void { return this.providerJobsRepository.createOrUpdateProviderJob(job); }
    /**
     * Atomically checks available balance, checks worker lease, and reserves budget
     * for a provider job inside an immediate SQLite transaction (BEGIN IMMEDIATE TRANSACTION).
     * Free jobs (estimatedCost = 0) strictly retain 0.0 without default substitutions.
     */
    public atomicReserveProviderJob(job: ProviderJobRecord, options: {
        budgetCapUsd?: number;
        workerLeaseSec?: number;
    } = {}): {
        allowed: boolean;
        remainingUsd: number;
        totalCommittedUsd: number;
        reason?: string;
        reservedRecord?: ProviderJobRecord;
    } { return this.providerJobsRepository.atomicReserveProviderJob(job, options); }
    public getProviderJobsForShot(seriesId: string, episodeNumber: number, shotId: string): ProviderJobRecord[] { return this.providerJobsRepository.getProviderJobsForShot(seriesId, episodeNumber, shotId); }
    public getProviderJob(id: string): ProviderJobRecord | null { return this.providerJobsRepository.getProviderJob(id); }
    public findJobByRemoteId(provider: string, providerJobId: string): ProviderJobRecord | null { return this.providerJobsRepository.findJobByRemoteId(provider, providerJobId); }
    public findCompletedJobBySpecHash(specHash: string): ProviderJobRecord | null { return this.providerJobsRepository.findCompletedJobBySpecHash(specHash); }
    public listPendingJobsForSeries(seriesId: string, episodeNumber?: number): ProviderJobRecord[] { return this.providerJobsRepository.listPendingJobsForSeries(seriesId, episodeNumber); }
    public listProviderJobs(seriesId?: string, episodeNumber?: number): ProviderJobRecord[] { return this.providerJobsRepository.listProviderJobs(seriesId, episodeNumber); }
    public acquireJobLease(jobId: string, workerId: string, leaseDurationMs: number = 60000): boolean { return this.providerJobsRepository.acquireJobLease(jobId, workerId, leaseDurationMs); }
    public releaseJobLease(jobId: string, workerId: string): void { return this.providerJobsRepository.releaseJobLease(jobId, workerId); }
    public setSeriesBudget(budgetOrSeriesId: SeriesBudgetRecord | string, maxBudgetUsd?: number, warningThresholdRatio?: number, isHardCapped?: boolean, notes?: string): void { return this.providerJobsRepository.setSeriesBudget(budgetOrSeriesId, maxBudgetUsd, warningThresholdRatio, isHardCapped, notes); }
    public getSeriesBudget(seriesId: string): SeriesBudgetRecord { return this.providerJobsRepository.getSeriesBudget(seriesId); }
    public getSeriesBudgetLedger(seriesId: string): BudgetLedgerSummary { return this.providerJobsRepository.getSeriesBudgetLedger(seriesId); }
    public atomicReserveBudget(seriesId: string, amountUsd: number): {
        allowed: boolean;
        remaining: number;
        totalCommitted: number;
    } { return this.providerJobsRepository.atomicReserveBudget(seriesId, amountUsd); }
    public setRateCard(rateCard: any): void { return this.providerJobsRepository.setRateCard(rateCard); }
    public getRateCard(provider: string, modelName?: string): ProviderRateCardRecord | null { return this.providerJobsRepository.getRateCard(provider, modelName); }
    public listRateCards(provider?: string): ProviderRateCardRecord[] { return this.providerJobsRepository.listRateCards(provider); }
    public atomicReserveProviderGroup(group: ProviderAttemptGroup, jobs: ProviderJobRecord[], cap?: number, forceNew = false, maxReRolls = 2): boolean { return this.providerJobsRepository.atomicReserveProviderGroup(group, jobs, cap, forceNew, maxReRolls); }
    public recordLlmTokenUsage(usage: Omit<LlmTokenUsageRecord, "created_at"> & {
        created_at?: string;
    }): void { return this.providerJobsRepository.recordLlmTokenUsage(usage); }
    public getLlmTokenUsageSummary(seriesId: string): LlmTokenUsageSummary { return this.providerJobsRepository.getLlmTokenUsageSummary(seriesId); }
    // ── Novel Ingestion & Source Operations (V6) ──────────────────────────────
    public upsertSourceWork(work: SourceWorkRecord): void { return this.sourcesRepository.upsertSourceWork(work); }
    public getSourceWork(id: string): SourceWorkRecord | null { return this.sourcesRepository.getSourceWork(id); }
    public listSourceWorks(seriesId?: string): SourceWorkRecord[] { return this.sourcesRepository.listSourceWorks(seriesId); }
    public deleteSourceWork(id: string): void { return this.sourcesRepository.deleteSourceWork(id); }
    // ── Source Revision Operations (Immutable Provenance) ─────────────────────
    public recordSourceRevision(rev: SourceRevisionRecord): void { return this.sourcesRepository.recordSourceRevision(rev); }
    public recordSourceWorkWithRevision(work: SourceWorkRecord, rev: SourceRevisionRecord, expectedPreviousRevision?: number): void { return this.sourcesRepository.recordSourceWorkWithRevision(work, rev, expectedPreviousRevision); }
    public getSourceRevision(sourceId: string, revision: number): SourceRevisionRecord | null { return this.sourcesRepository.getSourceRevision(sourceId, revision); }
    public listSourceRevisions(sourceId: string): SourceRevisionRecord[] { return this.sourcesRepository.listSourceRevisions(sourceId); }
    // ── Source Unit Operations (Chapters / Scenes) ────────────────────────────
    public upsertSourceUnit(unit: SourceUnitRecord): void { return this.sourcesRepository.upsertSourceUnit(unit); }
    public getSourceUnit(id: string): SourceUnitRecord | null { return this.sourcesRepository.getSourceUnit(id); }
    public listSourceUnits(sourceId: string, revision?: number): SourceUnitRecord[] { return this.sourcesRepository.listSourceUnits(sourceId, revision); }
    public batchUpsertSourceUnits(units: SourceUnitRecord[]): void { return this.sourcesRepository.batchUpsertSourceUnits(units); }
    // ── Source Block Operations (Paragraphs / Chunks) ──────────────────────────
    public upsertSourceBlock(block: SourceBlockRecord): void { return this.sourcesRepository.upsertSourceBlock(block); }
    public listSourceBlocks(unitId: string): SourceBlockRecord[] { return this.sourcesRepository.listSourceBlocks(unitId); }
    public batchUpsertSourceBlocks(blocks: SourceBlockRecord[]): void { return this.sourcesRepository.batchUpsertSourceBlocks(blocks); }
    // ── Story Beats Operations ────────────────────────────────────────────────
    public recordStoryBeat(beat: StoryBeatRecord): StoryBeatRecord { return this.sourcesRepository.recordStoryBeat(beat); }
    public upsertStoryBeat(beat: StoryBeatRecord): void { return this.sourcesRepository.upsertStoryBeat(beat); }
    public getStoryBeat(id: string): StoryBeatRecord | null { return this.sourcesRepository.getStoryBeat(id); }
    public listStoryBeats(seriesId: string, sourceId?: string): StoryBeatRecord[] { return this.sourcesRepository.listStoryBeats(seriesId, sourceId); }
    public batchUpsertStoryBeats(beats: StoryBeatRecord[]): void { return this.sourcesRepository.batchUpsertStoryBeats(beats); }
    // ── Story Threads Operations ──────────────────────────────────────────────
    public upsertStoryThread(thread: StoryThreadRecord): void { return this.sourcesRepository.upsertStoryThread(thread); }
    public getStoryThread(id: string): StoryThreadRecord | null { return this.sourcesRepository.getStoryThread(id); }
    public listStoryThreads(seriesId: string, status?: string): StoryThreadRecord[] { return this.sourcesRepository.listStoryThreads(seriesId, status); }
    // ── Knowledge States Operations ───────────────────────────────────────────
    public recordKnowledgeState(record: Omit<KnowledgeStateRecord, "id" | "created_at">): KnowledgeStateRecord { return this.sourcesRepository.recordKnowledgeState(record); }
    public listKnowledgeStates(seriesId: string, entityId?: string, factType?: string): KnowledgeStateRecord[] { return this.sourcesRepository.listKnowledgeStates(seriesId, entityId, factType); }
    // ── Series Adaptation Plans Operations ────────────────────────────────────
    public upsertSeriesPlan(plan: SeriesPlanRecord): void { return this.sourcesRepository.upsertSeriesPlan(plan); }
    public getSeriesPlan(id: string): SeriesPlanRecord | null { return this.sourcesRepository.getSeriesPlan(id); }
    public listSeriesPlans(seriesId: string): SeriesPlanRecord[] { return this.sourcesRepository.listSeriesPlans(seriesId); }
    public getActiveSeriesPlan(seriesId: string): SeriesPlanRecord | null { return this.sourcesRepository.getActiveSeriesPlan(seriesId); }
    public approveSeriesPlan(planId: string): SeriesPlanRecord | null { return this.sourcesRepository.approveSeriesPlan(planId); }
    public activateSeriesPlan(planId: string): SeriesPlanRecord | null { return this.sourcesRepository.activateSeriesPlan(planId); }
    public setSeriesPlanStatus(planId: string, status: "draft" | "approved" | "active" | "stale" | "archived"): SeriesPlanRecord | null { return this.sourcesRepository.setSeriesPlanStatus(planId, status); }
    // ── Planned Episodes Operations ───────────────────────────────────────────
    public upsertPlannedEpisode(ep: PlannedEpisodeRecord): void { return this.sourcesRepository.upsertPlannedEpisode(ep); }
    public getPlannedEpisode(planIdOrId: string, episodeNumber?: number): PlannedEpisodeRecord | null { return this.sourcesRepository.getPlannedEpisode(planIdOrId, episodeNumber); }
    public listPlannedEpisodes(planId: string): PlannedEpisodeRecord[] { return this.sourcesRepository.listPlannedEpisodes(planId); }
    public batchUpsertPlannedEpisodes(episodes: PlannedEpisodeRecord[]): void { return this.sourcesRepository.batchUpsertPlannedEpisodes(episodes); }
    // ── Coverage Ledger Operations ────────────────────────────────────────────
    public upsertCoverageLedger(cov: CoverageLedgerRecord): void { return this.sourcesRepository.upsertCoverageLedger(cov); }
    public listCoverageLedgers(planOrSeriesId: string): CoverageLedgerRecord[] { return this.sourcesRepository.listCoverageLedgers(planOrSeriesId); }
    public batchUpsertCoverageLedgers(ledgers: CoverageLedgerRecord[]): void { return this.sourcesRepository.batchUpsertCoverageLedgers(ledgers); }
    // ── Novel Analysis Review Queue Operations (PR3) ──────────────────────────
    public enqueueReviewItem(item: AnalysisReviewItemRecord | Omit<AnalysisReviewItemRecord, "created_at">): AnalysisReviewItemRecord { return this.sourcesRepository.enqueueReviewItem(item); }
    public getReviewItem(id: string): AnalysisReviewItemRecord | null { return this.sourcesRepository.getReviewItem(id); }
    public listReviewItems(seriesId?: string, status?: string): AnalysisReviewItemRecord[] { return this.sourcesRepository.listReviewItems(seriesId, status); }
    public getPendingReviewItems(seriesId?: string): AnalysisReviewItemRecord[] { return this.sourcesRepository.getPendingReviewItems(seriesId); }
    public approveReviewItem(id: string, reviewNotes?: string): boolean { return this.sourcesRepository.approveReviewItem(id, reviewNotes); }
    public rejectReviewItem(id: string, reviewNotes?: string): boolean { return this.sourcesRepository.rejectReviewItem(id, reviewNotes); }
    // ── Chekhov's Gun / Narrative Foreshadowing Operations ────────────────────
    public plantChekhovGun(gun: ChekhovGunRecord): ChekhovGunRecord { return this.sourcesRepository.plantChekhovGun(gun); }
    public updateChekhovGunActivity(id: string, episodeNumber: number, status?: "planted" | "active"): boolean { return this.sourcesRepository.updateChekhovGunActivity(id, episodeNumber, status); }
    public resolveChekhovGun(id: string, episodeNumber: number, beatId?: string, status: "resolved" | "abandoned" = "resolved"): boolean { return this.sourcesRepository.resolveChekhovGun(id, episodeNumber, beatId, status); }
    public getChekhovGun(id: string): ChekhovGunRecord | null { return this.sourcesRepository.getChekhovGun(id); }
    public listChekhovGuns(seriesId: string, status?: string): ChekhovGunRecord[] { return this.sourcesRepository.listChekhovGuns(seriesId, status); }
    public listActiveChekhovGuns(seriesId: string, currentEpisode: number): ChekhovGunRecord[] { return this.sourcesRepository.listActiveChekhovGuns(seriesId, currentEpisode); }
}
export { SqliteStoryStore as StoryBibleManager };
