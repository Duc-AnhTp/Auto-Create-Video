




import { TakeComparisonPlayer } from "./TakeComparisonPlayer.js";

import type { WorkspaceModel } from "../../app/use-workspace.js";

export function ComparisonFeature({charRef, episode, handleApproveTake, handleRerollShot, selected, seriesId, takes, timeline}:Pick<WorkspaceModel,"charRef"|"episode"|"handleApproveTake"|"handleRerollShot"|"selected"|"seriesId"|"takes"|"timeline">){return ((
            <TakeComparisonPlayer
              seriesId={seriesId}
              episodeNumber={episode}
              shotId={selected || (timeline?.videoTrack[0]?.shotId || "shot_1")}
              takes={takes}
              characterReferenceUrl={charRef}
              onApproveTake={handleApproveTake}
              onRerollShot={handleRerollShot}
            />
          ));}
