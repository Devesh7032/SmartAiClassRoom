import { useState } from 'react';
import { User, ShieldAlert } from 'lucide-react';

interface AuthProps {
  setToken: (token: string) => void;
}

export default function Auth({ setToken }: AuthProps) {
  const [isLogin, setIsLogin] = useState<boolean>(true);
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [name, setName] = useState<string>('');
  const [role, setRole] = useState<'teacher' | 'student'>('student');
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';
    const payload = isLogin ? { email, password } : { email, password, name, role };

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Something went wrong');
      }

      setToken(data.token);
    } catch (err: any) {
      setError(err.message || 'Connection failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrapper">
      <div className="auth-card glass-panel">
        <div className="auth-header">
          <div className="auth-logo">🎓</div>
          <h2 className="auth-title">
            {isLogin ? 'Welcome Back' : 'Create Class Account'}
          </h2>
          <p className="auth-subtitle">
            {isLogin
              ? 'Log in to join your online classroom portal.'
              : 'Register your details to start hosting or attending lessons.'}
          </p>
        </div>

        {error && (
          <div
            className="animate-slide-in"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '12px',
              background: 'var(--danger-light)',
              border: '1px solid var(--danger)',
              borderRadius: 'var(--radius)',
              color: 'var(--danger)',
              fontSize: '13px',
              fontWeight: 500,
              marginBottom: '20px',
            }}
          >
            <ShieldAlert size={18} />
            <div>{error}</div>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {!isLogin && (
            <div className="form-group">
              <label className="form-label">Full Name</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. Professor John Doe"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Email Address</label>
            <input
              type="email"
              className="form-input"
              placeholder="e.g. name@university.edu"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">Password</label>
            <input
              type="password"
              className="form-input"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {!isLogin && (
            <div className="form-group">
              <label className="form-label">Select Your Role</label>
              <div className="role-selector">
                <div
                  className={`role-card ${role === 'student' ? 'selected' : ''}`}
                  onClick={() => setRole('student')}
                >
                  <span className="role-icon">🧑‍🎓</span>
                  <span className="role-name">Student</span>
                </div>
                <div
                  className={`role-card ${role === 'teacher' ? 'selected' : ''}`}
                  onClick={() => setRole('teacher')}
                >
                  <span className="role-icon">👩‍🏫</span>
                  <span className="role-name">Teacher</span>
                </div>
              </div>
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', padding: '12px', marginTop: '10px' }}
            disabled={loading}
          >
            {loading ? 'Processing...' : isLogin ? 'Sign In' : 'Sign Up'}
          </button>
        </form>

        <div className="auth-footer">
          {isLogin ? (
            <>
              Don't have an account?{' '}
              <span className="auth-link" onClick={() => setIsLogin(false)}>
                Register here
              </span>
            </>
          ) : (
            <>
              Already registered?{' '}
              <span className="auth-link" onClick={() => setIsLogin(true)}>
                Login here
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
