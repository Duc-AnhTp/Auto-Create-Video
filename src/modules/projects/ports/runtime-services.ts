import type {SettingsManager} from '../adapters/settings.js';
import type {SqliteProjectCatalog} from '../adapters/project-catalog.js';
export type ProjectSettings = Pick<SettingsManager,'getProviders'|'saveConfigUpdates'|'probeProvider'>;
export type ProjectCatalog = Pick<SqliteProjectCatalog,'listAllSeries'|'getSeriesBibleData'>;
