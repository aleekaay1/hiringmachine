import { proxyWebinarBooking } from '../../lib/webinarBookingProxy.js';

// GET /api/webinar/verification?email= — same WebinarGeek email check as /pipeline/webinar-verify.
export default function handler(req, res) {
  return proxyWebinarBooking(req, res, 'verification');
}
