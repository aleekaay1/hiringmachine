import React from 'react';
import { Navigate } from 'react-router-dom';

/** Site root sends traffic to the public webinar self-schedule form. */
const Landing: React.FC = () => <Navigate to="/schedule-webinar" replace />;

export default Landing;
