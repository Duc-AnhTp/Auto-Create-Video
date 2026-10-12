import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { containedPath } from "../../../../platform/filesystem/containment.js";
import { atomicWriteFile } from "../../../../platform/filesystem/atomic-publication.js";
import { WorkflowError } from "../../../../platform/workflow-error.js";
import type { RerollReservation, RerollReservationStore } from "../../ports/reroll-reservation-store.js";

const ReservationSchema = z.object({
    requestHash: z.string().regex(/^[a-f0-9]{64}$/), takeId: z.string().min(1),
    takeNumber: z.number().int().positive(), takeNumStr: z.string().regex(/^\d+$/), localPath: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();

export class FileRerollReservationStore implements RerollReservationStore {
    private path(outputDir: string, operationId: string): string {
        if (!/^[a-zA-Z0-9_-]{1,200}$/.test(operationId)) throw new WorkflowError("INVALID_JOB_ID", "Invalid reroll operation ID");
        return containedPath(outputDir, join(outputDir, "rerolls", operationId + ".json"));
    }
    async load(outputDir: string, operationId: string): Promise<RerollReservation | null> {
        const file = this.path(outputDir, operationId);
        if (!existsSync(file)) return null;
        const reservation = ReservationSchema.parse(JSON.parse(await readFile(file, "utf8")));
        containedPath(outputDir, reservation.localPath);
        return reservation;
    }
    async save(outputDir: string, operationId: string, reservation: RerollReservation): Promise<void> {
        const file = this.path(outputDir, operationId);
        containedPath(outputDir, reservation.localPath);
        await mkdir(containedPath(outputDir, join(outputDir, "rerolls")), { recursive: true });
        await atomicWriteFile(file, JSON.stringify(ReservationSchema.parse(reservation)), "utf8");
    }
}
