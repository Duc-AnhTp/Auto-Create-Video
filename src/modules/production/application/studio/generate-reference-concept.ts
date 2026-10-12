import { ConceptArtGenerator } from "../concept-art-generator.js";
import type { GenerateReferenceConceptStore } from "../../ports/studio/generate-reference-concept-store.js";
export async function generateReferenceConcept(bible: GenerateReferenceConceptStore, args: {
    body: {
        entityId: string;
        entityType: "character" | "location";
        provider: "mock" | "local_comfyui" | "cloud";
        turnaround: boolean;
    };
    id: string;
}) {
    const { body, id } = args;
    const generator = new ConceptArtGenerator(bible);
    return body.entityType === "location" ? generator.generateLocationConceptArt({ seriesId: id, locationId: body.entityId, provider: body.provider, allowMock: body.provider === "mock" }) : body.turnaround ? generator.generateCharacterTurnaroundPack({ seriesId: id, characterId: body.entityId, provider: body.provider, allowMock: body.provider === "mock" }) : generator.generateCharacterConceptArt({ seriesId: id, characterId: body.entityId, provider: body.provider, allowMock: body.provider === "mock" });
}
