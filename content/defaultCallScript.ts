export const DEFAULT_GLOBELEIFE_PAZ_CALL_SCRIPT_TITLE = 'Globelife Paz — Call script';

export const DEFAULT_GLOBELEIFE_PAZ_CALL_SCRIPT = `GLOBELIFE PAZ ORGANIZATION — RECRUITER CALL SCRIPT
(Replace [brackets] with your details. Edit anything below to match your style.)

OPENING
Hi, is this [Candidate Name]?
Great — my name is [Your Name], and I'm calling from Globelife Paz Organization. How are you doing today?

REASON FOR THE CALL
I'm reaching out because we received your information regarding career opportunities in the financial services / insurance field, and I wanted to see if you're still open to learning more about what we offer.

QUICK QUALIFY
• Are you currently employed or actively looking for a change?
• What type of schedule and income goals are you working toward?
• Have you ever worked in sales, customer service, or something client-facing?

VALUE (KEEP IT SIMPLE)
At Globelife Paz we help families with life and supplemental benefits. Our team members build their own book of business with training, leads, and leadership support — you don't need prior insurance experience to get started.

WEBINAR / NEXT STEP
The best next step is a short online overview where we walk through the role, compensation, and licensing path. It only takes about [X] minutes.

Would [day/time] work for you, or is there another time that's better?

IF INTERESTED — BOOK
Perfect. I'll send you the registration link / get you signed up for the webinar now.
What's the best email to use? And just to confirm your phone number is [number]?

IF NOT SURE
No problem — what questions can I answer for you right now?

IF NOT INTERESTED
I appreciate your honesty. Before I let you go — is it the timing, the industry, or something else?
[If firm no] Thank you for your time, [Name]. Have a great day.

IF VOICEMAIL
Hi [Name], this is [Your Name] with Globelife Paz Organization. I'm calling about the career opportunity we have open. You can reach me at [your number]. I'll try you again, or feel free to call me back. Thanks!

CLOSE (BOOKED)
You're all set for [date/time]. You'll receive a confirmation email — please check spam if you don't see it. We look forward to meeting you. Have a great day!`;

export function draftCallScriptFields(): { title: string; body: string } {
  return {
    title: DEFAULT_GLOBELEIFE_PAZ_CALL_SCRIPT_TITLE,
    body: DEFAULT_GLOBELEIFE_PAZ_CALL_SCRIPT,
  };
}
