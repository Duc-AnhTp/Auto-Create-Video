import {log} from '../../../../platform/observability/logger.js';

import type { TimelineBranchManagerStore } from "../../ports/timeline-branch-manager-store.js";

export interface TimelineBranchRecord {
  id: string;
  series_id: string;
  name: string;
  description?: string | null;
  parent_branch_id?: string | null;
  forked_from_snapshot_id?: string | null;
  forked_at_episode: number;
  is_canonical: number; // 0 or 1
  created_at: string;
}

export interface BranchSnapshotRecord {
  branch_id: string;
  episode_number: number;
  snapshot_id: string;
  created_at: string;
}

export interface ForkBranchOptions {
  name: string;
  description?: string;
  parentBranchId?: string;
  fromSnapshotId?: string;
  fromEpisodeNumber?: number;
}

export interface MultiverseBranchDiff {
  seriesId: string;
  branchA: { id: string; name: string; isCanonical: boolean };
  branchB: { id: string; name: string; isCanonical: boolean };
  forkedAtEpisode: number;
  divergentEpisodes: number[];
  characterStatusDiffs: Array<{
    characterId: string;
    characterName: string;
    statusInBranchA: string;
    statusInBranchB: string;
  }>;
  propHolderDiffs: Array<{
    propId: string;
    propName: string;
    holderInBranchA: string | null;
    holderInBranchB: string | null;
  }>;
  stateHashDiffs: Array<{
    episodeNumber: number;
    snapshotHashA?: string;
    snapshotHashB?: string;
    isIdentical: boolean;
  }>;
}

/**
 * Branching Timeline & Multiverse Engine:
 * Enables directors to fork storylines into parallel What-If alternate cuts
 * from any historical canon snapshot, compare multiverse state diffs,
 * and promote an alternate branch to official canon without destructive overwrites.
 */
export class TimelineBranchManager {
  private inMemoryBranches: Map<string, TimelineBranchRecord> = new Map();
  private inMemoryBranchSnapshots: Map<string, BranchSnapshotRecord> = new Map();

  constructor(
    private db?: any,
    private isFallback: boolean = false
  ) {}

