import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const app = express();
app.use(express.json());

const mcp = new McpServer({
  name: "yetiforce-mcp",
  version: "1.0.0",
});

// przykładowy Ping tool MCP
mcp.tool(
  "ping",
  {},
  async () => ({ content: "pong" })
);

// routing MCP
app.post("/mcp", async (req, res) => {
  await mcp.handleRequest(req, res);
});

// pozostaw health
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.listen(3333, () => {
  console.log("Server running on port 3333");
});
