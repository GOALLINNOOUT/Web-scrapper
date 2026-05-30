import { AlertEvent } from '../models/AlertEvent.js';

interface DailyEmailAlertInput {
  deviceId: string;
  domain: string;
  crawlId: string;
  pageUrl: string;
  emails: string[];
}

export async function createDailyEmailAlert(input: DailyEmailAlertInput) {
  const emails = [...new Set(input.emails.map((email) => email.trim().toLowerCase()).filter(Boolean))];
  if (emails.length === 0) return null;

  const [startOfDay, endOfDay] = localDayRange();
  const alreadyAlerted = await AlertEvent.find(
    {
      deviceId: input.deviceId,
      type: 'new_email',
      createdAt: { $gte: startOfDay, $lt: endOfDay },
      'metadata.emails': { $in: emails }
    },
    { 'metadata.emails': 1 }
  ).lean();

  const seen = new Set(alreadyAlerted.flatMap((alert) => {
    const metadata = alert.metadata as { emails?: string[] } | undefined;
    return (metadata?.emails || []).map((email) => email.toLowerCase());
  }));
  const freshEmails = emails.filter((email) => !seen.has(email));
  if (freshEmails.length === 0) return null;

  return AlertEvent.create({
    deviceId: input.deviceId,
    type: 'new_email',
    severity: 'high',
    domain: input.domain,
    crawlId: input.crawlId,
    pageUrl: input.pageUrl,
    message: `${freshEmails.length} new email${freshEmails.length === 1 ? '' : 's'} found on ${input.domain}`,
    metadata: {
      emails: freshEmails,
      dedupeDate: toLocalDateKey(new Date())
    }
  });
}

function localDayRange(date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const end = new Date(start);
  end.setDate(start.getDate() + 1);
  return [start, end] as const;
}

function toLocalDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
