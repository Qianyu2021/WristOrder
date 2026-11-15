import { Router } from 'express';
import multer from 'multer';
import { getStats } from '../stats.js';
import { buildReport, startReportSchedule } from '../report.js';
import { sendReport } from '../email.js';
import { askOwner } from '../ai/ownerAssistant.js';
import { receiveStock } from '../db.js';
import { broadcast } from '../events.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

startReportSchedule();
router.get('/owner/stats', (req, res) => res.json(getStats({ days: req.query.days })));
router.post('/owner/inventory/receive', (req, res, next) => {
  try {
    const snapshot = receiveStock(req.body?.kind, req.body?.id, req.body?.amount);
    broadcast('inventory', snapshot);
    res.json(snapshot);
  } catch (error) { next(error); }
});
router.get('/owner/report', async (_req, res, next) => {
  try { res.json(await buildReport()); } catch (error) { next(error); }
});
router.post('/owner/report/send', async (_req, res, next) => {
  try { const report = await buildReport(); const result = await sendReport(report); res.json({ ...result, summary_markdown: report.summary_markdown }); } catch (error) { next(error); }
});
router.post('/owner/ask', upload.single('audio'), async (req, res, next) => {
  try {
    const result = await askOwner({ audioBuffer: req.file?.buffer, mimeType: req.file?.mimetype, text: req.body?.text });
    res.json({ ...result, audio_url: `/api/tts?text=${encodeURIComponent(result.answer)}` });
  } catch (error) { next(error); }
});

export default router;
