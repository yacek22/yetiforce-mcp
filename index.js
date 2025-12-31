import express from "express";
const app = express();
app.use(express.json());

app.post("/mcp", (req, res) => {
  res.json({ jsonrpc: "2.0", result: { content: "pong" }, id: req.body.id || 1 });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

const PORT = process.env.PORT || 3333;
app.listen(PORT, "0.0.0.0", () => console.log(`Server running on ${PORT}`));
