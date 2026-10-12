import { openCliSeries } from '../../bootstrap/cli-session.js';
import { seriesCommands } from './commands/index.js';
import { getArgValue, hasFlag, resolveBiblePath, printSeriesUsage } from './arguments.js';
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
export async function runSeriesCli(args: string[]): Promise<void> {
    const subCommand = args[0];
    const subArgs = args.slice(1);
    if (!subCommand || subCommand === "series:help" || hasFlag(subArgs, "--help", "-h")) {
        printSeriesUsage();
        return;
    }
    const seriesId = getArgValue(subArgs, "--series") || getArgValue(subArgs, "--id");
    const explicitBible = getArgValue(subArgs, "--bible");
    const biblePath = resolveBiblePath(seriesId, explicitBible);
    // Ensure parent directory exists for SQLite db
    if (biblePath !== ":memory:") {
        await mkdir(dirname(biblePath), { recursive: true });
    }
    const runtime = openCliSeries(biblePath), bible = runtime.store;
    try {
        const handler = seriesCommands[subCommand];
        if (!handler) {
            console.error(`❌ Lệnh không hợp lệ: "${subCommand}". Chạy series:help để xem danh sách lệnh.`);
            process.exit(2);
        }
        await handler({ args, subCommand, subArgs, seriesId, explicitBible, biblePath, bible });
    }
    finally {
        runtime.dispose();
    }
}
