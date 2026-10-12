




import { SeasonTrailerWorkspaceView } from "./SeasonTrailerWorkspaceView.js";

import type { WorkspaceModel } from "../../app/use-workspace.js";

export function SeasonTrailerFeature({api, seriesId, setError, setNotice}:Pick<WorkspaceModel,"api"|"seriesId"|"setError"|"setNotice">){return ((
            <SeasonTrailerWorkspaceView
              seriesId={seriesId}
              api={api}
              onNotice={(msg) => setNotice(msg)}
              onError={(err) => setError(err)}
            />
          ));}
