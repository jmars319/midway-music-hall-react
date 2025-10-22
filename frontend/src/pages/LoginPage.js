import React, { useState } from 'react';
// LoginPage: admin login form; lightweight demo auth + DB lookup
import { API_BASE } from '../App';

export default function LoginPage({ onLogin, onBack }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (data.success) {
        onLogin && onLogin(data.user);
      } else {
        setError(data.message || 'Invalid credentials');
      }
    } catch (err) {
      console.error(err);
      setError('Network error — please try again');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 py-12">
      <div className="max-w-md w-full bg-gray-800 rounded-xl p-6 border border-purple-500/20">
        <h2 className="text-2xl font-bold text-white mb-2">Admin Login</h2>
        <p className="text-gray-300 text-sm mb-4">Demo credentials: <span className="font-medium">admin</span> / <span className="font-medium">admin123</span></p>

        {error && <div className="mb-4 p-3 bg-red-500/10 border border-red-500 text-red-300 rounded">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="mb-3">
            <label className="block text-white mb-2">Email</label>
            <input type="text" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-4 py-3 bg-gray-700 text-white rounded-lg" required />
          </div>

          <div className="mb-4">
            <label className="block text-white mb-2">Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-4 py-3 bg-gray-700 text-white rounded-lg" required />
          </div>

          <div className="flex items-center justify-between gap-3">
            <button type="button" onClick={onBack} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded">Back</button>
            <button type="submit" disabled={loading} className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded">
              {loading ? 'Logging in...' : 'Login'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
