import type { SaveLocationStore } from "../../ports/studio/save-location-store.js";
export function saveLocation(bible: SaveLocationStore, args: {
    body: {
        [x: string]: unknown;
        id: string;
        name: string;
        visual_summary?: string | undefined;
        lighting_mood?: string | undefined;
        atmospheric_rules?: string | undefined;
        reference_image_path?: string | undefined;
    };
    seriesId: string;
}) {
    const { body, seriesId } = args;
    bible.upsertLocation({
        id: body.id,
        series_id: seriesId,
        name: body.name,
        visual_summary: body.visual_summary,
        lighting_mood: body.lighting_mood,
        atmospheric_rules: body.atmospheric_rules,
        reference_image_path: body.reference_image_path,
    });
    return bible.getLocation(body.id, seriesId);
}
