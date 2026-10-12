




import { TimelineVisualizer } from "./TimelineVisualizer.js";

import type { WorkspaceModel } from "../../app/use-workspace.js";

export function TimelineFeature({currentTime, editShot, handleSeek, selected, setSelected, timeline, video}:Pick<WorkspaceModel,"currentTime"|"editShot"|"handleSeek"|"selected"|"setSelected"|"timeline"|"video">){return ((
            <div className="nle-embedded-panel">
              <TimelineVisualizer
                timeline={timeline}
                currentTime={currentTime}
                onSeek={handleSeek}
                selectedShotId={selected}
                onSelectShot={setSelected}
                onEditShot={(sId, change, dir) => editShot(sId, change, dir)}
                videoRef={video}
              />
            </div>
          ));}
