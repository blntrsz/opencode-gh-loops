import { run } from "./index.ts";

const controller = new AbortController();
const cancel = () => controller.abort();
process.once("SIGINT", cancel);
process.once("SIGTERM", cancel);
await run(controller.signal);
process.removeListener("SIGINT", cancel);
process.removeListener("SIGTERM", cancel);
