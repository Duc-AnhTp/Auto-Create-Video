

import type { BibleView } from "../../../src/contracts/studio-responses.js";


import { ProjectAssetsPanel } from "./ProjectAssetsPanel.js";

import type { WorkspaceModel } from "../../app/use-workspace.js";

export function AssetsFeature({api, episode, scopeKey, scoped, seriesId, setBible, setError, setNotice}:Pick<WorkspaceModel,"api"|"episode"|"scopeKey"|"scoped"|"seriesId"|"setBible"|"setError"|"setNotice">){return ((<ProjectAssetsPanel seriesId={seriesId} episode={episode} api={api} onRefresh={async()=>{const data=await scoped.current.load(scopeKey,"bible",signal=>api<BibleView>(`/api/series/${seriesId}/bible`,undefined,signal));setBible(data);}} onNotice={setNotice} onError={setError}/>));}
