import React from 'react';
import { Navigate } from 'react-router-dom';

/** Site root sends Instantly traffic straight to the tracking check-in form. */
const Landing: React.FC = () => <Navigate to="/checkin" replace />;

export default Landing;
