// DashboardModule: admin summary and quick stats
import React, { useEffect, useState } from 'react';
import { Activity, Calendar, Music, Mail } from 'lucide-react';
import { API_BASE } from '../App';

function StatCard({ title, value, color = 'purple', Icon }){
  const colorMap = {
    purple: 'text-purple-400 border-purple-500 bg-purple-500/10',
    blue: 'text-blue-400 border-blue-500 bg-blue-500/10',
    green: 'text-green-400 border-green-500 bg-green-500/10',
    orange: 'text-orange-400 border-orange-500 bg-orange-500/10',
  };
  const cls = colorMap[color] || colorMap.purple;

  return (
    <div className={`rounded-xl border p-6 ${cls}`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg bg-white/5`}> 
            {Icon && <Icon className="h-8 w-8" />}
          </div>
          <div>
            <h4 className="text-sm text-gray-300">{title}</h4>
            <div className="text-3xl font-bold mt-1">{value}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DashboardModule(){
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchStats = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/dashboard-stats`);
      const data = await res.json();
      if (data && data.success && data.stats) {
        setStats(data.stats);
      } else {
        setError('Failed to load stats');
      }
    } catch (err) {
      console.error('Dashboard stats error', err);
      setError('Failed to fetch dashboard statistics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Welcome back</h2>
          <p className="text-sm text-gray-400">Overview of venue activity and quick stats.</p>
        </div>
        <div>
          <button onClick={fetchStats} className="px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded">Refresh</button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="animate-spin h-12 w-12 border-4 border-purple-500 border-t-transparent rounded-full" />
        </div>
      ) : error ? (
        <div className="p-4 bg-red-600/10 border border-red-600 text-red-400 rounded">{error}</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard title="Upcoming Events" value={stats.upcoming_events} color="purple" Icon={Calendar} />
          <StatCard title="Pending Seat Requests" value={stats.pending_requests} color="blue" Icon={Mail} />
          <StatCard title="Pending Suggestions" value={stats.pending_suggestions} color="green" Icon={Music} />
          <StatCard title="Events This Month" value={stats.events_this_month} color="orange" Icon={Activity} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-gray-800 rounded-xl p-6 border border-purple-500/30">
          <h3 className="text-xl font-semibold mb-2">Welcome</h3>
          <p className="text-gray-400">Manage your events, seating and requests from the admin panel. Use the sidebar to navigate between modules. This overview shows current counts and quick links for common actions.</p>

          <div className="mt-4 flex flex-wrap gap-3">
            <button className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded">Create Event</button>
            <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded">View Requests</button>
            <button className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded">Review Suggestions</button>
          </div>
        </div>

        <aside className="bg-gray-800 rounded-xl p-6 border border-purple-500/20">
          <h4 className="text-lg font-semibold mb-2">Recent Activity</h4>
          <p className="text-gray-400">No recent activity to show. Activity log will appear here.</p>
        </aside>
      </div>
    </div>
  );
}

