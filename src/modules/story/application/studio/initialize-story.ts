import type { InitializeStoryStore } from "../../ports/studio/initialize-story-store.js";
export function initializeStory(bible: InitializeStoryStore, args: {
    meta: {
        id: string;
        title: string;
        genre: string;
        visual_style: string;
        aspect_ratio: "9:16" | "16:9";
        fps: number;
        created_at: string;
    };
}) {
    const { meta } = args;
    bible.upsertSeriesMetadata(meta);
}
