import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { exportNleTimelines } from "../../../modules/media/index.js";
import type { UnifiedTimeline } from "../../../contracts/timeline.js";
import { UnifiedTimelineSchema } from "../../../contracts/timeline.js";
import { ProjectPaths } from "../../../platform/filesystem/project-paths.js";
import { HttpError } from "../../../platform/errors.js";
import { SeriesId } from "../../../contracts/requests.js";
import type { RouteContext, SendJson } from "./context.js";
export async function route40_nleExport(req: IncomingMessage, res: ServerResponse, url: URL, send: SendJson, ctx: Pick<RouteContext, never>): Promise<boolean> {
    const nleExportMatch = url.pathname.match(/^\/api\/v1\/series\/([^/]+)\/episodes\/(\d+)\/nle\/export$/);
    if (!(nleExportMatch && req.method === "GET"))
        return false;
    const id = SeriesId.parse(nleExportMatch[1]);
    const epNum = parseInt(nleExportMatch[2], 10);
    const paths = new ProjectPaths();
    const epDir = paths.episodeOutput(id, epNum);
    const timelinePath = paths.episodeTimeline(id, epNum);
    if (!timelinePath) {
        throw new HttpError(404, "TIMELINE_REQUIRED", "Tập chưa có timeline đã dựng.");
    }
    const timeline: UnifiedTimeline = UnifiedTimelineSchema.parse(JSON.parse(readFileSync(timelinePath, "utf-8")));
    const outDir = paths.check(id, join(epDir, "nle_export"));
    const xmlPath = paths.check(id, join(outDir, `ep${epNum}_davinci_resolve.xml`));
    const edlPath = paths.check(id, join(outDir, `ep${epNum}_cmx3600.edl`));
    const otioPath = paths.check(id, join(outDir, `ep${epNum}_opentimelineio.otio`));
    const exportResult = await exportNleTimelines({
        timeline,
        outXmlPath: xmlPath,
        outEdlPath: edlPath,
        outOtioPath: otioPath,
        sequenceName: `Series_${id}_Ep${epNum}_Master`,
    });
    const xmlText = readFileSync(xmlPath, "utf-8");
    const edlText = readFileSync(edlPath, "utf-8");
    send({
        success: true,
        exportResult,
        xmlContent: xmlText,
        edlContent: edlText,
    });
    return true;
}
