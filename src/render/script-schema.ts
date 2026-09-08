import { z } from "zod";

// ── Template data shapes (discriminated by template field) ─────────────────

const KenBurnsEnum = z.enum(["zoom-in", "zoom-out", "pan-left", "pan-right"]).default("zoom-in");

const HookData = z.object({
  template: z.literal("hook"),
  headline: z.string().min(1).max(80),
  subhead: z.string().max(60).optional(),
  /** background image path (literal "$source.image" → substituted at pipeline level) */
  bgSrc: z.string().optional(),
  /** Ken Burns effect class */
  kenBurns: KenBurnsEnum,
});

const ComparisonSide = z.object({
  label: z.string().min(1).max(30),
  value: z.string().min(1).max(20),
  color: z.enum(["cyan", "purple"]),
});

const ComparisonData = z.object({
  template: z.literal("comparison"),
  left: ComparisonSide,
  right: ComparisonSide.extend({ winner: z.boolean().optional() }),
});

const StatHeroData = z.object({
  template: z.literal("stat-hero"),
  value: z.string().min(1).max(30),
  label: z.string().min(1).max(60),
  context: z.string().max(80).optional(),
});

const FeatureListData = z.object({
  template: z.literal("feature-list"),
  title: z.string().min(1).max(60),
  bullets: z.array(z.string().min(1).max(80)).min(1).max(6),
  icon: z.string().optional(),
});

const CalloutData = z.object({
  template: z.literal("callout"),
  statement: z.string().min(1).max(150),
  tag: z.string().max(30).optional(),
});

const OutroData = z.object({
  template: z.literal("outro"),
  ctaTop: z.string().min(1).max(30),
  channelName: z.string().min(1).max(30),
  source: z.string().min(1).max(40),
});

// ── New templates for long-form & image-rich videos ────────────────────────

/** Full-frame background image with caption overlay */
const ImageCardData = z.object({
  template: z.literal("image-card"),
  caption: z.string().min(1).max(120),
  subcaption: z.string().max(80).optional(),
  /** Image reference — "$images.<id>" resolved by pipeline, or direct relative path */
  imageSrc: z.string().min(1),
  kenBurns: KenBurnsEnum,
  /** Darkness overlay opacity (0=none, 1=black). Default 0.45 */
  overlay: z.number().min(0).max(1).default(0.45),
});

/** Split layout: top half image, bottom half glass card with text */
const SplitImageData = z.object({
  template: z.literal("split-image"),
  /** Image reference — "$images.<id>" resolved by pipeline */
  imageSrc: z.string().min(1),
  title: z.string().min(1).max(80),
  body: z.string().min(1).max(200),
  kenBurns: KenBurnsEnum,
});

/** Large text reveal — lines appear one by one (transition/emphasis scenes) */
const TextRevealData = z.object({
  template: z.literal("text-reveal"),
  lines: z.array(z.string().min(1).max(60)).min(1).max(4),
  /** Which line(s) get accent color emphasis */
  emphasis: z.enum(["first", "last", "all"]).default("first"),
});

/** Quote from expert / executive / interview */
const QuoteCardData = z.object({
  template: z.literal("quote-card"),
  quote: z.string().min(1).max(200),
  author: z.string().min(1).max(60),
  title: z.string().max(80).optional(),
  avatarUrl: z.string().optional(),
});

/** Chronological timeline / milestone roadmap */
const TimelineData = z.object({
  template: z.literal("timeline"),
  title: z.string().min(1).max(60),
  events: z
    .array(
      z.object({
        time: z.string().min(1).max(30),
        label: z.string().min(1).max(80),
      })
    )
    .min(2)
    .max(4),
});

/** Horizontal animated bar chart comparison */
const ChartBarsData = z.object({
  template: z.literal("chart-bars"),
  title: z.string().min(1).max(60),
  items: z
    .array(
      z.object({
        label: z.string().min(1).max(30),
        value: z.number().min(0).max(100),
        displayValue: z.string().min(1).max(20),
        color: z.enum(["cyan", "purple", "emerald"]).default("cyan"),
      })
    )
    .min(2)
    .max(4),
});

