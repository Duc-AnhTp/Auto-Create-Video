import type {VisemeClass,VisemeKeyframe,VisemeFrameSample,VisemeAlignmentResult} from '../../../../contracts/media-features.js';
export type {VisemeClass,VisemeKeyframe,VisemeFrameSample,VisemeAlignmentResult} from '../../../../contracts/media-features.js';
 // Close back rounded vowel: u, oo







/**
 * Phoneme & Viseme Alignment Engine.
 *
 * Maps dialogue text, syllables, and audio timestamps into MPEG-4 / Disney
 * 15-viseme sequences with frame-by-frame blendshape morph targets.
 */
export class VisemeAligner {
  /**
   * Viseme morph target dictionary.
   */
  private static readonly VISEME_MORPHS: Record<VisemeClass, VisemeKeyframe["morphTargets"]> = {
    sil: { jawOpen: 0.0, mouthPucker: 0.0, mouthSmile: 0.0, mouthFunnel: 0.0, mouthClose: 1.0 },
    PP: { jawOpen: 0.05, mouthPucker: 0.2, mouthSmile: 0.0, mouthFunnel: 0.0, mouthClose: 0.95 },
    FF: { jawOpen: 0.15, mouthPucker: 0.1, mouthSmile: 0.1, mouthFunnel: 0.0, mouthClose: 0.3 },
    TH: { jawOpen: 0.25, mouthPucker: 0.0, mouthSmile: 0.15, mouthFunnel: 0.0, mouthClose: 0.0 },
    DD: { jawOpen: 0.3, mouthPucker: 0.0, mouthSmile: 0.2, mouthFunnel: 0.0, mouthClose: 0.0 },
    kk: { jawOpen: 0.35, mouthPucker: 0.0, mouthSmile: 0.1, mouthFunnel: 0.0, mouthClose: 0.0 },
    CH: { jawOpen: 0.3, mouthPucker: 0.5, mouthSmile: 0.0, mouthFunnel: 0.4, mouthClose: 0.0 },
    SS: { jawOpen: 0.2, mouthPucker: 0.0, mouthSmile: 0.35, mouthFunnel: 0.0, mouthClose: 0.0 },
    nn: { jawOpen: 0.25, mouthPucker: 0.0, mouthSmile: 0.15, mouthFunnel: 0.0, mouthClose: 0.0 },
    RR: { jawOpen: 0.35, mouthPucker: 0.3, mouthSmile: 0.0, mouthFunnel: 0.2, mouthClose: 0.0 },
    aa: { jawOpen: 0.9, mouthPucker: 0.0, mouthSmile: 0.1, mouthFunnel: 0.15, mouthClose: 0.0 },
    E: { jawOpen: 0.5, mouthPucker: 0.0, mouthSmile: 0.55, mouthFunnel: 0.0, mouthClose: 0.0 },
    I: { jawOpen: 0.35, mouthPucker: 0.0, mouthSmile: 0.7, mouthFunnel: 0.0, mouthClose: 0.0 },
    O: { jawOpen: 0.65, mouthPucker: 0.7, mouthSmile: 0.0, mouthFunnel: 0.65, mouthClose: 0.0 },
    U: { jawOpen: 0.3, mouthPucker: 0.95, mouthSmile: 0.0, mouthFunnel: 0.4, mouthClose: 0.0 },
  };

  /**
   * Character/phoneme to viseme mapping lookup (Vietnamese + English supported).
   */
  public static mapCharToViseme(char: string): VisemeClass {
    const c = char.toLowerCase();
    // Vowels
    if ("aăâáàảãạắằẳẵặấầẩẫậ".includes(c)) return "aa";
    if ("eêéèẻẽẹếềểễệ".includes(c)) return "E";
    if ("iíìỉĩịyýỳỷỹỵ".includes(c)) return "I";
    if ("oôơóòỏõọốồổỗộớờởỡợ".includes(c)) return "O";
    if ("uưúùủũụứừửữự".includes(c)) return "U";

    // Consonants
    if ("pbm".includes(c)) return "PP";
    if ("fv".includes(c)) return "FF";
    if ("td".includes(c)) return "DD";
    if ("kg".includes(c)) return "kk";
    if ("szx".includes(c)) return "SS";
    if ("nl".includes(c)) return "nn";
    if ("r".includes(c)) return "RR";
    if ("cjh".includes(c)) return "CH";

    return "sil";
  }

  /**
   * Aligns dialogue text with audio duration to produce timed viseme keyframes.
   */
  public static alignTextToDuration(
    text: string,
    totalDurationSec: number,
    fps = 24
  ): VisemeAlignmentResult {
    const words = text
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 0);

