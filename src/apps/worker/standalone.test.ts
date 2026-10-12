import { afterEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { JobStore } from "../../modules/production/adapters/sqlite/job-store.js";

describe("worker launch lifecycle", () => {
    let child: ChildProcess | undefined, queue: JobStore | undefined, directory: string | undefined, dataDir: string | undefined;
    afterEach(async () => {
        if (child && child.exitCode === null && child.signalCode === null) {
            const closed = new Promise(resolve => child!.once("close", resolve));
            child.kill(); await closed;
        }
        queue?.close();
        if (directory) await rm(directory, { recursive: true, force: true });
        if (dataDir) await rm(dataDir, { recursive: true, force: true });
    });
    async function start(parent?: string) {
        const id = "standalone-" + randomUUID();
        directory = resolve("output", "test-worker", id); dataDir = resolve("data", "series", id);
        await mkdir(directory, { recursive: true });
        const dbPath = join(directory, "queue.db"); queue = new JobStore(dbPath);
        const job = queue.enqueue({ kind: "postprocess", seriesId: id, episodeNumber: 1, inputArtifactId: randomUUID() });
        let output = "";
        child = spawn(process.execPath, ["--import", "tsx", resolve("src/apps/worker/main.ts"), dbPath, ...(parent ? [parent] : [])], { windowsHide: true, env: { ...process.env, OFFLINE_WORKER: "1", OFFLINE_RUNTIME: "1" }, stdio: ["ignore", "pipe", "pipe"] });
        child.stdout?.on("data", chunk => { output += String(chunk); }); child.stderr?.on("data", chunk => { output += String(chunk); });
        return { id: job.id, output: () => output };
    }
    it("executes queued work when launched without a parent PID", async () => {
        const job = await start();
        const deadline = Date.now() + 20_000;
        while (queue!.get(job.id).status !== "failed" && Date.now() < deadline) {
            if (child!.exitCode !== null) throw new Error("Standalone worker exited: " + job.output());
            await delay(100);
        }
        expect(queue!.get(job.id)).toMatchObject({ status: "failed", error: { code: "ARTIFACT_NOT_FOUND" } });
        expect(child!.exitCode).toBeNull();
    });
    it("exits without claiming jobs when the supplied parent no longer exists", async () => {
        const job = await start("2147483647");
        const deadline = Date.now() + 20_000;
        while (child!.exitCode === null && Date.now() < deadline) await delay(100);
        expect(child!.exitCode, job.output()).toBe(0);
        expect(queue!.get(job.id).status).toBe("queued");
    });
});
