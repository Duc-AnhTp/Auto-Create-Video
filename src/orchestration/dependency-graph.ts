import {
  type ShotSpecComposite,
  computeCompositeShotHash,
  computeVideoSpecHash,
  computeAudioSpecHash,
} from "./spec-hasher.js";

/**
 * Dependency Invalidation Graph (Requirement 6)
 *
 * Models the asset generation DAG for episodic scenes and shots.
 * When shot parameters are modified:
 * - Decouples video track from dialogue track unless explicit lip-sync is requested.
 * - Editing dialogue ONLY invalidates audio assets & timeline muxing, preserving 100% of video clips.
 * - Modifying camera/visual prompt ONLY invalidates video clips, preserving synthesized audio voices.
 */

export interface ShotNode {
  shotId: string;
  spec: ShotSpecComposite;
  videoSpecHash: string;
  audioSpecHash: string | null;
  videoAssetPath?: string;
  audioAssetPath?: string;
  muxedAssetPath?: string;
}

export interface InvalidationPlan {
  videoShotsToRender: string[];
  audioShotsToRender: string[];
  dialogueShotsToRender: string[];
  reusableVideoShots: Map<string, string>; // shotId -> videoAssetPath
  reusableAudioShots: Map<string, string>; // shotId -> audioAssetPath
  reusableMuxedShots: Map<string, string>; // shotId -> muxedAssetPath
  mustRebuildMasterTimeline: boolean;
  metrics: {
    totalShots: number;
    videoReusedCount: number;
    videoReRenderCount: number;
    audioReusedCount: number;
    audioReRenderCount: number;
    savedVideoComputePercent: number;
  };
}

export class DependencyInvalidationGraph {
  private nodes: Map<string, ShotNode> = new Map();

  public registerShot(shotId: string, spec: any, assetPaths?: {
    videoAssetPath?: string;
    audioAssetPath?: string;
    muxedAssetPath?: string;
  }): ShotNode {
    let videoSpecHash: string;
    let audioSpecHash: string | null;

    if (spec?.videoSpecHash !== undefined) {
      videoSpecHash = spec.videoSpecHash;
      audioSpecHash = spec.audioSpecHash !== undefined ? spec.audioSpecHash : null;
    } else {
      const hashes = computeCompositeShotHash(spec);
      videoSpecHash = hashes.videoSpecHash;
      audioSpecHash = hashes.audioSpecHash;
    }

    const node: ShotNode = {
      shotId,
      spec,
      videoSpecHash,
      audioSpecHash,
      videoAssetPath: assetPaths?.videoAssetPath || spec?.videoAssetPath,
      audioAssetPath: assetPaths?.audioAssetPath || spec?.audioAssetPath,
      muxedAssetPath: assetPaths?.muxedAssetPath || spec?.muxedAssetPath,
    };
    this.nodes.set(shotId, node);
    return node;
  }

  public getNode(shotId: string): ShotNode | undefined {
    return this.nodes.get(shotId);
  }

  public getAllNodes(): ShotNode[] {
    return Array.from(this.nodes.values());
  }

