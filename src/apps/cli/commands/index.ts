import type { SeriesCommand } from './context.js';
import { initCommand } from './init.js';
import { characterCommand } from './character.js';
import { locationCommand } from './location.js';
import { propCommand } from './prop.js';
import { episodeCommand } from './episode.js';
import { writeScriptCommand } from './write-script.js';
import { genCharacterArtCommand } from './gen-character-art.js';
import { genLocationArtCommand } from './gen-location-art.js';
import { resumeCommand } from './resume.js';
import { rerollCommand } from './reroll.js';
import { remuxCommand } from './remux.js';
import { reviewCommand } from './review.js';
import { statusCommand } from './status.js';
import { jobsCommand } from './jobs.js';
import { reconcileCommand } from './reconcile.js';
import { budgetCommand } from './budget.js';
import { doctorCommand } from './doctor.js';
import { planCommand } from './plan.js';
import { studioCommand } from './studio.js';
import { ingestCommand } from './ingest.js';
import { analyzeCommand } from './analyze.js';
import { planSeriesCommand } from './plan-series.js';
import { planApproveCommand } from './plan-approve.js';
import { finalizeCommand } from './finalize.js';
import { seasonCommand } from './season.js';
export const seriesCommands: Record<string, SeriesCommand> = {
    "series:init": initCommand,
    "series:character": characterCommand,
    "series:location": locationCommand,
    "series:prop": propCommand,
    "series:episode": episodeCommand,
    "series:write-script": writeScriptCommand,
    "series:gen-character-art": genCharacterArtCommand,
    "series:gen-location-art": genLocationArtCommand,
    "series:resume": resumeCommand,
    "series:reroll": rerollCommand,
    "series:remux": remuxCommand,
    "series:review": reviewCommand,
    "series:status": statusCommand,
    "series:jobs": jobsCommand,
    "series:reconcile": reconcileCommand,
    "series:budget": budgetCommand,
    "series:doctor": doctorCommand,
    "series:plan": planCommand,
    "series:studio": studioCommand,
    "series:ingest": ingestCommand,
    "series:analyze": analyzeCommand,
    "series:plan-series": planSeriesCommand,
    "series:plan-approve": planApproveCommand,
    "series:finalize": finalizeCommand,
    "series:season": seasonCommand
};
