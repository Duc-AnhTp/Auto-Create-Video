import type { SaveCharacterStore } from "../../ports/studio/save-character-store.js";
export function saveCharacter(bible: SaveCharacterStore, args: {
    body: {
        [x: string]: unknown;
        id: string;
        name: string;
        role?: string | undefined;
        visual_summary?: string | undefined;
        distinguishing_marks?: string | undefined;
        status?: "alive" | "injured" | "deceased" | "missing" | undefined;
        face_reference_image?: string | undefined;
        voice_profile_id?: string | undefined;
    };
    seriesId: string;
}) {
    const { body, seriesId } = args;
    bible.upsertCharacter({
        id: body.id,
        series_id: seriesId,
        name: body.name,
        role: body.role || "supporting",
        visual_summary: body.visual_summary,
        distinguishing_marks: body.distinguishing_marks,
        status: body.status || "alive",
        face_reference_image: body.face_reference_image,
        voice_profile_id: body.voice_profile_id || "lucylab:default",
    });
    return bible.getCharacter(body.id, seriesId);
}
