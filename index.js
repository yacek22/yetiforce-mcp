import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const app = express();
app.use(express.json());

// Tworzymy MCP Server
const mcp = new McpServer({
  name: "yetiforce-mcp",
  version: "1.0.0",
});

// Przykładowe narzędzie MCP
mcp.tool(
  "ping",
  {},
  async () => ({ content: "pong" })
);

// Routing MCP JSON-RPC
app.post("/mcp", async (req, res) => {
  try {
    await mcp.handleRequest(req, res);
  } catch (err) {
    console.error("MCP error:", err);
    res.status(500).json({ error: "Internal MCP error" });
  }
});

// Healthcheck endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// Nasłuch na wszystkich interfejsach
const PORT = process.env.PORT || 3333;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
