import { PORT } from "./config.js";
import { createAcpApp } from "./app.js";

const { app } = createAcpApp();

app.listen(PORT, () => {
  console.log(`[ACP] REST server running on http://localhost:${PORT}`);
  console.log("[ACP] Discovery: /.well-known/acp.json");
});
