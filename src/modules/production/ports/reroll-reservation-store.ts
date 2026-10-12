export interface RerollReservation {
    requestHash: string;
    takeId: string;
    takeNumber: number;
    takeNumStr: string;
    localPath: string;
    sha256?: string;
}

/** Keeps a queued reroll on the same take across worker restarts. */
export interface RerollReservationStore {
    load(outputDir: string, operationId: string): Promise<RerollReservation | null>;
    save(outputDir: string, operationId: string, reservation: RerollReservation): Promise<void>;
}
