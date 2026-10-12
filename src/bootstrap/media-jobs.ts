import { createMediaFactories } from './media-services.js';
import { SqliteStoryStore } from "./sqlite-story-store.js";
import { EnqueueMediaJob } from "../modules/production/application/media-jobs.js";
import type { JobStore } from "../modules/production/adapters/sqlite/job-store.js";
import { ProjectPaths } from "../platform/filesystem/project-paths.js";
export class MediaJobService extends EnqueueMediaJob {
    constructor(queue: JobStore, paths?: ProjectPaths) { super(queue, path => new SqliteStoryStore(path), createMediaFactories(), paths); }
}
