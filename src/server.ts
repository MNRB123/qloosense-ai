import recommendationRoutes from "./recommendationRoutes.js";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json());

app.use("/api/recommendations", recommendationRoutes);

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    app: "QlooSense AI",
    qlooConfigured: Boolean(process.env.QLOO_API_KEY),
    message: "Backend is running"
  });
});

app.get("/", (_req, res) => {
  res.json({
    name: "QlooSense AI",
    description: "Personalized experience discovery",
    status: "running"
  });
});

app.listen(PORT, () => {
  console.log(`QlooSense AI backend running at http://localhost:${PORT}`);
});
