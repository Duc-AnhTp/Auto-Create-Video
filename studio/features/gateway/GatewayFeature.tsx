




import { GatewayReconciliationView } from "./GatewayReconciliationView.js";

import type { WorkspaceModel } from "../../app/use-workspace.js";

export function GatewayFeature({api, episode, handleRunVerticalSlice, seriesId}:Pick<WorkspaceModel,"api"|"episode"|"handleRunVerticalSlice"|"seriesId">){return ((
            <GatewayReconciliationView
              api={api}
              seriesId={seriesId}
              episodeNumber={episode}
              onFetchMetrics={() => api("/api/v1/gateway/metrics")}
              onFetchReconciliation={() => api(`/api/v1/series/${seriesId}/reconciliation`)}
              onRunVerticalSlice={handleRunVerticalSlice}
            />
          ));}
