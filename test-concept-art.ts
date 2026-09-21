import { ConceptArtGenerator } from "./src/series/concept-art-generator.js";
import { BibleManager } from "./src/bible/bible-manager.js";
async function run() {
  const bible = new BibleManager(":memory:");
  bible.upsertCharacter({ id: "c1", series_id: "s1", name: "Minh", role: "protagonist", status: "alive" });
  const generator = new ConceptArtGenerator(bible);
  try {
    await generator.generateCharacterConceptArt({
      seriesId: "s1",
      characterId: "c1",
      allowMock: false
    });
    console.log("Success (Bug: ignored allowMock: false)");
  } catch (e) {
    console.log("Error (Correct): " + e.message);
  }
}
run();
