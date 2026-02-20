import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { submitGapActualRepWithToken, verifyGapResponseToken } from '../../services/api';
import './GapResponse.css';

export default function GapResponse() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [value, setValue] = useState('');
  const [status, setStatus] = useState('idle'); // idle | loading | success | error | invalid
  const [message, setMessage] = useState('');
  const [verified, setVerified] = useState(null);

  useEffect(() => {
    if (!token) {
      setStatus('invalid');
      setMessage('Missing link. Please use the link from your Gap Analysis email.');
      return;
    }
    verifyGapResponseToken(token)
      .then((res) => {
        if (res.success && res.data) {
          setVerified(true);
          if (res.data.expired) {
            setStatus('invalid');
            setMessage('This link has expired. Please request a new one from your manager.');
          }
        } else {
          setVerified(false);
          setStatus('invalid');
          setMessage('Invalid or expired link. Please use the link from your Gap Analysis email.');
        }
      })
      .catch(() => {
        setVerified(false);
        setStatus('invalid');
        setMessage('Invalid or expired link. Please use the link from your Gap Analysis email.');
      });
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!token || verified !== true) return;
    const num = Number(value);
    if (Number.isNaN(num) || num < 0) {
      setStatus('error');
      setMessage('Please enter a valid number (0 or greater).');
      return;
    }
    setStatus('loading');
    setMessage('');
    try {
      await submitGapActualRepWithToken(token, num);
      setStatus('success');
      setMessage('Your Actual Sales Rep count has been saved. Thank you.');
      setValue('');
    } catch (err) {
      setStatus('error');
      setMessage(err?.message || 'Failed to submit. Please try again.');
    }
  };

  if (!token) {
    return (
      <div className="gap-response-page">
        <div className="gap-response-card">
          <h1>Gap Analysis – Submit Actual Sales Rep</h1>
          <p className="gap-response-error">Missing link. Please use the link from your Gap Analysis email.</p>
        </div>
      </div>
    );
  }

  if (verified === false || status === 'invalid') {
    return (
      <div className="gap-response-page">
        <div className="gap-response-card">
          <h1>Gap Analysis – Submit Actual Sales Rep</h1>
          <p className="gap-response-error">{message}</p>
        </div>
      </div>
    );
  }

  if (verified === null) {
    return (
      <div className="gap-response-page">
        <div className="gap-response-card">
          <h1>Gap Analysis – Submit Actual Sales Rep</h1>
          <p className="gap-response-intro">Checking link…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="gap-response-page">
      <div className="gap-response-card">
        <h1>Gap Analysis – Submit Actual Sales Rep</h1>
        <p className="gap-response-intro">
          Please enter your <strong>Actual number of Sales Reps</strong> below. This value will update the report automatically.
        </p>
        <form onSubmit={handleSubmit} className="gap-response-form">
          <label htmlFor="gap-response-value">Actual Sales Rep (Achieved)</label>
          <input
            id="gap-response-value"
            type="number"
            min={0}
            step={1}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="e.g. 5"
            disabled={status === 'loading' || status === 'success'}
            autoFocus
          />
          <button type="submit" disabled={status === 'loading'}>
            {status === 'loading' ? 'Sending…' : 'Submit'}
          </button>
        </form>
        {message && (
          <p className={status === 'success' ? 'gap-response-success' : 'gap-response-error'}>{message}</p>
        )}
      </div>
    </div>
  );
}
