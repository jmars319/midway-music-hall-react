import React from 'react';
import LegalDocumentPage from '../components/LegalDocumentPage';

export default function PrivacyPolicy({ onAdminClick }) {
  return <LegalDocumentPage documentKey="privacy" onAdminClick={onAdminClick} />;
}
