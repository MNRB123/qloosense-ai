
import { Router } from "express";
import { z } from "zod";

const router = Router();

const requestSchema = z.object({
  interests: z.string().trim().min(2).max(200),
  city: z.string().trim().min(2).max(100),
  limit: z.number().int().min(1).max(10).optional().default(5)
});

router.post("/", (req, res) => {
  const parsed = requestSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Please provide valid interests and city."
    });
  }

  return res.status(503).json({
    status: "awaiting_qloo_api_key",
    message: "Recommendation service is not connected to Qloo yet.",
    request: parsed.data
  });
});

export default router;
