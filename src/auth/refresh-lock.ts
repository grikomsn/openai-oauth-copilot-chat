/** Serialize rotating direct-plan refreshes across VS Code extension hosts. */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export type RefreshLock = <T>(profile: string, operation: () => Promise<T>) => Promise<T>;

export function createRefreshLock(directory: string): RefreshLock {
  return async <T>(profile: string, operation: () => Promise<T>): Promise<T> => {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const file = join(directory, `${createHash("sha256").update(profile).digest("hex")}.lock`);
    const owner = randomUUID();
    const deadline = Date.now() + 45_000;
    while (true) {
      try {
        const handle = await open(file, "wx", 0o600);
        try { await handle.writeFile(owner); } finally { await handle.close(); }
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        // A request has a 30-second deadline; reclaim only abandoned locks far beyond it.
        const info = await stat(file).catch(() => undefined);
        if (info && Date.now() - info.mtimeMs > 120_000) await unlink(file).catch(() => undefined);
        if (Date.now() >= deadline) throw new Error("Another VS Code window is refreshing this ChatGPT connection. Try again shortly.");
        await delay(100);
      }
    }
    try { return await operation(); } finally {
      if (await readFile(file, "utf8").catch(() => undefined) === owner) await unlink(file).catch(() => undefined);
    }
  };
}
