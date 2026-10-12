import { ConceptArtGenerator } from "./src/modules/production/application/concept-art-generator.js";
import { SqliteStoryStore } from "./src/bootstrap/sqlite-story-store.js";
async function run() {
  const bible = new SqliteStoryStore(":memory:");
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
    console.log("Error (Correct): " + (e instanceof Error ? e.message : String(e)));
  }
}
void run();
