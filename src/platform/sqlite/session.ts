import type { DatabaseSync } from "node:sqlite";
import type { BibleMemoryStore } from "../../contracts/story.js";
export interface DatabaseSession { db: DatabaseSync | null; memoryStore: BibleMemoryStore; isFallback: boolean }
