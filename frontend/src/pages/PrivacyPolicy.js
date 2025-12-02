import React from 'react';
import Navigation from '../components/Navigation';
import Footer from '../components/Footer';

export default function PrivacyPolicy({ onAdminClick }) {
  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <Navigation onAdminClick={onAdminClick} />
      
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <h1 className="text-4xl font-bold mb-8">Privacy Policy</h1>
        
        <div className="prose prose-invert prose-purple max-w-none space-y-6 text-gray-300">
          <section>
            <h2 className="text-2xl font-semibold text-white mb-3">Information We Collect</h2>
            <p>
              When you submit seat requests or artist suggestions through our website, we collect your name and contact information (email and/or phone) to process your request and communicate with you.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-3">How We Use Your Information</h2>
            <p>We use the information you provide to:</p>
            <ul className="list-disc list-inside ml-4 space-y-2">
              <li>Process seat reservations and ticket requests</li>
              <li>Review and respond to artist suggestions</li>
              <li>Communicate with you about events and your requests</li>
              <li>Improve our services and customer experience</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-3">Information Sharing</h2>
            <p>
              We do not sell, trade, or share your personal information with third parties for marketing purposes. Your information is used solely for the purposes stated above and is kept confidential.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-3">Data Security</h2>
            <p>
              We implement reasonable security measures to protect your personal information from unauthorized access, alteration, or disclosure.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-3">Your Rights</h2>
            <p>
              You have the right to request access to, correction of, or deletion of your personal information. To exercise these rights, please contact us at the email address provided in our footer.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-3">Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy on this page.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-3">Contact Us</h2>
            <p>
              If you have any questions about this Privacy Policy, please contact us through the information provided in the footer.
            </p>
          </section>

          <p className="text-sm text-gray-500 mt-8">Last updated: {new Date().toLocaleDateString()}</p>
        </div>
      </main>

      <Footer />
    </div>
  );
}
