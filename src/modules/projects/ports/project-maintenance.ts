/** File/SQLite operations are implemented by adapters and wired at bootstrap. */
export interface ProjectMaintenance {
 backup(seriesId: string): Promise<unknown>;
 restore(seriesId: string, backupId: string): Promise<unknown>;
 list(seriesId: string): Promise<unknown>;
 usage(seriesId: string): Promise<unknown>;
}
