import { proxyWebinarBooking } from '../../lib/webinarBookingProxy.js';

// POST /api/webinar/registrations — books through the public /schedule-webinar path.
export default function handler(req, res) {
  return proxyWebinarBooking(req, res, 'registrations');
}
