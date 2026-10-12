import { ConceptArtGenerator } from "../concept-art-generator.js";
import type { GenerateConceptArtStore } from "../../ports/studio/generate-concept-art-store.js";
export async function generateConceptArt(bible: GenerateConceptArtStore, args: {
    seriesId: string;
    allowMock: boolean;
    body: {
        [x: string]: unknown;
        id: string;
        allowMock?: boolean | undefined;
        type?: "character" | "location" | undefined;
        promptOverride?: string | undefined;
        provider?: "mock" | "local_comfyui" | "cloud" | undefined;
    };
}) {
    const { body, seriesId, allowMock } = args;
    const gen = new ConceptArtGenerator(bible);
    if (body.type === "location") {
        return await gen.generateLocationConceptArt({
            seriesId,
            locationId: body.id,
            promptOverride: body.promptOverride,
            provider: body.provider || "mock",
            allowMock,
        });
    }
    else {
        return await gen.generateCharacterConceptArt({
            seriesId,
            characterId: body.id,
            promptOverride: body.promptOverride,
            provider: body.provider || "mock",
            allowMock,
        });
    }
}
