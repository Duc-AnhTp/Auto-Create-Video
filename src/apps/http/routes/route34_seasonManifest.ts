import { log } from '../../../platform/observability/logger.js';
import { existsSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { SeasonArcController } from "../../../modules/production/index.js";
import { SeasonBudgetAllocator } from "../../../modules/production/index.js";
import { SeriesId } from "../../../contracts/requests.js";
import type { RouteContext, SendJson } from "./context.js";
export async function route34_seasonManifest(req: IncomingMessage, res: ServerResponse, url: URL, send: SendJson, ctx: Pick<RouteContext, never>): Promise<boolean> {
    const seasonManifestMatch = url.pathname.match(/^\/api\/v1\/series\/([^/]+)\/season\/manifest$/);
    if (!(seasonManifestMatch && req.method === "GET"))
        return false;
    const id = SeriesId.parse(seasonManifestMatch[1]);
    const candidateManifestPaths = [
        resolve("data", "series", id, "season_production", "season_manifest.json"),
        resolve("data", "series", id, "season_output", "season_master_report.json"),
        resolve("data", "series", id, "season_output", "season_manifest.json"),
        resolve("data", "series", id, "season_manifest.json"),
    ];
    for (const manifestPath of candidateManifestPaths) {
        if (existsSync(manifestPath)) {
            try {
                const content = JSON.parse(readFileSync(manifestPath, "utf8"));
                send({ success: true, ...content });
                return true;
            }
            catch (caughtError) {
                log.warn("[route34_seasonManifest] " + String(caughtError));
            }
        }
    }
    // Projections if manifest not yet produced
    const totalEpisodes = 10;
    const budgetPlan = SeasonBudgetAllocator.planSeasonBudget(id, 100.0, totalEpisodes);
    const profiles = [];
    for (let ep = 1; ep <= totalEpisodes; ep++) {
        profiles.push(SeasonArcController.getEpisodePacingProfile(ep, totalEpisodes));
    }
    send({
        success: true,
        seriesId: id,
        totalEpisodes,
        completedEpisodes: 0,
        seasonBudget: budgetPlan,
        pacingProfiles: profiles,
    });
    return true;
}
