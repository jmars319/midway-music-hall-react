import React from 'react';
import Navigation from '../components/Navigation';
import Footer from '../components/Footer';

export default function TermsOfService({ onAdminClick }) {
  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <Navigation onAdminClick={onAdminClick} />
      
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <h1 className="text-4xl font-bold mb-8">Terms of Service</h1>
        
        <div className="prose prose-invert prose-purple max-w-none space-y-6 text-gray-300">
          <section>
            <h2 className="text-2xl font-semibold text-white mb-3">Agreement to Terms</h2>
            <p>
              By accessing and using this website, you accept and agree to be bound by the terms and provision of this agreement.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-3">Venue Rules and Conduct</h2>
            <p>When attending events at Midway Music Hall, you agree to:</p>
            <ul className="list-disc list-inside ml-4 space-y-2">
              <li>Respect other patrons, staff, and performers</li>
              <li>Follow all venue rules and instructions from staff</li>
              <li>Refrain from disruptive or dangerous behavior</li>
              <li>Comply with age restrictions for specific events</li>
              <li>Not bring outside food or beverages unless explicitly permitted</li>
            </ul>
            <p className="mt-3">
              We reserve the right to refuse service or remove any patron who violates these rules without refund.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-3">Ticket Sales and Reservations</h2>
            <p>
              Seat requests submitted through our website are subject to availability and confirmation. Submission of a request does not guarantee seating. We will contact you to confirm your reservation.
            </p>
            <p className="mt-3">
              Ticket sales are final. Refunds may be issued only in the case of event cancellation by the venue.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-3">Event Changes and Cancellations</h2>
            <p>
              Midway Music Hall reserves the right to change event dates, times, or performers without notice. In the event of a cancellation, ticket holders will be notified and offered a refund or credit toward future events.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-3">Photography and Recording</h2>
            <p>
              Professional recording equipment and video cameras are not permitted without prior authorization. By attending our events, you consent to being photographed or recorded for promotional purposes.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-3">Limitation of Liability</h2>
            <p>
              Midway Music Hall is not responsible for lost, stolen, or damaged personal property. Attendance at events is at your own risk.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-3">Artist Suggestions</h2>
            <p>
              Artist suggestions submitted through our website are reviewed but do not guarantee booking. We reserve the right to select performers at our discretion based on availability, fit, and business considerations.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-3">Use of Website</h2>
            <p>
              You agree not to misuse this website, including but not limited to: attempting to gain unauthorized access, interfering with the proper functioning of the site, or submitting false or misleading information.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-3">Changes to Terms</h2>
            <p>
              We reserve the right to modify these Terms of Service at any time. Your continued use of the website following any changes constitutes acceptance of those changes.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-3">Contact Information</h2>
            <p>
              If you have any questions about these Terms of Service, please contact us using the information provided in the footer.
            </p>
          </section>

          <p className="text-sm text-gray-500 mt-8">Last updated: {new Date().toLocaleDateString()}</p>
        </div>
      </main>

      <Footer />
    </div>
  );
}
