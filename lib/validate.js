const LIBERIA_COUNTIES = [
  'Bomi', 'Bong', 'Gbarpolu', 'Grand Bassa', 'Grand Cape Mount',
  'Grand Gedeh', 'Grand Kru', 'Lofa', 'Margibi', 'Maryland',
  'Montserrado', 'Nimba', 'River Cess', 'River Gee', 'Sinoe'
];

const GENDERS = ['Male', 'Female', 'Prefer not to say'];

function normalizePhone(raw) {
  const digits = String(raw).replace(/\D/g, '');
  if (digits.startsWith('231')) return digits;
  if (digits.startsWith('0')) return '231' + digits.slice(1);
  if (digits.length === 9) return '231' + digits;
  return digits;
}

function isValidLiberianPhone(raw) {
  return /^231\d{9}$/.test(normalizePhone(raw));
}

function isValidEmail(raw) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(raw || '').trim());
}

function isGoogleDriveLink(raw) {
  return /drive\.google\.com/i.test(String(raw || '').trim());
}

function isValidCounty(raw) {
  return LIBERIA_COUNTIES.map((c) => c.toLowerCase()).includes(String(raw || '').trim().toLowerCase());
}

function isValidGender(raw) {
  return GENDERS.map((g) => g.toLowerCase()).includes(String(raw || '').trim().toLowerCase());
}

function isValidDateOfBirth(raw) {
  if (!raw) return false;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return false;
  const now = new Date();
  const minAge = new Date(now.getFullYear() - 100, now.getMonth(), now.getDate());
  const maxAge = new Date(now.getFullYear() - 10, now.getMonth(), now.getDate());
  return d >= minAge && d <= maxAge;
}

module.exports = {
  normalizePhone,
  isValidLiberianPhone,
  isValidEmail,
  isGoogleDriveLink,
  isValidCounty,
  isValidGender,
  isValidDateOfBirth,
  LIBERIA_COUNTIES,
  GENDERS
};
