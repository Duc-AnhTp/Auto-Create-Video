




import { StoryBibleGraph } from "./StoryBibleGraph.js";

import type { WorkspaceModel } from "../../app/use-workspace.js";

export function BibleGraphFeature({graphData, loadNarrativeGraph, seriesId}:Pick<WorkspaceModel,"graphData"|"loadNarrativeGraph"|"seriesId">){return ((
            <StoryBibleGraph
              seriesId={seriesId}
              data={graphData}
              onRefresh={() => {
                void loadNarrativeGraph();
              }}
            />
          ));}
