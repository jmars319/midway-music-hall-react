import React from 'react';
import LegalDocumentPage from '../components/LegalDocumentPage';

export default function TermsOfService({ onAdminClick }) {
  return <LegalDocumentPage documentKey="terms" onAdminClick={onAdminClick} />;
}
