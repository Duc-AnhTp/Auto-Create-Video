import type {DialogueEmotion,EmotionalVoiceSettings,DialogueEmotionContext} from '../../../../contracts/media-features.js';
export type {DialogueEmotion,EmotionalVoiceSettings,DialogueEmotionContext} from '../../../../contracts/media-features.js';








/**
 * Neural Emotional Voice & SSML Controller.
 *
 * Inflects character vocal performances based on dramatic tension,
 * psychological states, and scene action intensity.
 *
 * Generates:
 * 1. SSML 1.1 compliant tags (<prosody>, <emphasis>, <break>).
 * 2. Acting prompts for instruction-tuned zero-shot neural TTS (CosyVoice, F5-TTS).
 * 3. Provider-calibrated hyper-parameters (ElevenLabs stability, style exaggeration).
 */
export class EmotionalVoiceController {
  /**
   * Infers emotional profile from dialogue text, acting instructions, and scene tension.
   */
  public static inferEmotion(
    rawText: string,
    context: DialogueEmotionContext
  ): DialogueEmotion {
    const textLower = rawText.toLowerCase();
    const actInst = (context.explicitActingInstruction || "").toLowerCase();
    const tension = context.sceneTensionScore ?? 0.5;

    // Explicit instruction overrides
    if (actInst.includes("thì thầm") || actInst.includes("whisper") || actInst.includes("nhỏ giọng")) {
      return "whisper";
    }
    if (actInst.includes("hét") || actInst.includes("shout") || actInst.includes("gầm") || actInst.includes("giận dữ")) {
      return "furious_shout";
    }
    if (actInst.includes("sợ hãi") || actInst.includes("terrified") || actInst.includes("run rẩy")) {
      return "terrified";
    }
    if (actInst.includes("hoảng loạn") || actInst.includes("panic") || actInst.includes("cuống cuồng")) {
      return "panicked";
    }
    if (actInst.includes("đau đớn") || actInst.includes("khóc") || actInst.includes("grief") || actInst.includes("nghẹn ngào")) {
      return "heartbroken_grief";
    }
    if (actInst.includes("châm biếm") || actInst.includes("mỉa mai") || actInst.includes("sarcastic")) {
      return "sarcastic";
    }

    // Text punctuation & semantic cues
    const hasExclamation = rawText.includes("!") || rawText.includes("!?");
    const hasEllipsis = rawText.includes("...") || rawText.includes("…");

    if (tension >= 0.85) {
      if (hasExclamation || textLower.includes("chết đi") || textLower.includes("tấn công") || textLower.includes("không thể nào")) {
        return "furious_shout";
      }
      if (context.wounds && context.wounds.length > 0) {
        return "panicked";
      }
      return "intense_confrontation";
    }

    if (tension >= 0.65) {
      if (hasEllipsis) return "intense_confrontation";
      return "intense_confrontation";
    }

    if (hasEllipsis && (textLower.includes("xin lỗi") || textLower.includes("đã mất"))) {
      return "heartbroken_grief";
    }

    if (textLower.includes("suỵt") || textLower.includes("cẩn thận") || textLower.includes("đừng để bị phát hiện")) {
      return "whisper";
    }

    return "calm_deliberate";
  }

