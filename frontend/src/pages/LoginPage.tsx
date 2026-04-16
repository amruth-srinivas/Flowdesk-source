import { motion } from 'framer-motion';
import { LayoutDashboard, ShieldCheck, Users } from 'lucide-react';
import type { FormEvent } from 'react';

type LoginPageProps = {
  employeeId: string;
  password: string;
  loginError: string;
  isSubmitting: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onEmployeeIdChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
};

export function LoginPage({
  employeeId,
  password,
  loginError,
  isSubmitting,
  onSubmit,
  onEmployeeIdChange,
  onPasswordChange,
}: LoginPageProps) {
  return (
    <motion.main
      key="login"
      className="login-layout"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.4 }}
    >
      <section className="login-showcase">
        <div className="glow-orb orb-one" />
        <div className="glow-orb orb-two" />
        <div className="showcase-content">
          <span className="badge">FlowDesk Workspace</span>
          <h1>Collaborate, organize, and deliver with clarity.</h1>
          <p>
            A modern dashboard experience for admins, team leads, and members to manage projects, knowledge, and
            calendars in one place.
          </p>
          <div className="showcase-cards">
            <article>
              <LayoutDashboard size={18} />
              <span>Role based layouts</span>
            </article>
            <article>
              <ShieldCheck size={18} />
              <span>Secure employee sign in</span>
            </article>
            <article>
              <Users size={18} />
              <span>Built for team workflows</span>
            </article>
          </div>
        </div>
      </section>

      <section className="login-panel">
        <motion.form className="login-form" onSubmit={onSubmit} layout>
          <h2>Welcome back</h2>
          <p>Sign in with your employee credentials.</p>
          <label htmlFor="employeeId">Employee ID</label>
          <input
            id="employeeId"
            placeholder="Enter your employee ID"
            value={employeeId}
            onChange={(event) => onEmployeeIdChange(event.target.value)}
          />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            placeholder="Enter password"
            value={password}
            onChange={(event) => onPasswordChange(event.target.value)}
          />
          {loginError ? <small className="error-text">{loginError}</small> : null}
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Signing in...' : 'Sign in'}
          </button>
        </motion.form>
      </section>
    </motion.main>
  );
}
