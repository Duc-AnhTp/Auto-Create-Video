import { z } from "zod";

export const LlmExtractedCharacterSchema = z.object({
  name: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  role: z.enum(["protagonist", "antagonist", "supporting", "minor"]).default("supporting"),
  visualSummary: z.string().default(""),
  personalityTraits: z.array(z.string()).default([]),
  relationships: z
    .array(
      z.object({
        targetName: z.string(),
        relationType: z.string(),
      })
    )
    .default([]),
  confidenceScore: z.number().min(0).max(1).default(0.85),
  needsHumanReview: z.boolean().default(false),
});

export type LlmExtractedCharacter = z.infer<typeof LlmExtractedCharacterSchema>;

export const LlmExtractedBeatSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  participatingCharacters: z.array(z.string()).default([]),
  storyTime: z.string().default("Hiện tại"),
  isFlashback: z.boolean().default(false),
  importanceLevel: z.enum(["mandatory", "key", "flavor"]).default("key"),
  chapterIndex: z.number().optional(),
  causalityPreconditions: z.array(z.string()).default([]),
  causalityPostChanges: z.array(z.string()).default([]),
  sourceSpanStart: z.number().optional(),
  sourceSpanEnd: z.number().optional(),
  confidenceScore: z.number().min(0).max(1).default(0.85),
  needsHumanReview: z.boolean().default(false),
});

export type LlmExtractedBeat = z.infer<typeof LlmExtractedBeatSchema>;

export const LlmExtractedThreadSchema = z.object({
  name: z.string().min(1),
  threadType: z.enum(["main", "subplot", "character_arc"]).default("subplot"),
  description: z.string().min(1),
  setupBeatIndex: z.number().optional(),
  payoffBeatIndex: z.number().optional(),
  dependencies: z.array(z.string()).default([]),
  confidenceScore: z.number().min(0).max(1).default(0.85),
  needsHumanReview: z.boolean().default(false),
});

export type LlmExtractedThread = z.infer<typeof LlmExtractedThreadSchema>;

export const LlmExtractedKnowledgeStateSchema = z.object({
  characterName: z.string().min(1),
  factKey: z.string().min(1),
  factDescription: z.string().min(1),
  revealedAtBeatIndex: z.number().optional(),
  isSecret: z.boolean().default(false),
});

export type LlmExtractedKnowledgeState = z.infer<typeof LlmExtractedKnowledgeStateSchema>;

export const LlmStoryAnalysisOutputSchema = z.object({
  characters: z.array(LlmExtractedCharacterSchema).default([]),
  beats: z.array(LlmExtractedBeatSchema).default([]),
  threads: z.array(LlmExtractedThreadSchema).default([]),
  knowledgeStates: z.array(LlmExtractedKnowledgeStateSchema).default([]),
});

export type LlmStoryAnalysisOutput = z.infer<typeof LlmStoryAnalysisOutputSchema>;
