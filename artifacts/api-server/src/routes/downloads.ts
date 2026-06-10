import { Router, type IRouter } from "express";
import path from "path";
import fs from "fs";
import { requireRole } from "../middleware/require-role";

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
  "source": {
    file: path.resolve(process.cwd(), "../../classmate-source.tar.gz"),
    name: "classmate-source.tar.gz",
    mime: "application/gzip",
  },
  "upgrade": {
    file: path.resolve(process.cwd(), "../../classmate-upgrade.tar.gz"),
    name: "classmate-upgrade.tar.gz",
    mime: "application/gzip",
  },
};

// Layer 1 — admin-only.
// requireAuth is applied globally (see routes/index.ts) before this router is
// mounted, guaranteeing unauthenticated callers receive 401 before reaching
// these handlers. requireRole("admin") here provides defence-in-depth at the
// handler level: teacher, student, parent, and guest roles all receive 403.
router.get("/downloads", requireRole("admin"), async (_req, res): Promise<void> => {
  res.json({
    message: "Classmate Download Links",
    files: Object.entries(FILES).map(([key, val]) => ({
      key,
      name: val.name,
      url: `/api/downloads/${key}`,
    })),
  });
});

router.get("/downloads/:key", requireRole("admin"), async (req, res): Promise<void> => {
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
