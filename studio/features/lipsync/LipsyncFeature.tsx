




import { LipSyncView } from "./LipSyncView.js";

import type { WorkspaceModel } from "../../app/use-workspace.js";

export function LipsyncFeature({api, episode, seriesId, setError, setNotice}:Pick<WorkspaceModel,"api"|"episode"|"seriesId"|"setError"|"setNotice">){return ((
            <LipSyncView
              seriesId={seriesId}
              episodeNumber={episode}
              api={api}
              onNotice={(msg) => setNotice(msg)}
              onError={(err) => setError(err)}
            />
          ));}
