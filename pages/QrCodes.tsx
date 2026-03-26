import React, { useCallback } from 'react';
import Layout from '../components/Layout';
import { Card, Button } from '../components/UI';
import QRCode from 'react-qr-code';
import * as QRCodeLib from 'qrcode';

const COLORS = { primary: '#005EB8', accent: '#37B06D' };

const openPrintView = (options: {
  title: string;
  subtitle: string;
  url: string;
  instruction: string;
}) => {
  QRCodeLib.toDataURL(options.url, { width: 280, margin: 1 }).then((dataUrl) => {
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const headerUrl = `${origin}/header.PNG`;
      const win = window.open('', '_blank');
      if (!win) return;
      win.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>${options.title} - Paz Organization</title>
            <style>
              * { margin: 0; padding: 0; box-sizing: border-box; }
              body {
                font-family: 'Segoe UI', system-ui, sans-serif;
                padding: 32px;
                max-width: 400px;
                margin: 0 auto;
                color: #1f2937;
              }
              .logo { max-height: 56px; width: auto; max-width: 100%; margin-bottom: 24px; display: block; object-fit: contain; }
              .bar { height: 6px; background: linear-gradient(90deg, ${COLORS.primary}, ${COLORS.accent}); margin-bottom: 24px; border-radius: 3px; }
              h1 { font-size: 20px; color: ${COLORS.primary}; margin-bottom: 8px; }
              .sub { font-size: 14px; color: #6b7280; margin-bottom: 24px; }
              .qr-wrap { text-align: center; padding: 24px; background: #f9fafb; border-radius: 12px; margin-bottom: 24px; }
              .qr-wrap img { display: block; margin: 0 auto 12px; border-radius: 8px; }
              .instruction { font-size: 13px; color: #4b5563; line-height: 1.5; margin-bottom: 24px; }
              .footer { font-size: 11px; color: #9ca3af; border-top: 1px solid #e5e7eb; padding-top: 16px; }
              @media print { body { padding: 16px; } }
            </style>
          </head>
          <body>
            <img src="${headerUrl}" alt="Globe Life AIL" class="logo" onerror="this.style.display='none'"/>
            <div class="bar"></div>
            <h1>${options.title}</h1>
            <p class="sub">${options.subtitle}</p>
            <div class="qr-wrap">
              <img src="${dataUrl}" alt="QR Code" width="280" height="280" />
              <span style="font-size:12px;color:#6b7280;">Scan with your phone</span>
            </div>
            <p class="instruction">${options.instruction}</p>
            <p class="footer">Globe Life AIL Division · Paz Organization</p>
            <script>window.onload = function() { window.print(); window.onafterprint = function() { window.close(); }; }</script>
          </body>
        </html>
      `);
      win.document.close();
    });
};

const QrCodes: React.FC = () => {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const arrivalUrl = `${origin}/interview`;
  const assessmentUrl = `${origin}/assessment-lookup`;

  const downloadArrivalPdf = useCallback(() => {
    openPrintView({
      title: 'Candidate Checkin',
      subtitle: 'Before the live Zoom session',
      url: arrivalUrl,
      instruction: 'Place this at your front desk or entrance. Candidates scan to complete the Candidate Checkin before joining the live Zoom session.',
    });
  }, [arrivalUrl]);

  const downloadAssessmentPdf = useCallback(() => {
    openPrintView({
      title: 'Leadership Assessment & Applicant Questionnaire',
      subtitle: 'After the Career Overview Zoom session',
      url: assessmentUrl,
      instruction: 'Candidates scan and enter their email to complete the merged Leadership Assessment and Applicant Questionnaire (after the Zoom session).',
    });
  }, [assessmentUrl]);

  return (
    <Layout isAdmin>
      <div className="max-w-4xl mx-auto w-full p-6 space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">QR Codes</h1>
          <p className="text-sm text-gray-500 mt-1">
            Display or print these at your office. Use &quot;Download PDF&quot; for a branded, print-ready page.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="flex flex-col items-center text-center space-y-4">
            <h2 className="font-semibold text-gray-900">1. Candidate Checkin</h2>
            <p className="text-xs text-gray-500">Candidates scan to complete check-in before joining the live Zoom session.</p>
            <div className="bg-white p-4 rounded-xl border">
              <QRCode value={arrivalUrl} size={180} />
            </div>
            <p className="text-[11px] text-gray-400 break-all">{arrivalUrl}</p>
            <Button variant="outline" onClick={downloadArrivalPdf} className="w-full">
              Download PDF (branded, print-ready)
            </Button>
          </Card>

          <Card className="flex flex-col items-center text-center space-y-4">
            <h2 className="font-semibold text-gray-900">2. Leadership Assessment (Merged)</h2>
            <p className="text-xs text-gray-500">After the Zoom session — lookup by email and complete the merged form.</p>
            <div className="bg-white p-4 rounded-xl border">
              <QRCode value={assessmentUrl} size={180} />
            </div>
            <p className="text-[11px] text-gray-400 break-all">{assessmentUrl}</p>
            <Button variant="outline" onClick={downloadAssessmentPdf} className="w-full">
              Download PDF (branded, print-ready)
            </Button>
          </Card>
        </div>

        <div className="text-xs text-gray-500 border-t border-gray-100 pt-4">
          <p className="font-medium text-gray-700 mb-1">QR & links</p>
          <p>
            <strong>QR 1</strong>: Candidate Checkin before the live Zoom session. <strong>QR 2</strong>: After the Zoom session, candidates scan and enter their email to complete the merged Leadership Assessment & Applicant Questionnaire.
          </p>
        </div>
      </div>
    </Layout>
  );
};

export default QrCodes;
