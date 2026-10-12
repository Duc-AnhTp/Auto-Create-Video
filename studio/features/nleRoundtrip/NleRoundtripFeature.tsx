




import { NleRoundTripView } from "./NleRoundTripView.js";

import type { WorkspaceModel } from "../../app/use-workspace.js";

export function NleRoundtripFeature({api, episode, seriesId, setError, setNotice}:Pick<WorkspaceModel,"api"|"episode"|"seriesId"|"setError"|"setNotice">){return ((
            <NleRoundTripView
              seriesId={seriesId}
              episodeNumber={episode}
              api={api}
              onNotice={(msg) => setNotice(msg)}
              onError={(err) => setError(err)}
            />
          ));}
