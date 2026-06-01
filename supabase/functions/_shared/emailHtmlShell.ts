/** Wrap email body fragments for reliable HTML rendering in Outlook/Gmail. */

export function wrapTransactionalEmailHtml(bodyInnerHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background-color:#f4f6f8;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f6f8;">
<tr>
<td align="left" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
<tr>
<td style="background-color:#ffffff;padding:24px;border-radius:8px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#1f2937;">
${bodyInnerHtml}
</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>`;
}
