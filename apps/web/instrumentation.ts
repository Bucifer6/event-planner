// Runs once when the server process starts. Node-only work lives in instrumentation-node.ts.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
