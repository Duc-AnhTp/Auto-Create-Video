




import { SemanticMemoryInspector } from "./SemanticMemoryInspector.js";

import type { WorkspaceModel } from "../../app/use-workspace.js";

export function SemanticFeature({episode, handleQuerySemanticMemory, seriesId, text}:Pick<WorkspaceModel,"episode"|"handleQuerySemanticMemory"|"seriesId"|"text">){return ((
            <SemanticMemoryInspector
              seriesId={seriesId}
              episodeNumber={episode}
              currentScriptText={text}
              onQueryMemory={handleQuerySemanticMemory}
            />
          ));}
