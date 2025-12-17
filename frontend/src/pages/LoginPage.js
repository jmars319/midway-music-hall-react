import React, { useState } from 'react';
// LoginPage: admin login form; lightweight demo auth + DB lookup
import { API_BASE } from '../apiConfig';
import BrandImage from '../components/BrandImage';

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
        credentials: 'include',
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (data.success) {
        onLogin && onLogin(data.user, data.session);
      } else {
        setError(data.message || 'Invalid credentials');
      }
    } catch (err) {
      console.error(err);
      setError('Network error; please try again');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 py-12">
      <div className="max-w-md w-full bg-gray-800 rounded-xl p-6 border border-purple-500/20">
        <div className="flex justify-center mb-4">
          <BrandImage
            variant="logo"
            alt="Midway Music Hall"
            className="h-16 w-auto object-contain"
            width={160}
            height={80}
          />
        </div>
        <h2 className="text-2xl font-bold text-white mb-2">Admin Login</h2>
        {/* Demo credentials removed for security */}

        {error && <div className="mb-4 p-3 bg-red-500/10 border border-red-500 text-red-300 rounded" role="alert" aria-live="assertive">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="mb-3">
            <label className="block text-white mb-2" htmlFor="admin-login-email">Email</label>
            <input
              id="admin-login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 bg-gray-700 text-white rounded-lg"
              required
            />
          </div>

          <div className="mb-4">
            <label className="block text-white mb-2" htmlFor="admin-login-password">Password</label>
            <input
              id="admin-login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 bg-gray-700 text-white rounded-lg"
              required
            />
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