export const TemplateData = z.discriminatedUnion("template", [
  HookData,
  ComparisonData,
  StatHeroData,
  FeatureListData,
  CalloutData,
  OutroData,
  ImageCardData,
  SplitImageData,
  TextRevealData,
  QuoteCardData,
  TimelineData,
  ChartBarsData,
]);

export type TemplateDataType = z.infer<typeof TemplateData>;

// ── SFX schema ─────────────────────────────────────────────────────────────
/**
 * Per-scene sound effect override. If omitted, the pipeline picks a default
 * SFX based on the template type (see SKILL.md / pipeline DEFAULT_SFX).
 *
 * `name` examples: "transition/whoosh-soft", "emphasis/ding", "alert/notification"
 *   → resolves to assets/sfx/<name>.mp3
 * Set `name: "none"` to explicitly disable SFX for this scene.
 */
const SfxSpec = z.object({
  name: z.string().min(1),
  /** Volume 0–1, default 0.4 (so SFX doesn't drown the voice) */
  volume: z.number().min(0).max(1).default(0.4),
  /** Seconds offset from scene start (default 0). Negative = before scene. */
  startOffsetSec: z.number().default(0),
});

export type SfxSpecType = z.infer<typeof SfxSpec>;

// ── Image entry (centralized image declarations) ───────────────────────────
/**
 * Each image is declared once at the root level and referenced by id
 * in scene templates via "$images.<id>". This ensures:
 * - Images are deterministic (same URLs → same images every time)
 * - No AI-generated/fabricated images — all from explicit URLs
 * - Download happens once, reuse across multiple scenes
 */
const ImageEntry = z.object({
  id: z.string().min(1),
  url: z.string().url(),
  alt: z.string().max(100).optional(),
});

export type ImageEntryType = z.infer<typeof ImageEntry>;

// ── Context section (narrative consistency for long videos) ─────────────────
/**
 * Optional metadata for maintaining narrative consistency across
 * long videos with many scenes. Helps script generators (AI/LLM)
 * maintain context without drifting.
 */
const ContextSection = z.object({
  /** Brief summary of the entire video's narrative */
  summary: z.string().max(500),
  /** Key entities (product names, brands, numbers) that must stay consistent */
  keyEntities: z.array(z.string()).max(20),
  /** Overall tone of the video */
  tone: z.enum(["news", "review", "tutorial", "storytelling"]).default("news"),
});

// ── Scene schema ───────────────────────────────────────────────────────────

const Scene = z.object({
  id: z.string().min(1),
  type: z.enum(["hook", "body", "transition", "outro"]),
  /** Optional chapter grouping for long videos (e.g. "Thiết kế", "Camera", "Pin") */
  chapter: z.string().max(40).optional(),
  voiceText: z.string().min(1),
  templateData: TemplateData,
  /** Optional sound effect override (else pipeline picks per template) */
  sfx: SfxSpec.optional(),
});

// ── Root schema ────────────────────────────────────────────────────────────

export const ScriptSchema = z.object({
  version: z.literal("1.0"),
  metadata: z.object({
    title: z.string().min(1),
    source: z.object({
      url: z.string(),
      domain: z.string(),
      image: z.string().url().nullable(),
    }),
    channel: z.string().min(1),
  }),
  voice: z.object({
    provider: z.enum(["lucylab", "elevenlabs"]),
    voiceId: z.string().min(1),
    speed: z.number().min(0.5).max(2.0).default(1.0),
  }).optional(),
  /** Optional background music path or name in assets/bgm/ */
  bgm: z.string().optional(),
  /** Centralized image declarations — referenced by "$images.<id>" in scene templates */
  images: z.array(ImageEntry).max(20).default([]),
  /** Narrative context for long-form video consistency */
  context: ContextSection.optional(),
  scenes: z
    .array(Scene)
    .min(3)
    .max(30, "scenes must have at most 30 items")
    .refine(
      (s) => s[0]?.type === "hook",
      { message: "scenes[0] must be type=hook" }
    )
    .refine(
      (s) => s[s.length - 1]?.type === "outro",
      { message: "last scene must be type=outro" }
    ),
});

export type Script = z.infer<typeof ScriptSchema>;
