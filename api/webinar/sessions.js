import { proxyWebinarBooking } from '../../lib/webinarBookingProxy.js';

// GET /api/webinar/sessions — upcoming times from the public schedule form.
export default function handler(req, res) {
  return proxyWebinarBooking(req, res, 'sessions');
}
