import { Resend } from 'resend';
import { config } from './config.js';
import { reportHtml } from './reportHtml.js';

export async function sendReport(report) {
  if (config.useMockEmail) {
    console.log(`Mock email report for ${config.reportToEmail || 'REPORT_TO_EMAIL not set'}`);
    return { sent: false, mocked: true, to: config.reportToEmail || null };
  }
  if (!config.reportToEmail) throw new Error('REPORT_TO_EMAIL is required to send a report');
  const resend = new Resend(config.resendApiKey);
  const result = await resend.emails.send({ from: 'WristOrder <onboarding@resend.dev>', to: config.reportToEmail, subject: `WristOrder weekly report — ${report.period}`, html: reportHtml(report) });
  if (result.error) throw new Error(result.error.message);
  return { sent: true, mocked: false, to: config.reportToEmail, id: result.data?.id };
}
