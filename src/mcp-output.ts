import { writeSync } from "node:fs";

// A separate process keeps blocking Windows stdout outside the server's event loop.
process.on("message", (message: unknown) => {
  if (typeof message !== "string") process.exit(1);
  try {
    const bytes = Buffer.from(message + "\n");
    let offset = 0;
    while (offset < bytes.length) {
      const written = writeSync(1, bytes, offset, bytes.length - offset);
      if (written === 0) throw new Error("Output made no progress");
      offset += written;
    }
    process.send?.(true, () => {});
  } catch {
    process.send?.(false, () => {});
  }
});
process.on("disconnect", () => process.exit());
