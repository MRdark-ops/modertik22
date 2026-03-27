// API Service Client for Frontend
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

let authToken = localStorage.getItem('token') || null;

export function setAuthToken(token) {
  authToken = token;
  if (token) {
    localStorage.setItem('token', token);
  } else {
    localStorage.removeItem('token');
  }
}

function getAuthHeader() {
  if (!authToken) {
    throw new Error('No authentication token');
  }
  return {
    'Authorization': `Bearer ${authToken}`,
    'Content-Type': 'application/json'
  };
}

// ──────────────────────────────────────
// AUTH APIs
// ──────────────────────────────────────

export async function register(email, password, full_name, referral_code_input = null) {
  const response = await fetch(`${API_BASE_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, full_name, referral_code_input })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Registration failed');
  }

  const data = await response.json();
  setAuthToken(data.token);
  return data;
}

export async function login(email, password) {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Login failed');
  }

  const data = await response.json();
  setAuthToken(data.token);
  return data;
}

export async function getMe() {
  const response = await fetch(`${API_BASE_URL}/auth/me`, {
    method: 'GET',
    headers: getAuthHeader()
  });

  if (!response.ok) {
    throw new Error('Failed to fetch user');
  }

  return response.json();
}

export async function updateProfile(full_name) {
  const response = await fetch(`${API_BASE_URL}/auth/profile`, {
    method: 'PUT',
    headers: getAuthHeader(),
    body: JSON.stringify({ full_name })
  });

  if (!response.ok) {
    throw new Error('Failed to update profile');
  }

  return response.json();
}

export function logout() {
  setAuthToken(null);
}

// ──────────────────────────────────────
// DEPOSITS APIs
// ──────────────────────────────────────

export async function createDeposit(amount, file) {
  const formData = new FormData();
  formData.append('amount', amount);
  formData.append('proof_image', file);

  const response = await fetch(`${API_BASE_URL}/deposits`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${authToken}` },
    body: formData
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create deposit');
  }

  return response.json();
}

export async function getDeposits() {
  const response = await fetch(`${API_BASE_URL}/deposits`, {
    method: 'GET',
    headers: getAuthHeader()
  });

  if (!response.ok) {
    throw new Error('Failed to fetch deposits');
  }

  return response.json();
}

export async function getAllDeposits() {
  const response = await fetch(`${API_BASE_URL}/deposits/all`, {
    method: 'GET',
    headers: getAuthHeader()
  });

  if (!response.ok) {
    throw new Error('Failed to fetch deposits');
  }

  return response.json();
}

export async function approveDeposit(depositId, admin_note = '') {
  const response = await fetch(`${API_BASE_URL}/deposits/${depositId}/approve`, {
    method: 'POST',
    headers: getAuthHeader(),
    body: JSON.stringify({ admin_note })
  });

  if (!response.ok) {
    throw new Error('Failed to approve deposit');
  }

  return response.json();
}

export async function rejectDeposit(depositId, admin_note = '') {
  const response = await fetch(`${API_BASE_URL}/deposits/${depositId}/reject`, {
    method: 'POST',
    headers: getAuthHeader(),
    body: JSON.stringify({ admin_note })
  });

  if (!response.ok) {
    throw new Error('Failed to reject deposit');
  }

  return response.json();
}

// ──────────────────────────────────────
// WITHDRAWALS APIs
// ──────────────────────────────────────

