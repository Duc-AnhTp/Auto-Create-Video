/**
 * Face Similarity & ArcFace QA Evaluator (Phân Hệ IV)
 *
 * Implements empirical threshold calibration and automatic shot evaluation:
 * - Dynamic threshold calibration based on validation distributions (S_same vs S_diff)
 * - Tri-state decision: PASS (confident) | WARN (human review band) | FAIL (re-roll / alert)
 * - Auto re-roll loop bounded by maxReRolls (default 2)
 */

export interface QaCalibrationResult {
  tPass: number;
  tWarn: number;
  meanSame: number;
  meanDiff: number;
  separationMargin: number;
}

export interface ShotQaReport {
  shotId: string;
  characterId: string;
  maxSimilarity: number;
  status: "PASS" | "WARN" | "FAIL";
  reRollAttempt: number;
  shouldReRoll: boolean;
  notes: string;
}

/**
 * Computes cosine similarity between two 512-D embedding vectors.
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length || vecA.length === 0) {
    throw new Error(`Vector dimension mismatch: ${vecA.length} vs ${vecB.length}`);
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return dot / denominator;
}

/**
 * Calibrates operational thresholds using an empirical validation set
 * of same-character pairs (S_same) and different-character pairs (S_diff).
 */
export function calibrateThresholds(
  sameScores: number[],
  diffScores: number[],
  targetFar = 0.01 // Target False Accept Rate (1%)
): QaCalibrationResult {
  if (sameScores.length === 0 || diffScores.length === 0) {
    throw new Error("Cannot calibrate thresholds with empty validation distributions");
  }

  const sortedDiff = [...diffScores].sort((a, b) => a - b);
  const sortedSame = [...sameScores].sort((a, b) => a - b);

  // tPass: threshold where <= targetFar of different characters are accepted
  const farIndex = Math.min(
    Math.max(0, Math.floor(sortedDiff.length * (1 - targetFar))),
    sortedDiff.length - 1
  );
  const diffVal = sortedDiff[farIndex] ?? 0.65;
  const tPass = Math.min(Math.max(diffVal, 0.65), 0.90);

  // tWarn: 10th percentile of same-character scores (catches borderline poses)
  const warnIndex = Math.min(
    Math.max(0, Math.floor(sortedSame.length * 0.10)),
    sortedSame.length - 1
  );
  const sameVal = sortedSame[warnIndex] ?? 0.50;
  const tWarn = Math.min(Math.max(sameVal, 0.50), tPass - 0.05);

  const meanSame = sameScores.reduce((a, b) => a + b, 0) / sameScores.length;
  const meanDiff = diffScores.reduce((a, b) => a + b, 0) / diffScores.length;

  return {
    tPass: Math.round(tPass * 100) / 100,
    tWarn: Math.round(tWarn * 100) / 100,
    meanSame: Math.round(meanSame * 100) / 100,
    meanDiff: Math.round(meanDiff * 100) / 100,
    separationMargin: Math.round((meanSame - meanDiff) * 100) / 100,
  };
}

export class FaceQaEvaluator {
  public tPass: number;
  public tWarn: number;
  public maxReRolls: number;
  private reRollTracker: Map<string, number> = new Map();

  constructor(opts?: { tPass?: number; tWarn?: number; maxReRolls?: number }) {
    this.tPass = opts?.tPass ?? 0.80;
    this.tWarn = opts?.tWarn ?? 0.68;
    this.maxReRolls = opts?.maxReRolls ?? 2;
  }

  /**
   * Updates operational thresholds from empirical calibration.
   */
  public applyCalibration(cal: QaCalibrationResult): void {
    this.tPass = cal.tPass;
    this.tWarn = cal.tWarn;
  }

  /**
   * Evaluates a generated shot against the reference character embedding.
   */
  public evaluateShot(
    shotId: string,
    characterId: string,
    frameEmbeddings: number[][],
    referenceEmbedding: number[]
  ): ShotQaReport {
    if (frameEmbeddings.length === 0) {
      return {
        shotId,
        characterId,
        maxSimilarity: 0,
        status: "WARN",
        reRollAttempt: 0,
        shouldReRoll: false,
        notes: "No face detected in any sampled frame. Flagged for manual review.",
      };
    }

    let maxSim = -1;
    for (const frame of frameEmbeddings) {
      const sim = cosineSimilarity(frame, referenceEmbedding);
      if (sim > maxSim) maxSim = sim;
    }

    const currentAttempt = this.reRollTracker.get(shotId) ?? 0;

    if (maxSim >= this.tPass) {
      this.reRollTracker.delete(shotId); // reset on success
      return {
        shotId,
        characterId,
        maxSimilarity: Math.round(maxSim * 1000) / 1000,
        status: "PASS",
        reRollAttempt: currentAttempt,
        shouldReRoll: false,
        notes: `High confidence match (score ${maxSim.toFixed(3)} >= ${this.tPass})`,
      };
    }

    if (maxSim >= this.tWarn) {
      return {
        shotId,
        characterId,
        maxSimilarity: Math.round(maxSim * 1000) / 1000,
        status: "WARN",
        reRollAttempt: currentAttempt,
        shouldReRoll: false,
        notes: `Borderline similarity (${maxSim.toFixed(3)} in [${this.tWarn}, ${this.tPass}]). Flagged for director review.`,
      };
    }

    // FAIL
    const nextAttempt = currentAttempt + 1;
    this.reRollTracker.set(shotId, nextAttempt);
    const shouldReRoll = nextAttempt <= this.maxReRolls;

    return {
      shotId,
      characterId,
      maxSimilarity: Math.round(maxSim * 1000) / 1000,
      status: "FAIL",
      reRollAttempt: nextAttempt,
      shouldReRoll,
      notes: shouldReRoll
        ? `Face drifted (${maxSim.toFixed(3)} < ${this.tWarn}). Triggering auto re-roll (attempt ${nextAttempt}/${this.maxReRolls}).`
        : `Face drifted (${maxSim.toFixed(3)} < ${this.tWarn}). Max re-roll limit reached (${this.maxReRolls}). HALTING for human intervention.`,
    };
  }
}
