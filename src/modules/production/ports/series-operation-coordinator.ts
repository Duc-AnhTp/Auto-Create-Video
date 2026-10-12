export interface SeriesOperationCoordinator {
  isUnderMaintenance(seriesId: string): boolean;
  enter(seriesId: string, maintenanceToken?: string): () => void;
  beginMaintenance(seriesId: string): {token: string; release(): void};
}
