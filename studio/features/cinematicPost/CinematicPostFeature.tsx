




import { CinematicPostView } from "./CinematicPostView.js";

import type { WorkspaceModel } from "../../app/use-workspace.js";

export function CinematicPostFeature({api, episode, jobs, seriesId, setError, setNotice}:Pick<WorkspaceModel,"api"|"episode"|"jobs"|"seriesId"|"setError"|"setNotice">){return ((
            <CinematicPostView
              jobs={jobs}
              seriesId={seriesId}
              episodeNumber={episode}
              api={api}
              onNotice={(msg) => setNotice(msg)}
              onError={(err) => setError(err)}
            />
          ));}
