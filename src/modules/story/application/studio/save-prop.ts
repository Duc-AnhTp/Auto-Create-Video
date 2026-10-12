import type { SavePropStore } from "../../ports/studio/save-prop-store.js";
export function saveProp(bible: SavePropStore, args: {
    body: {
        [x: string]: unknown;
        id: string;
        name: string;
        current_holder_id?: string | undefined;
        description?: string | undefined;
    };
    seriesId: string;
}) {
    const { body, seriesId } = args;
    bible.upsertKeyProp({
        id: body.id,
        series_id: seriesId,
        name: body.name,
        current_holder_id: body.current_holder_id,
        description: body.description,
    });
    return bible.getKeyProp(body.id, seriesId);
}
