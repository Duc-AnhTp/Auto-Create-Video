import { StoryToScreenplayGenerator } from "../story-to-screenplay.js";
import type { GenerateScreenplayStore } from "../../ports/studio/generate-screenplay-store.js";
export async function generateScreenplay(bible: GenerateScreenplayStore, args: {
    seriesId: string;
    body: {
        [x: string]: unknown;
        prompt?: string | undefined;
        storyText?: string | undefined;
        episodeNumber?: number | undefined;
        targetScenes?: number | undefined;
        tone?: string | undefined;
    };
}) {
    const { body, seriesId } = args;
    const generator = new StoryToScreenplayGenerator(bible);
    return await generator.generateScreenplay({
        seriesId,
        prompt: body.prompt,
        storyText: body.storyText,
        episodeNumber: body.episodeNumber,
        targetScenes: body.targetScenes || 3,
        tone: body.tone,
        skipAudit: true,
    });
}
