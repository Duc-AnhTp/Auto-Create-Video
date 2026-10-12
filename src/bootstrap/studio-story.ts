import { SqliteStoryStore } from "./sqlite-story-store.js";
import { join } from "node:path";
import * as story from "../modules/story/application/studio-story.js";
import type { StoryStore } from "./ports/workflow-store.js";
export async function withStory<T>(seriesId: string, fn: (bible: StoryStore) => Promise<T>): Promise<T> {
    const bible = new SqliteStoryStore(join("data", "series", seriesId, "story_bible.db"));
    try {
        return await fn(bible);
    }
    finally {
        bible.close();
    }
}
export function importStory(seriesId: string, input: Parameters<typeof story.importStory>[1], checkpoint?: () => Promise<void>) { return withStory(seriesId, bible => story.importStory(seriesId, input, checkpoint, bible)); }
export function generateDraft(seriesId: string, input: Parameters<typeof story.generateDraft>[1]) { return withStory(seriesId, bible => story.generateDraft(seriesId, input, bible)); }
export function editShot(seriesId: string, input: Parameters<typeof story.editShot>[1]) { return withStory(seriesId, bible => story.editShot(seriesId, input, bible)); }