  /**
   * Evaluates the delta between this (previous) graph and an updated set of shot specs.
   * Calculates minimal necessary invalidation.
   */
  public computeInvalidationPlan(updatedShots: any[]): InvalidationPlan {
    const videoShotsToRender: string[] = [];
    const audioShotsToRender: string[] = [];
    const reusableVideoShots = new Map<string, string>();
    const reusableAudioShots = new Map<string, string>();
    const reusableMuxedShots = new Map<string, string>();

    let mustRebuildMasterTimeline = false;

    for (const newSpec of updatedShots) {
      const shotId = newSpec.shotId;
      const prevNode = this.nodes.get(shotId);

      const videoInput = newSpec.video || newSpec.videoSpec;
      const audioInput = newSpec.audio || newSpec.audioSpec;

      const newVideoHash = newSpec.videoSpecHash || (videoInput ? computeVideoSpecHash(videoInput) : "");
      const newAudioHash =
        newSpec.audioSpecHash !== undefined
          ? newSpec.audioSpecHash
          : audioInput
          ? computeAudioSpecHash(audioInput)
          : null;

      if (!prevNode) {
        // Entirely new shot: both video and audio must be rendered
        videoShotsToRender.push(shotId);
        if (audioInput) {
          audioShotsToRender.push(shotId);
        }
        mustRebuildMasterTimeline = true;
        continue;
      }

      // Check Video Invalidation
      const videoSpecChanged = prevNode.videoSpecHash !== newVideoHash;
      // If lip-sync is explicitly required, video also depends on audio!
      const lipSyncAudioChanged = Boolean(newSpec.requiresLipSync) && prevNode.audioSpecHash !== newAudioHash;
      const isVideoInvalidated = videoSpecChanged || lipSyncAudioChanged || !prevNode.videoAssetPath;

      if (isVideoInvalidated) {
        videoShotsToRender.push(shotId);
        mustRebuildMasterTimeline = true;
      } else if (prevNode.videoAssetPath) {
        reusableVideoShots.set(shotId, prevNode.videoAssetPath);
      }

      // Check Audio Invalidation
      let isAudioInvalidated = false;
      if (audioInput) {
        const audioSpecChanged = prevNode.audioSpecHash !== newAudioHash;
        isAudioInvalidated = audioSpecChanged || !prevNode.audioAssetPath;

        if (isAudioInvalidated) {
          audioShotsToRender.push(shotId);
          mustRebuildMasterTimeline = true;
        } else if (prevNode.audioAssetPath) {
          reusableAudioShots.set(shotId, prevNode.audioAssetPath);
        }
      }

      // Check Muxed Clip Invalidation
      if (!isVideoInvalidated && !isAudioInvalidated && prevNode.muxedAssetPath) {
        reusableMuxedShots.set(shotId, prevNode.muxedAssetPath);
      } else {
        mustRebuildMasterTimeline = true;
      }
    }

    const total = updatedShots.length;
    const videoReused = reusableVideoShots.size;
    const audioReused = reusableAudioShots.size;

    return {
      videoShotsToRender,
      audioShotsToRender,
      dialogueShotsToRender: audioShotsToRender,
      reusableVideoShots,
      reusableAudioShots,
      reusableMuxedShots,
      mustRebuildMasterTimeline,
      metrics: {
        totalShots: total,
        videoReusedCount: videoReused,
        videoReRenderCount: videoShotsToRender.length,
        audioReusedCount: audioReused,
        audioReRenderCount: audioShotsToRender.length,
        savedVideoComputePercent: total > 0 ? Math.round((videoReused / total) * 100) : 0,
      },
    };
  }
}

/**
 * Builds an invalidation graph and computes the minimal invalidation plan.
 */
export function buildInvalidationGraph(
  prevGraphOrNodes: any,
  currentShots: any[]
): InvalidationPlan & { dialogueShotsToRender: string[] } {
  const graph = new DependencyInvalidationGraph();
  if (prevGraphOrNodes) {
    if (prevGraphOrNodes instanceof DependencyInvalidationGraph) {
      for (const node of prevGraphOrNodes.getAllNodes()) {
        graph.registerShot(node.shotId, node.spec || node, {
          videoAssetPath: node.videoAssetPath,
          audioAssetPath: node.audioAssetPath,
          muxedAssetPath: node.muxedAssetPath,
        });
      }
    } else if (Array.isArray(prevGraphOrNodes)) {
      for (const node of prevGraphOrNodes) {
        graph.registerShot(node.shotId, node.spec || node, {
          videoAssetPath: node.videoAssetPath,
          audioAssetPath: node.audioAssetPath,
          muxedAssetPath: node.muxedAssetPath,
        });
      }
    } else if (prevGraphOrNodes.nodes) {
      const nodes =
        prevGraphOrNodes.nodes instanceof Map
          ? Array.from(prevGraphOrNodes.nodes.values())
          : Array.isArray(prevGraphOrNodes.nodes)
          ? prevGraphOrNodes.nodes
          : Object.values(prevGraphOrNodes.nodes);
      for (const node of nodes as any[]) {
        graph.registerShot(node.shotId, node.spec || node, {
          videoAssetPath: node.videoAssetPath,
          audioAssetPath: node.audioAssetPath,
          muxedAssetPath: node.muxedAssetPath,
        });
      }
    }
  }
  const plan = graph.computeInvalidationPlan(currentShots);
  return {
    ...plan,
    dialogueShotsToRender: plan.audioShotsToRender,
  };
}