  /**
   * Generates detailed emotional voice settings and SSML payload.
   */
  public static generateSettings(
    dialogueText: string,
    context: DialogueEmotionContext
  ): EmotionalVoiceSettings {
    const emotion = this.inferEmotion(dialogueText, context);

    let rate = 1.0;
    let pitch = 0;
    let volumeDb = 0;
    let breathiness = 0.0;
    let tremorIntensity = 0.0;
    let pausePaddingMs = 250;
    let actingPrompt = "";
    let stability = 0.75;
    let style = 0.0;
    let similarityBoost = 0.75;

    switch (emotion) {
      case "whisper":
        rate = 0.92;
        pitch = -1;
        volumeDb = -6.0;
        breathiness = 0.85;
        pausePaddingMs = 350;
        actingPrompt = `Thì thầm rất nhỏ, đầy hơi thở, giọng cảnh giác bí mật, tránh phát ra tiếng động lớn.`;
        stability = 0.85;
        style = 0.35;
        break;

      case "terrified":
        rate = 1.15;
        pitch = 3;
        volumeDb = 1.5;
        tremorIntensity = 0.8;
        pausePaddingMs = 200;
        actingPrompt = `Giọng run rẩy vì sợ hãi tột cùng, ngắt quãng đứt đoạn, thở dốc hoang mang.`;
        stability = 0.35; // Lower stability for vocal tremors
        style = 0.75;
        break;

      case "furious_shout":
        rate = 1.18;
        pitch = 4;
        volumeDb = 6.0;
        tremorIntensity = 0.2;
        pausePaddingMs = 150;
        actingPrompt = `Hét lớn đầy uy lực và phẫn nộ dữ dội, âm vang mạnh mẽ, dứt khoát không khoan nhượng.`;
        stability = 0.40;
        style = 0.90; // High emotional exaggeration
        break;

      case "intense_confrontation":
        rate = 0.90;
        pitch = -2;
        volumeDb = 2.0;
        pausePaddingMs = 400;
        actingPrompt = `Giọng trầm, đanh thép, lạnh lùng và đầy sức nặng đe dọa, nhấn mạnh từng từ ngữ.`;
        stability = 0.65;
        style = 0.50;
        break;

      case "heartbroken_grief":
        rate = 0.85;
        pitch = -1;
        volumeDb = -3.0;
        breathiness = 0.6;
        tremorIntensity = 0.5;
        pausePaddingMs = 500;
        actingPrompt = `Giọng nghẹn ngào, đau thương cùng cực, như sắp khóc, hơi thở run và chùng xuống cuối câu.`;
        stability = 0.45;
        style = 0.65;
        break;

      case "panicked":
        rate = 1.25;
        pitch = 2;
        volumeDb = 3.0;
        tremorIntensity = 0.6;
        pausePaddingMs = 100;
        actingPrompt = `Nói rất nhanh và dồn dập, mất kiểm soát, gấp gáp cấp bách.`;
        stability = 0.30;
        style = 0.80;
        break;

      case "sarcastic":
        rate = 0.95;
        pitch = 1;
        volumeDb = 0.0;
        pausePaddingMs = 300;
        actingPrompt = `Giọng mỉa mai, châm biếm sâu cay, kéo dài ngữ điệu ở cuối câu khinh khỉnh.`;
        stability = 0.70;
        style = 0.55;
        break;

      case "calm_deliberate":
      default:
        rate = 1.0;
        pitch = 0;
        volumeDb = 0.0;
        pausePaddingMs = 250;
        actingPrompt = `Giọng điềm tĩnh, rõ ràng, tự nhiên, nhịp điệu đĩnh đạc.`;
        stability = 0.75;
        style = 0.10;
        break;
    }

    // Build standard SSML 1.1 markup
    const ssml = this.buildSsml(dialogueText, {
      rate,
      pitch,
      volumeDb,
      emotion,
      pausePaddingMs,
    });

    return {
      emotion,
      rate,
      pitch,
      volumeDb,
      breathiness,
      tremorIntensity,
      pausePaddingMs,
      actingPrompt,
      elevenLabsSettings: {
        stability,
        similarityBoost,
        style,
        useSpeakerBoost: true,
      },
      ssmlText: ssml,
    };
  }

  /**
   * Formats SSML XML string with prosody, volume, and emotional markers.
   */
  private static buildSsml(
    text: string,
    options: { rate: number; pitch: number; volumeDb: number; emotion: DialogueEmotion; pausePaddingMs: number }
  ): string {
    const ratePercent = Math.round((options.rate - 1.0) * 100);
    const rateStr = ratePercent >= 0 ? `+${ratePercent}%` : `${ratePercent}%`;

    const pitchStr = options.pitch >= 0 ? `+${options.pitch}st` : `${options.pitch}st`;

    let volStr = "medium";
    if (options.volumeDb >= 4.0) volStr = "+6dB";
    else if (options.volumeDb > 0.0) volStr = "loud";
    else if (options.volumeDb <= -4.0) volStr = "-6dB";
    else if (options.volumeDb < 0.0) volStr = "soft";

    // Escape basic XML characters
    const cleanText = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // Enhance sentence punctuation with micro-breaks
    const breakTag = `<break time="${options.pausePaddingMs}ms"/>`;
    const punctuatedText = cleanText
      .replace(/\.\.\./g, `... ${breakTag}`)
      .replace(/([.?!])\s+/g, `$1 ${breakTag} `);

    return `<speak version="1.1" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="vi-VN">
  <prosody rate="${rateStr}" pitch="${pitchStr}" volume="${volStr}">
    <amazon:emotion name="${options.emotion}">
      ${punctuatedText}
    </amazon:emotion>
  </prosody>
</speak>`.trim();
  }
}