export async function createWithdrawal(amount, wallet_address) {
  const response = await fetch(`${API_BASE_URL}/withdrawals`, {
    method: 'POST',
    headers: getAuthHeader(),
    body: JSON.stringify({ amount, wallet_address })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create withdrawal');
  }

  return response.json();
}

export async function getWithdrawals() {
  const response = await fetch(`${API_BASE_URL}/withdrawals`, {
    method: 'GET',
    headers: getAuthHeader()
  });

  if (!response.ok) {
    throw new Error('Failed to fetch withdrawals');
  }

  return response.json();
}

export async function getAllWithdrawals() {
  const response = await fetch(`${API_BASE_URL}/withdrawals/all`, {
    method: 'GET',
    headers: getAuthHeader()
  });

  if (!response.ok) {
    throw new Error('Failed to fetch withdrawals');
  }

  return response.json();
}

export async function approveWithdrawal(withdrawalId, admin_note = '') {
  const response = await fetch(`${API_BASE_URL}/withdrawals/${withdrawalId}/approve`, {
    method: 'POST',
    headers: getAuthHeader(),
    body: JSON.stringify({ admin_note })
  });

  if (!response.ok) {
    throw new Error('Failed to approve withdrawal');
  }

  return response.json();
}

export async function rejectWithdrawal(withdrawalId, admin_note = '') {
  const response = await fetch(`${API_BASE_URL}/withdrawals/${withdrawalId}/reject`, {
    method: 'POST',
    headers: getAuthHeader(),
    body: JSON.stringify({ admin_note })
  });

  if (!response.ok) {
    throw new Error('Failed to reject withdrawal');
  }

  return response.json();
}

// ──────────────────────────────────────
// REFERRALS APIs
// ──────────────────────────────────────

export async function getReferrals() {
  const response = await fetch(`${API_BASE_URL}/referrals`, {
    method: 'GET',
    headers: getAuthHeader()
  });

  if (!response.ok) {
    throw new Error('Failed to fetch referrals');
  }

  return response.json();
}

export async function getReferralCode() {
  const response = await fetch(`${API_BASE_URL}/referrals/code`, {
    method: 'GET',
    headers: getAuthHeader()
  });

  if (!response.ok) {
    throw new Error('Failed to fetch referral code');
  }

  return response.json();
}

// ──────────────────────────────────────
// ADMIN APIs
// ──────────────────────────────────────

export async function getAdminUsers() {
  const response = await fetch(`${API_BASE_URL}/admin/users`, {
    method: 'GET',
    headers: getAuthHeader()
  });

  if (!response.ok) {
    throw new Error('Failed to fetch users');
  }

  return response.json();
}

export async function getAdminStats() {
  const response = await fetch(`${API_BASE_URL}/admin/stats`, {
    method: 'GET',
    headers: getAuthHeader()
  });

  if (!response.ok) {
    throw new Error('Failed to fetch stats');
  }

  return response.json();
}

export async function getAdminLogs(limit = 100, offset = 0) {
  const response = await fetch(`${API_BASE_URL}/admin/logs?limit=${limit}&offset=${offset}`, {
    method: 'GET',
    headers: getAuthHeader()
  });

  if (!response.ok) {
    throw new Error('Failed to fetch logs');
  }

  return response.json();
}

export async function promoteUserToAdmin(userId) {
  const response = await fetch(`${API_BASE_URL}/admin/users/${userId}/promote`, {
    method: 'POST',
    headers: getAuthHeader()
  });

  if (!response.ok) {
    throw new Error('Failed to promote user');
  }

  return response.json();
}

export async function demoteAdminToUser(userId) {
  const response = await fetch(`${API_BASE_URL}/admin/users/${userId}/demote`, {
    method: 'POST',
    headers: getAuthHeader()
  });

  if (!response.ok) {
    throw new Error('Failed to demote user');
  }

  return response.json();
}

export async function deleteUser(userId) {
  const response = await fetch(`${API_BASE_URL}/admin/users/${userId}`, {
    method: 'DELETE',
    headers: getAuthHeader()
  });

  if (!response.ok) {
    throw new Error('Failed to delete user');
  }

  return response.json();
}

// ──────────────────────────────────────
// UPLOADS
// ──────────────────────────────────────

export function getDepositProofUrl(filename) {
  return `${API_BASE_URL.replace('/api', '')}/uploads/${filename}`;
}
