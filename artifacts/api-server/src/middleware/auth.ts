import type { RequestHandler } from "express";

export const requireAuth: RequestHandler = (req, res, next) => {
  if (req.session?.userId) {
    next();
    return;
  }
  res.status(401).json({ error: "Unauthorized" });
};
