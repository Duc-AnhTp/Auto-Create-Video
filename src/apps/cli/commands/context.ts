import type { openCliSeries } from '../../../bootstrap/cli-session.js';
export interface SeriesCommandContext {
    args: string[];
    subArgs: string[];
    subCommand: string;
    seriesId: string | undefined;
    explicitBible: string | undefined;
    biblePath: string;
    bible: ReturnType<typeof openCliSeries>['store'];
}
export type SeriesCommand = (context: SeriesCommandContext) => Promise<void>;
