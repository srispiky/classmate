import { Router, type IRouter } from "express";
import path from "path";
import fs from "fs";

const router: IRouter = Router();

const FILES: Record<string, { file: string; name: string; mime: string }> = {
  "deploy-script": {
    file: path.resolve(process.cwd(), "../../Deploy-Classmate.ps1"),
    name: "Deploy-Classmate.ps1",
    mime: "text/plain",
  },
  "db-export": {
    file: path.resolve(process.cwd(), "../../classmate_db_export.sql"),
    name: "classmate_db_export.sql",
    mime: "application/octet-stream",
  },
  "setup-guide": {
    file: path.resolve(process.cwd(), "../../LOCAL_SETUP.md"),
    name: "LOCAL_SETUP.md",
    mime: "text/markdown",
  },
  "bundle": {
    file: path.resolve(process.cwd(), "../../classmate-deploy.tar.gz"),
    name: "classmate-deploy.tar.gz",
    mime: "application/gzip",
  },
};

router.get("/downloads", async (_req, res): Promise<void> => {
  res.json({
    message: "Classmate Download Links",
    files: Object.entries(FILES).map(([key, val]) => ({
      key,
      name: val.name,
      url: `/api/downloads/${key}`,
    })),
  });
});

router.get("/downloads/:key", async (req, res): Promise<void> => {
  const item = FILES[req.params.key as string];
  if (!item) {
    res.status(404).json({ error: "File not found" });
    return;
  }
  if (!fs.existsSync(item.file)) {
    res.status(404).json({ error: "File not available on disk" });
    return;
  }
  res.setHeader("Content-Disposition", `attachment; filename="${item.name}"`);
  res.setHeader("Content-Type", item.mime);
  res.sendFile(item.file);
});

export default router;
