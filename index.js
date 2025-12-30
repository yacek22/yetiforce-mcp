import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const app = express();
app.use(express.json());

// MCP server
const mcp = new McpServer({
  name: "yetiforce-mcp",
  version: "1.0.0",
});

// testowe narzędzie MCP (PEWNE, PROSTE)
mcp.tool(
  "ping",
  {},
  async () => {
    return { content: "pong" };
  }
);

// endpoint MCP
app.post("/mcp", async (req, res) => {
  await mcp.handleRequest(req, res);
});

// healthcheck zostaje
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.listen(3333, () => {
  console.log("Server running on port 3333");
});
