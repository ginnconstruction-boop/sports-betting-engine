// ============================================================
// src/services/alertService.ts
// Email + SMS alerts for high-confidence picks
// Configure in .env:
//   ALERT_EMAIL_ENABLED=true
//   ALERT_EMAIL_TO=you@gmail.com
//   ALERT_EMAIL_FROM=yourapp@gmail.com
//   ALERT_EMAIL_PASS=your-app-password
//   ALERT_SMS_ENABLED=false
//   ALERT_TWILIO_SID=
//   ALERT_TWILIO_TOKEN=
//   ALERT_TWILIO_FROM=+1xxxxxxxxxx
//   ALERT_PHONE_TO=+1xxxxxxxxxx
//   ALERT_MIN_SCORE=88
// ============================================================
import * as nodemailer from 'nodemailer';

function fmtPrice(p: number): string {
  return p > 0 ? `+${p}` : `${p}`;
}

export interface AlertPick {
  sport: string;
  matchup: string;
  betType: string;
  side: string;
  bestUserBook: string;
  bestUserPrice: number;
  grade: string;
  score: number;
  tier: string;
  hoursUntilGame?: number;
}

function buildAlertBody(picks: AlertPick[], scanType: string): string {
  const lines: string[] = [
    `SBE ALERT -- ${scanType}`,
    `${new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })} CT`,
    `${picks.length} high-confidence play(s) found:`,
    '',
  ];

  picks.forEach((p, i) => {
    const hrs = p.hoursUntilGame ? ` (~${Math.round(p.hoursUntilGame)}hrs)` : '';
    lines.push(`#${i+1} [${p.grade}] ${p.sport} -- ${p.matchup}${hrs}`);
    lines.push(`     ${p.betType}: ${p.side}`);
    lines.push(`     ${p.bestUserBook} @ ${fmtPrice(p.bestUserPrice)} | Score: ${p.score}/100 | ${p.tier}`);
    lines.push('');
  });

  lines.push('-- Sports Betting Engine Elite Model v2.2');
  return lines.join('\n');
}

function buildAlertHTML(picks: AlertPick[], scanType: string): string {
  const rows = picks.map((p, i) => {
    const hrs = p.hoursUntilGame ? ` (~${Math.round(p.hoursUntilGame)}hrs)` : '';
    return `
      <tr>
        <td style="padding:6px 8px;font-weight:bold;color:#39d353">#${i+1} [${p.grade}]</td>
        <td style="padding:6px 8px">${p.sport} -- ${p.matchup}${hrs}</td>
        <td style="padding:6px 8px">${p.betType}: <strong>${p.side}</strong></td>
        <td style="padding:6px 8px;font-weight:bold;color:#39d353">${p.bestUserBook} @ ${fmtPrice(p.bestUserPrice)}</td>
        <td style="padding:6px 8px">${p.score}/100</td>
      </tr>`;
  }).join('');

  return `
    <div style="font-family:monospace;background:#0d1117;color:#e6edf3;padding:20px;max-width:600px">
      <h2 style="color:#39d353;margin:0 0 4px">SBE ALERT</h2>
      <p style="color:#7d8590;margin:0 0 16px;font-size:12px">${scanType} // ${new Date().toLocaleString('en-US',{timeZone:'America/Chicago'})} CT</p>
      <table style="width:100%;border-collapse:collapse;background:#161b22">
        <tr style="background:#0d2a1a">
          <th style="padding:6px 8px;text-align:left;color:#39d353;font-size:10px">GRADE</th>
          <th style="padding:6px 8px;text-align:left;color:#39d353;font-size:10px">GAME</th>
          <th style="padding:6px 8px;text-align:left;color:#39d353;font-size:10px">PICK</th>
          <th style="padding:6px 8px;text-align:left;color:#39d353;font-size:10px">BOOK/PRICE</th>
          <th style="padding:6px 8px;text-align:left;color:#39d353;font-size:10px">SCORE</th>
        </tr>
        ${rows}
      </table>
      <p style="color:#7d8590;font-size:10px;margin-top:12px">Sports Betting Engine Elite Model v2.2 // Always verify player status</p>
    </div>`;
}

export async function sendAlerts(
  picks: AlertPick[],
  scanType: string = 'Morning Scan'
): Promise<void> {
  const minScore = parseInt(process.env.ALERT_MIN_SCORE ?? '88');
  const qualifying = picks.filter(p => p.score >= minScore && p.tier === 'BET');

  if (qualifying.length === 0) return;

  const emailEnabled = process.env.ALERT_EMAIL_ENABLED === 'true';
  const smsEnabled   = process.env.ALERT_SMS_ENABLED === 'true';

  if (!emailEnabled && !smsEnabled) return;

  console.log(`  [ALERT] Sending alerts for ${qualifying.length} A+ play(s)...`);

  // -- Email --
  if (emailEnabled) {
    try {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.ALERT_EMAIL_FROM ?? '',
          pass: process.env.ALERT_EMAIL_PASS ?? '',
        },
      });

      await transporter.sendMail({
        from: `"SBE Alerts" <${process.env.ALERT_EMAIL_FROM}>`,
        to: process.env.ALERT_EMAIL_TO ?? '',
        subject: `SBE ALERT: ${qualifying.length} A+ Play(s) -- ${scanType}`,
        text: buildAlertBody(qualifying, scanType),
        html: buildAlertHTML(qualifying, scanType),
      });
      console.log(`  [ALERT] Email sent to ${process.env.ALERT_EMAIL_TO}`);
    } catch (err: any) {
      console.log(`  [ALERT] Email failed: ${err.message}`);
    }
  }

  // -- SMS via Twilio --
  if (smsEnabled) {
    try {
      const sid   = process.env.ALERT_TWILIO_SID ?? '';
      const token = process.env.ALERT_TWILIO_TOKEN ?? '';
      const from  = process.env.ALERT_TWILIO_FROM ?? '';
      const to    = process.env.ALERT_PHONE_TO ?? '';

      if (!sid || !token || !from || !to) {
        console.log('  [ALERT] SMS skipped -- Twilio credentials not set in .env');
        return;
      }

      const body = buildAlertBody(qualifying, scanType).split('\n').slice(0,8).join('\n');
      const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
      const { default: https } = await import('https');

      await new Promise<void>((resolve, reject) => {
        const data = new URLSearchParams({ From: from, To: to, Body: body }).toString();
        const auth = Buffer.from(`${sid}:${token}`).toString('base64');
        const req = https.request(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${auth}`,
          }
        }, (res) => {
          res.statusCode && res.statusCode < 300 ? resolve() : reject(new Error(`Twilio ${res.statusCode}`));
        });
        req.on('error', reject);
        req.write(data);
        req.end();
      });
      console.log(`  [ALERT] SMS sent to ${to}`);
    } catch (err: any) {
      console.log(`  [ALERT] SMS failed: ${err.message}`);
    }
  }
}
