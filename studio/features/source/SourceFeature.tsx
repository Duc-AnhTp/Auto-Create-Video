

import type { DraftResponse } from "../../../src/contracts/studio-responses.js";


import type { WorkspaceModel } from "../../app/use-workspace.js";

import { SourcePanel } from "../source/SourcePanel.js";
export function SourceFeature({scopeKey, api, dirty, run, save, seriesId, setEpisode, setPanel, setSaved, setText, setVersion}:Pick<WorkspaceModel,"scopeKey"|"api"|"dirty"|"run"|"save"|"seriesId"|"setEpisode"|"setPanel"|"setSaved"|"setText"|"setVersion">){return ((
            <SourcePanel key={scopeKey}
              seriesId={seriesId}
              run={run}
              onGenerated={(value, ep) => {
                void run(async () => {
                  if (dirty) await save();
                  const dest = `/api/v1/series/${seriesId}/episodes/${ep}/draft`;
                  const current = await api<DraftResponse>(dest);
                  const next = await api<DraftResponse>(dest, { baseVersion: current.version, text: value });
                  setEpisode(ep);
                  setText(next.text);
                  setSaved(next.text);
                  setVersion(next.version);
                  setPanel("script");
                });
              }}
            />
          ));}
