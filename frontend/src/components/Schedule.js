import React from 'react';
// Schedule: simple list of upcoming events used on the home page
import { Calendar, Clock, DollarSign, Users } from 'lucide-react';

const formatDate = (dateString) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'
  });
};

const formatTime = (timeString) => {
  if (!timeString) return '';
  // Expecting HH:MM:SS
  const [hours, minutes] = timeString.split(':');
  const hour = parseInt(hours, 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minutes} ${ampm}`;
};

export default function Schedule({ events = [], loading = false }){
  const scrollToSeating = () => {
    const el = document.getElementById('seating');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <section className="py-6">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-8">
          <h2 className="text-4xl font-bold">Upcoming Shows</h2>
          <p className="text-gray-300 mt-2">Stay up to date with the latest bookings and ticket info.</p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="animate-spin h-12 w-12 border-4 border-purple-500 border-t-transparent rounded-full"></div>
          </div>
        ) : events.length === 0 ? (
          <div className="text-center py-12">
            <Calendar className="h-16 w-16 text-gray-500 mx-auto mb-4" />
            <p className="text-xl text-gray-400">No upcoming shows</p>
            <p className="text-gray-500 mt-2">Check back soon for new events.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {events.map((event) => (
              <div key={event.id} className="bg-gray-800 rounded-xl p-6 border border-purple-500/20 hover:border-purple-500/60 transition transform hover:scale-105">
                <div className="flex items-start space-x-4">
                  <div className="flex-shrink-0">
                    <div className="w-20 h-20 bg-gray-700 rounded-lg flex items-center justify-center">
                      {/* Image placeholder */}
                      <span className="text-sm text-gray-300">Image</span>
                    </div>
                  </div>

                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xl font-semibold">{event.artist_name}</h3>
                      <span className="text-sm text-gray-400">{event.genre}</span>
                    </div>

                    <p className="text-gray-300 mt-2 text-sm">{event.description}</p>

                    <div className="mt-4 flex items-center text-sm text-gray-300 space-x-4">
                      <div className="flex items-center"><Calendar className="h-4 w-4 mr-2" /> {formatDate(event.event_date)}</div>
                      <div className="flex items-center"><Clock className="h-4 w-4 mr-2" /> {formatTime(event.event_time)}</div>
                      <div className="flex items-center"><DollarSign className="h-4 w-4 mr-2" /> ${event.ticket_price}</div>
                    </div>

                    <div className="mt-6 flex items-center justify-between">
                      <div className="text-sm text-gray-400">{event.age_restriction || 'All Ages'}</div>
                      <button onClick={scrollToSeating} className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg">Request Seats</button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
