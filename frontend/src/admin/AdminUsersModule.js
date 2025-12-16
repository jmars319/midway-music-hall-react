import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { API_BASE } from '../apiConfig';

const INITIAL_FORM = {
  display_name: '',
  username: '',
  email: '',
  password: '',
};

const formatDate = (value) => {
  if (!value) return '—';
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch (err) {
    return value;
  }
};

export default function AdminUsersModule() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formState, setFormState] = useState(INITIAL_FORM);
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const passwordIsValid = useMemo(() => formState.password.length >= 10, [formState.password]);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/admin/users`, { credentials: 'include' });
      if (!res.ok) {
        if (res.status === 401) {
          setError('You must be signed in as an admin to view this list.');
        } else {
          setError('Unable to load admin users.');
        }
        setUsers([]);
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (data?.success && Array.isArray(data.users)) {
        setUsers(data.users);
      } else {
        setUsers([]);
        setError('No admin users were returned. Please try refreshing.');
      }
    } catch (err) {
      console.error('Failed to fetch admin users', err);
      setError('Unable to load admin users.');
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleInputChange = (event) => {
    const { name, value } = event.target;
    setFormState((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const resetForm = () => {
    setFormState(INITIAL_FORM);
    setShowPassword(false);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (saving) return;
    setFormError('');
    setFormSuccess('');
    const payload = {
      display_name: formState.display_name.trim(),
      username: formState.username.trim(),
      email: formState.email.trim(),
      password: formState.password,
    };
    if (!payload.username) {
      setFormError('Username is required.');
      return;
    }
    if (!passwordIsValid) {
      setFormError('Password must be at least 10 characters long.');
      return;
    }
    if (payload.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(payload.email)) {
      setFormError('Please enter a valid email address.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/admin/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        const message = data?.message || 'Unable to create admin user.';
        throw new Error(message);
      }
      setFormSuccess('Admin user created successfully.');
      resetForm();
      fetchUsers();
    } catch (err) {
      setFormError(err.message || 'Unable to create admin user.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8 text-gray-100">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl shadow-lg p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold text-white">Admin Accounts</h2>
            <p className="text-sm text-gray-400">Only signed-in admins can view or manage this list.</p>
          </div>
          <button
            type="button"
            onClick={fetchUsers}
            className="px-4 py-2 rounded-lg border border-purple-400/40 bg-purple-600/90 text-white hover:bg-purple-500 disabled:opacity-60"
            disabled={loading}
          >
            Refresh
          </button>
        </div>
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin h-10 w-10 border-4 border-purple-500 border-t-transparent rounded-full" />
          </div>
        ) : error ? (
          <div className="p-4 bg-red-900/40 text-red-100 border border-red-500/60 rounded-lg">{error}</div>
        ) : (
          <div className="overflow-x-auto border border-gray-800 rounded-xl">
            <table className="min-w-full divide-y divide-gray-800 text-sm">
              <thead className="bg-gray-800/70">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">Display name</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">Username</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">Email</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">Created</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800 bg-gray-900">
                {users.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-sm text-gray-400">No admin accounts found.</td>
                  </tr>
                )}
                {users.map((user) => (
                  <tr key={user.id || user.username} className="hover:bg-gray-800/60 transition-colors">
                    <td className="px-4 py-3 text-gray-100">{user.display_name || 'Admin'}</td>
                    <td className="px-4 py-3 text-gray-300">{user.username || '—'}</td>
                    <td className="px-4 py-3 text-gray-300 break-words">{user.email || '—'}</td>
                    <td className="px-4 py-3 text-gray-400">{formatDate(user.created_at)}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-green-900/50 text-green-200 border border-green-500/30">Active</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="border border-gray-800 rounded-2xl p-6 bg-gray-900 shadow-lg">
        <h3 className="text-lg font-semibold text-white mb-2">Add a new admin</h3>
        <p className="text-sm text-gray-400 mb-4">
          Provide a unique username and an email address the staff will recognize. Passwords must be at least 10 characters.
        </p>
        {formError && (
          <div className="mb-4 p-3 rounded-md bg-red-900/40 text-red-100 border border-red-500/60 text-sm">
            {formError}
          </div>
        )}
        {formSuccess && (
          <div className="mb-4 p-3 rounded-md bg-emerald-900/30 text-green-100 border border-emerald-500/40 text-sm">
            {formSuccess}
          </div>
        )}
        <form className="grid gap-4 md:grid-cols-2" onSubmit={handleSubmit}>
          <div className="md:col-span-1">
            <label htmlFor="display_name" className="block text-sm font-medium text-gray-300 mb-1">Display name</label>
            <input
              type="text"
              id="display_name"
              name="display_name"
              className="w-full rounded-md border border-gray-700 bg-gray-800 text-gray-100 placeholder-gray-500 focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              value={formState.display_name}
              onChange={handleInputChange}
              placeholder="Ex: Donna Cheek"
              autoComplete="name"
            />
          </div>
          <div className="md:col-span-1">
            <label htmlFor="username" className="block text-sm font-medium text-gray-300 mb-1">Username<span className="text-red-400">*</span></label>
            <input
              type="text"
              id="username"
              name="username"
              className="w-full rounded-md border border-gray-700 bg-gray-800 text-gray-100 placeholder-gray-500 focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              value={formState.username}
              onChange={handleInputChange}
              required
              autoComplete="username"
              minLength={3}
            />
          </div>
          <div className="md:col-span-1">
            <label htmlFor="email" className="block text-sm font-medium text-gray-300 mb-1">Email</label>
            <input
              type="email"
              id="email"
              name="email"
              className="w-full rounded-md border border-gray-700 bg-gray-800 text-gray-100 placeholder-gray-500 focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              value={formState.email}
              onChange={handleInputChange}
              placeholder="admin@example.com"
              autoComplete="email"
            />
          </div>
          <div className="md:col-span-1">
            <label htmlFor="password" className="block text-sm font-medium text-gray-300 mb-1">Password<span className="text-red-400">*</span></label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                id="password"
                name="password"
                className={`w-full rounded-md border ${passwordIsValid ? 'border-gray-700' : 'border-red-500'} bg-gray-800 text-gray-100 placeholder-gray-500 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 pr-12`}
                value={formState.password}
                onChange={handleInputChange}
                required
                minLength={10}
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute inset-y-0 right-0 px-3 text-sm text-gray-400 hover:text-gray-200 focus:outline-none"
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            <p className={`text-xs mt-1 ${passwordIsValid ? 'text-gray-400' : 'text-red-400'}`}>
              Password must be at least 10 characters.
            </p>
          </div>
          <div className="md:col-span-2 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-gray-400">New admins can log in immediately with the username and password you set here.</p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={resetForm}
                className="px-4 py-2 rounded-md border border-gray-700 text-sm text-gray-200 hover:bg-gray-800"
              >
                Clear form
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-md bg-purple-600 text-white hover:bg-purple-500 disabled:opacity-60"
                disabled={saving}
              >
                {saving ? 'Creating…' : 'Create admin'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
