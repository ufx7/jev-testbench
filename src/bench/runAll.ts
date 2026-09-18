import "dotenv/config";

async function main() {
  console.log("=== 1/5 Determinism ===");
  await import("./determinism.js");
  await new Promise((r) => setTimeout(r, 1000));

  console.log("\n=== 2/5 Latency ===");
  await import("./latency.js");
  await new Promise((r) => setTimeout(r, 1000));

  console.log("\n=== 3/5 Precision / response-contract checks ===");
  await import("./precision.js");
  await new Promise((r) => setTimeout(r, 1000));

  console.log("\n=== 4/5 Concurrency / rate limit behavior ===");
  await import("./concurrency.js");
  await new Promise((r) => setTimeout(r, 1000));

  console.log("\n=== 5/5 Context size limit (slow, sends large payloads) ===");
  await import("./contextLimit.js");
}

main();
