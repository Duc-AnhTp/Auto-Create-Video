import { describe, it, expect } from "vitest";
import {
  cosineSimilarity,
  calibrateThresholds,
  FaceQaEvaluator,
} from "./face-evaluator.js";

describe("Face Similarity & ArcFace QA Evaluator (Phân Hệ IV)", () => {
  it("computes cosine similarity accurately", () => {
    const v1 = [1, 0, 0];
    const v2 = [1, 0, 0];
    expect(cosineSimilarity(v1, v2)).toBeCloseTo(1.0);

    const vOrthogonal = [0, 1, 0];
    expect(cosineSimilarity(v1, vOrthogonal)).toBeCloseTo(0.0);

    const vOpposite = [-1, 0, 0];
    expect(cosineSimilarity(v1, vOpposite)).toBeCloseTo(-1.0);
  });

  it("calibrates thresholds from empirical validation distributions", () => {
    // Simulated same character similarity distribution (0.75 - 0.95)
    const sameScores = [0.75, 0.78, 0.82, 0.85, 0.87, 0.89, 0.92, 0.94];
    // Simulated different character similarity distribution (0.15 - 0.45)
    const diffScores = [0.15, 0.20, 0.25, 0.30, 0.32, 0.35, 0.40, 0.45];

    const cal = calibrateThresholds(sameScores, diffScores, 0.01);
    expect(cal.tPass).toBeGreaterThan(cal.tWarn);
    expect(cal.separationMargin).toBeGreaterThan(0.40);
    expect(cal.meanSame).toBeGreaterThan(cal.meanDiff);
  });

  it("handles edge case targetFar <= 0 without producing NaN", () => {
    const sameScores = [0.80];
    const diffScores = [0.30];

    const calZero = calibrateThresholds(sameScores, diffScores, 0);
    expect(Number.isNaN(calZero.tPass)).toBe(false);
    expect(Number.isNaN(calZero.tWarn)).toBe(false);
    expect(calZero.tPass).toBeGreaterThanOrEqual(0.65);
    expect(calZero.tWarn).toBeGreaterThanOrEqual(0.50);
  });

  it("classifies high-confidence shots as PASS", () => {
    const evaluator = new FaceQaEvaluator({ tPass: 0.80, tWarn: 0.68 });
    const ref = [1, 0, 0];
    const frames = [
      [0.85, 0.1, 0], // high similarity
    ];

    const report = evaluator.evaluateShot("shot_01", "char_hero", frames, ref);
    expect(report.status).toBe("PASS");
    expect(report.shouldReRoll).toBe(false);
  });

  it("classifies borderline shots as WARN for human review buffer", () => {
    const evaluator = new FaceQaEvaluator({ tPass: 0.80, tWarn: 0.68 });
    const ref = [1, 0, 0];
    // Normalized vector with cosine similarity = 0.72 (0.72^2 + 0.694^2 ≈ 1.0)
    const frames = [
      [0.72, 0.694, 0], // similarity ~0.72
    ];

    const report = evaluator.evaluateShot("shot_02", "char_hero", frames, ref);
    expect(report.status).toBe("WARN");
    expect(report.shouldReRoll).toBe(false);
    expect(report.notes).toContain("Flagged for director review");
  });

  it("triggers re-roll up to maxReRolls on FAIL, then halts", () => {
    const evaluator = new FaceQaEvaluator({ tPass: 0.80, tWarn: 0.68, maxReRolls: 2 });
    const ref = [1, 0, 0];
    const badFrames = [
      [0.2, 0.8, 0], // similarity ~0.2 (drifted face)
    ];

    // Attempt 1: FAIL -> should re-roll
    const r1 = evaluator.evaluateShot("shot_drift", "char_hero", badFrames, ref);
    expect(r1.status).toBe("FAIL");
    expect(r1.reRollAttempt).toBe(1);
    expect(r1.shouldReRoll).toBe(true);

    // Attempt 2: FAIL -> should re-roll
    const r2 = evaluator.evaluateShot("shot_drift", "char_hero", badFrames, ref);
    expect(r2.status).toBe("FAIL");
    expect(r2.reRollAttempt).toBe(2);
    expect(r2.shouldReRoll).toBe(true);

    // Attempt 3: FAIL -> exceeds maxReRolls -> hard stop
    const r3 = evaluator.evaluateShot("shot_drift", "char_hero", badFrames, ref);
    expect(r3.status).toBe("FAIL");
    expect(r3.reRollAttempt).toBe(3);
    expect(r3.shouldReRoll).toBe(false);
    expect(r3.notes).toContain("HALTING for human intervention");
  });

  it("returns UNAVAILABLE with review escalation when reference embedding is missing/empty", () => {
    const evaluator = new FaceQaEvaluator({ tPass: 0.80, tWarn: 0.68 });
    const frames = [[0.85, 0.1, 0]];

    // Missing reference vector
    const reportEmptyRef = evaluator.evaluateShot("shot_03", "char_hero", frames, []);
    expect(reportEmptyRef.status).toBe("UNAVAILABLE");
    expect(reportEmptyRef.shouldReRoll).toBe(false);
    expect(reportEmptyRef.notes).toContain("Escalating to review");
  });

  it("binds QA evidence (takeId, mediaHash, referenceVersion, isMockVector)", () => {
    const evaluator = new FaceQaEvaluator({ tPass: 0.80, tWarn: 0.68 });
    const ref = [1, 0, 0];
    const frames = [[0.9, 0.05, 0]];

    const report = evaluator.evaluateShot("shot_evidence", "char_hero", frames, ref, {
      takeId: "sc01_sh01_take02",
      mediaHash: "sha256:abc123def456",
      referenceVersion: "v1.2",
      isMockVector: true,
    });

    expect(report.status).toBe("PASS");
    expect(report.takeId).toBe("sc01_sh01_take02");
    expect(report.mediaHash).toBe("sha256:abc123def456");
    expect(report.referenceVersion).toBe("v1.2");
    expect(report.isMockVector).toBe(true);
  });
});
