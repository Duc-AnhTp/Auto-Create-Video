




import { SeasonShowrunnerView } from "./SeasonShowrunnerView.js";

import type { WorkspaceModel } from "../../app/use-workspace.js";

export function SeasonFeature({api, seriesId, setError, setNotice}:Pick<WorkspaceModel,"api"|"seriesId"|"setError"|"setNotice">){return ((
            <SeasonShowrunnerView
              seriesId={seriesId}
              api={api}
              onNotice={(msg) => setNotice(msg)}
              onError={(err) => setError(err)}
            />
          ));}
