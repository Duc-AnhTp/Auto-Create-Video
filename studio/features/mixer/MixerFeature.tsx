




import { AudioStemMixer } from "../../shared/ui/AudioStemMixer.js";

import type { WorkspaceModel } from "../../app/use-workspace.js";

export function MixerFeature({timeline}:Pick<WorkspaceModel,"timeline">){return ((
            <AudioStemMixer stems={timeline?.stems || {}} />
          ));}