  /**
   * Generates a slug for branch ID generation.
   */
  private static slugify(text: string): string {
    return text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 32);
  }

  /**
   * Ensures the root canonical branch (`main`) exists for a given series.
   */
  public ensureRootCanonicalBranch(seriesId: string): TimelineBranchRecord {
    const rootId = `branch_${seriesId}_main`;

    if (this.db && !this.isFallback) {
      const existing = this.db
        .prepare("SELECT * FROM timeline_branches WHERE series_id = ? AND is_canonical = 1 LIMIT 1")
        .get(seriesId) as TimelineBranchRecord | undefined;

      if (existing) {
        return existing;
      }

      const now = new Date().toISOString();
      const rootRecord: TimelineBranchRecord = {
        id: rootId,
        series_id: seriesId,
        name: "Canon Main",
        description: "Dòng thời gian chính thức của tác phẩm",
        parent_branch_id: null,
        forked_from_snapshot_id: null,
        forked_at_episode: 1,
        is_canonical: 1,
        created_at: now,
      };

      this.db
        .prepare(`
          INSERT INTO timeline_branches (id, series_id, name, description, parent_branch_id, forked_from_snapshot_id, forked_at_episode, is_canonical, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET is_canonical = 1
        `)
        .run(
          rootRecord.id,
          rootRecord.series_id,
          rootRecord.name,
          rootRecord.description,
          rootRecord.parent_branch_id,
          rootRecord.forked_from_snapshot_id,
          rootRecord.forked_at_episode,
          rootRecord.is_canonical,
          rootRecord.created_at
        );

      return rootRecord;
    }

    // In-Memory Fallback
    const existing = Array.from(this.inMemoryBranches.values()).find(
      (b) => b.series_id === seriesId && b.is_canonical === 1
    );
    if (existing) return existing;

    const now = new Date().toISOString();
    const rootRecord: TimelineBranchRecord = {
      id: rootId,
      series_id: seriesId,
      name: "Canon Main",
      description: "Dòng thời gian chính thức của tác phẩm",
      parent_branch_id: null,
      forked_from_snapshot_id: null,
      forked_at_episode: 1,
      is_canonical: 1,
      created_at: now,
    };
    this.inMemoryBranches.set(rootId, rootRecord);
    return rootRecord;
  }

  /**
   * Forks a new timeline branch from an existing snapshot or episode.
   */
  public forkBranch(
    bible: Pick<TimelineBranchManagerStore,"getSnapshotForEpisode"|"getCanonSnapshot">,
    seriesId: string,
    options: ForkBranchOptions
  ): TimelineBranchRecord {
    const root = this.ensureRootCanonicalBranch(seriesId);
    const parentBranchId = options.parentBranchId || root.id;

    let snapshotId = options.fromSnapshotId;
    let forkedAtEpisode = options.fromEpisodeNumber ?? 1;

    if (!snapshotId && options.fromEpisodeNumber !== undefined) {
      const snap = bible.getSnapshotForEpisode(seriesId, options.fromEpisodeNumber);
      if (snap) {
        snapshotId = snap.id;
        forkedAtEpisode = snap.episode_number;
      }
    } else if (snapshotId) {
      const snap = bible.getCanonSnapshot(snapshotId);
      if (snap) {
        forkedAtEpisode = snap.episode_number;
      }
    }

    const branchSlug = TimelineBranchManager.slugify(options.name || "what_if");
    const uniqueSuffix = Date.now().toString(36);
    const branchId = `branch_${seriesId}_${branchSlug}_${uniqueSuffix}`;
    const now = new Date().toISOString();

    const record: TimelineBranchRecord = {
      id: branchId,
      series_id: seriesId,
      name: options.name,
      description: options.description || `Nhánh thử nghiệm từ Tập ${forkedAtEpisode}`,
      parent_branch_id: parentBranchId,
      forked_from_snapshot_id: snapshotId || null,
      forked_at_episode: forkedAtEpisode,
      is_canonical: 0,
      created_at: now,
    };

    if (this.db && !this.isFallback) {
      this.db
        .prepare(`
          INSERT INTO timeline_branches (id, series_id, name, description, parent_branch_id, forked_from_snapshot_id, forked_at_episode, is_canonical, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          record.id,
          record.series_id,
          record.name,
          record.description,
          record.parent_branch_id,
          record.forked_from_snapshot_id,
          record.forked_at_episode,
          record.is_canonical,
          record.created_at
        );

      // Copy parent branch snapshot mappings up to forkedAtEpisode
      const parentSnapshots = this.db
        .prepare("SELECT * FROM branch_snapshots WHERE branch_id = ? AND episode_number <= ?")
        .all(parentBranchId, forkedAtEpisode) as BranchSnapshotRecord[];

      const insertBranchSnap = this.db.prepare(`
        INSERT INTO branch_snapshots (branch_id, episode_number, snapshot_id, created_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(branch_id, episode_number) DO UPDATE SET snapshot_id = excluded.snapshot_id
      `);

      for (const ps of parentSnapshots) {
        insertBranchSnap.run(branchId, ps.episode_number, ps.snapshot_id, now);
      }
    } else {
      this.inMemoryBranches.set(branchId, record);
      // Copy in-memory mappings
      for (const [key, bs] of this.inMemoryBranchSnapshots.entries()) {
        if (bs.branch_id === parentBranchId && bs.episode_number <= forkedAtEpisode) {
          const newKey = `${branchId}_${bs.episode_number}`;
          this.inMemoryBranchSnapshots.set(newKey, {
            branch_id: branchId,
            episode_number: bs.episode_number,
            snapshot_id: bs.snapshot_id,
            created_at: now,
          });
        }
      }
    }

    return record;
  }

  /**
   * Binds an episode snapshot to a specific branch.
   */
  public bindSnapshotToBranch(branchId: string, episodeNumber: number, snapshotId: string): void {
    const now = new Date().toISOString();

    if (this.db && !this.isFallback) {
      this.db
        .prepare(`
          INSERT INTO branch_snapshots (branch_id, episode_number, snapshot_id, created_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(branch_id, episode_number) DO UPDATE SET
            snapshot_id = excluded.snapshot_id,
            created_at = excluded.created_at
        `)
        .run(branchId, episodeNumber, snapshotId, now);
    } else {
      const key = `${branchId}_${episodeNumber}`;
      this.inMemoryBranchSnapshots.set(key, {
        branch_id: branchId,
        episode_number: episodeNumber,
        snapshot_id: snapshotId,
        created_at: now,
      });
    }
  }

  /**
   * Lists all timeline branches for a series.
   */
  public listBranches(seriesId: string): TimelineBranchRecord[] {
    this.ensureRootCanonicalBranch(seriesId);

    if (this.db && !this.isFallback) {
      return this.db
        .prepare("SELECT * FROM timeline_branches WHERE series_id = ? ORDER BY is_canonical DESC, created_at ASC")
        .all(seriesId) as TimelineBranchRecord[];
    }

    return Array.from(this.inMemoryBranches.values())
      .filter((b) => b.series_id === seriesId)
      .sort((a, b) => b.is_canonical - a.is_canonical);
  }

  /**
   * Retrieves a branch by ID.
   */
  public getBranch(branchId: string): TimelineBranchRecord | null {
    if (this.db && !this.isFallback) {
      const row = this.db.prepare("SELECT * FROM timeline_branches WHERE id = ?").get(branchId);
      return row ? (row as TimelineBranchRecord) : null;
    }
    return this.inMemoryBranches.get(branchId) || null;
  }

  /**
   * Returns the current canonical branch for a series.
   */
  public getActiveCanonicalBranch(seriesId: string): TimelineBranchRecord | null {
    if (this.db && !this.isFallback) {
      const row = this.db
        .prepare("SELECT * FROM timeline_branches WHERE series_id = ? AND is_canonical = 1 LIMIT 1")
        .get(seriesId);
      return row ? (row as TimelineBranchRecord) : null;
    }

    return (
      Array.from(this.inMemoryBranches.values()).find(
        (b) => b.series_id === seriesId && b.is_canonical === 1
      ) || null
    );
  }

  /**
   * Atomically promotes a What-If branch to become the official Canon branch.
   */
  public promoteToCanonical(seriesId: string, branchId: string): void {
    const target = this.getBranch(branchId);
    if (!target) {
      throw new Error(`Branch not found: '${branchId}'`);
    }
    if (target.series_id !== seriesId) {
      throw new Error(`Branch '${branchId}' does not belong to series '${seriesId}'`);
    }

    if (this.db && !this.isFallback) {
      try {
        this.db.exec("BEGIN TRANSACTION;");
        this.db.prepare("UPDATE timeline_branches SET is_canonical = 0 WHERE series_id = ?").run(seriesId);
        this.db.prepare("UPDATE timeline_branches SET is_canonical = 1 WHERE id = ?").run(branchId);
        this.db.exec("COMMIT;");
      } catch (err) {
        try {
          this.db.exec("ROLLBACK;");
        } catch (caughtError) { log.warn("[timeline-branch-manager] "+String(caughtError)); }
        throw err;
      }
    } else {
      for (const b of this.inMemoryBranches.values()) {
        if (b.series_id === seriesId) {
          b.is_canonical = b.id === branchId ? 1 : 0;
        }
      }
    }
  }

  /**
   * Compares two multiverse branches and calculates structural and narrative state differences.
   */
  public compareBranches(
    bible: Pick<TimelineBranchManagerStore,"getSnapshotForEpisode"|"getCanonSnapshot">,
    seriesId: string,
    branchAId: string,
    branchBId: string
  ): MultiverseBranchDiff {
    const branchA = this.getBranch(branchAId);
    const branchB = this.getBranch(branchBId);

    if (!branchA || !branchB) {
      throw new Error("One or both branches could not be found for comparison");
    }

    // Retrieve snapshots bound to branch A and branch B
    const getBranchSnaps = (bId: string): BranchSnapshotRecord[] => {
      if (this.db && !this.isFallback) {
        return this.db
          .prepare("SELECT * FROM branch_snapshots WHERE branch_id = ? ORDER BY episode_number ASC")
          .all(bId) as BranchSnapshotRecord[];
      }
      return Array.from(this.inMemoryBranchSnapshots.values())
        .filter((bs) => bs.branch_id === bId)
        .sort((a, b) => a.episode_number - b.episode_number);
    };

    const snapsA = getBranchSnaps(branchAId);
    const snapsB = getBranchSnaps(branchBId);

    const mapA = new Map<number, string>(snapsA.map((s) => [s.episode_number, s.snapshot_id]));
    const mapB = new Map<number, string>(snapsB.map((s) => [s.episode_number, s.snapshot_id]));

    const allEpNums = Array.from(new Set([...mapA.keys(), ...mapB.keys()])).sort((a, b) => a - b);

    const stateHashDiffs: Array<{
      episodeNumber: number;
      snapshotHashA?: string;
      snapshotHashB?: string;
      isIdentical: boolean;
    }> = [];

    const divergentEpisodes: number[] = [];

    for (const ep of allEpNums) {
      const snapAId = mapA.get(ep);
      const snapBId = mapB.get(ep);

      const snapA = snapAId ? bible.getCanonSnapshot(snapAId) : null;
      const snapB = snapBId ? bible.getCanonSnapshot(snapBId) : null;

      const hashA = snapA?.state_hash;
      const hashB = snapB?.state_hash;

      const isIdentical = hashA !== undefined && hashB !== undefined && hashA === hashB;

      stateHashDiffs.push({
        episodeNumber: ep,
        snapshotHashA: hashA,
        snapshotHashB: hashB,
        isIdentical,
      });

      if (!isIdentical) {
        divergentEpisodes.push(ep);
      }
    }

    // Get the latest available snapshots of both branches to compare character and prop states
    const latestSnapA = snapsA.length > 0 ? bible.getCanonSnapshot(snapsA[snapsA.length - 1].snapshot_id) : null;
    const latestSnapB = snapsB.length > 0 ? bible.getCanonSnapshot(snapsB[snapsB.length - 1].snapshot_id) : null;

    const dataA = latestSnapA ? JSON.parse(latestSnapA.snapshot_json) : null;
    const dataB = latestSnapB ? JSON.parse(latestSnapB.snapshot_json) : null;

    const characterStatusDiffs: Array<{
      characterId: string;
      characterName: string;
      statusInBranchA: string;
      statusInBranchB: string;
    }> = [];

    if (dataA?.characters && dataB?.characters) {
      const charMapB = new Map<string, any>(dataB.characters.map((c: any) => [c.id, c]));
      for (const cA of dataA.characters) {
        const cB = charMapB.get(cA.id);
        if (cB && cA.status !== cB.status) {
          characterStatusDiffs.push({
            characterId: cA.id,
            characterName: cA.name,
            statusInBranchA: cA.status,
            statusInBranchB: cB.status,
          });
        }
      }
    }

    const propHolderDiffs: Array<{
      propId: string;
      propName: string;
      holderInBranchA: string | null;
      holderInBranchB: string | null;
    }> = [];

    if (dataA?.props && dataB?.props) {
      const propMapB = new Map<string, any>(dataB.props.map((p: any) => [p.id, p]));
      for (const pA of dataA.props) {
        const pB = propMapB.get(pA.id);
        if (pB && pA.current_holder_id !== pB.current_holder_id) {
          propHolderDiffs.push({
            propId: pA.id,
            propName: pA.name,
            holderInBranchA: pA.current_holder_id || null,
            holderInBranchB: pB.current_holder_id || null,
          });
        }
      }
    }

    return {
      seriesId,
      branchA: { id: branchA.id, name: branchA.name, isCanonical: branchA.is_canonical === 1 },
      branchB: { id: branchB.id, name: branchB.name, isCanonical: branchB.is_canonical === 1 },
      forkedAtEpisode: branchB.forked_at_episode || branchA.forked_at_episode || 1,
      divergentEpisodes,
      characterStatusDiffs,
      propHolderDiffs,
      stateHashDiffs,
    };
  }
}
