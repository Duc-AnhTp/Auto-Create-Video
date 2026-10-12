




import { SceneLightingMatcherView } from "./SceneLightingMatcherView.js";

import type { WorkspaceModel } from "../../app/use-workspace.js";

export function SceneLightingFeature({api, episode, seriesId, setError, setNotice}:Pick<WorkspaceModel,"api"|"episode"|"seriesId"|"setError"|"setNotice">){return ((
            <SceneLightingMatcherView
              seriesId={seriesId}
              episodeNumber={episode}
              api={api}
              onNotice={(msg) => setNotice(msg)}
              onError={(err) => setError(err)}
            />
          ));}