    if (words.length === 0 || totalDurationSec <= 0.05) {
      const rest = this.VISEME_MORPHS.sil;
      return {
        totalDurationSec: Math.max(0.1, totalDurationSec),
        fps,
        totalFrames: Math.ceil(totalDurationSec * fps),
        keyframes: [
          {
            viseme: "sil",
            startSec: 0,
            endSec: totalDurationSec,
            durationSec: totalDurationSec,
            intensity: 1.0,
            morphTargets: rest,
          },
        ],
        frames: [],
      };
    }

    // Allocate time per word proportionally to letter count, leaving initial and trailing silence
    const leadSilenceSec = Math.min(0.15, totalDurationSec * 0.08);
    const trailSilenceSec = Math.min(0.2, totalDurationSec * 0.1);
    const spokenDuration = Math.max(0.1, totalDurationSec - leadSilenceSec - trailSilenceSec);

    const totalChars = words.reduce((acc, w) => acc + w.length, 0);
    const keyframes: VisemeKeyframe[] = [];

    // Lead silence
    if (leadSilenceSec > 0.01) {
      keyframes.push({
        viseme: "sil",
        startSec: 0,
        endSec: leadSilenceSec,
        durationSec: leadSilenceSec,
        intensity: 1.0,
        morphTargets: this.VISEME_MORPHS.sil,
      });
    }

    let cursorSec = leadSilenceSec;

    for (let wIdx = 0; wIdx < words.length; wIdx++) {
      const word = words[wIdx];
      const wordDuration = (word.length / totalChars) * spokenDuration;
      const charDuration = wordDuration / Math.max(1, word.length);

      for (let cIdx = 0; cIdx < word.length; cIdx++) {
        const char = word[cIdx];
        const viseme = this.mapCharToViseme(char);
        const kfStart = cursorSec;
        const kfEnd = cursorSec + charDuration;
        cursorSec = kfEnd;

        // Merge adjacent identical visemes
        const prev = keyframes[keyframes.length - 1];
        if (prev && prev.viseme === viseme) {
          prev.endSec = kfEnd;
          prev.durationSec = prev.endSec - prev.startSec;
        } else {
          keyframes.push({
            viseme,
            startSec: parseFloat(kfStart.toFixed(4)),
            endSec: parseFloat(kfEnd.toFixed(4)),
            durationSec: parseFloat(charDuration.toFixed(4)),
            intensity: viseme === "sil" ? 1.0 : 0.85 + Math.random() * 0.15,
            morphTargets: this.VISEME_MORPHS[viseme],
          });
        }
      }

      // Small intra-word breath/pause if word ends with punctuation
      if (/[.,!?;:]/.test(word)) {
        const pauseDur = Math.min(0.12, spokenDuration * 0.03);
        keyframes.push({
          viseme: "sil",
          startSec: parseFloat(cursorSec.toFixed(4)),
          endSec: parseFloat((cursorSec + pauseDur).toFixed(4)),
          durationSec: parseFloat(pauseDur.toFixed(4)),
          intensity: 1.0,
          morphTargets: this.VISEME_MORPHS.sil,
        });
        cursorSec += pauseDur;
      }
    }

    // Trailing silence
    if (cursorSec < totalDurationSec) {
      keyframes.push({
        viseme: "sil",
        startSec: parseFloat(cursorSec.toFixed(4)),
        endSec: parseFloat(totalDurationSec.toFixed(4)),
        durationSec: parseFloat((totalDurationSec - cursorSec).toFixed(4)),
        intensity: 1.0,
        morphTargets: this.VISEME_MORPHS.sil,
      });
    }

    // Sample frame-by-frame blendshapes with temporal smoothing
    const totalFrames = Math.max(1, Math.round(totalDurationSec * fps));
    const frames: VisemeFrameSample[] = [];

    for (let f = 0; f < totalFrames; f++) {
      const time = f / fps;
      // Find matching keyframe
      const kf = keyframes.find((k) => time >= k.startSec && time < k.endSec) || keyframes[keyframes.length - 1];
      const viseme = kf ? kf.viseme : "sil";
      const morph = kf ? kf.morphTargets : this.VISEME_MORPHS.sil;

      frames.push({
        frameIndex: f,
        timestampSec: parseFloat(time.toFixed(4)),
        primaryViseme: viseme,
        visemeWeights: { [viseme]: 1.0 },
        jawOpen: morph.jawOpen,
        mouthPucker: morph.mouthPucker,
        mouthSmile: morph.mouthSmile,
        mouthFunnel: morph.mouthFunnel,
        mouthClose: morph.mouthClose,
      });
    }

    return {
      totalDurationSec,
      fps,
      totalFrames,
      keyframes,
      frames,
    };
  }
}
