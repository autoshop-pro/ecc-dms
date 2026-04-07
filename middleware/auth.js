const jwt = require('jsonwebtoken');
const { getDb } = require('../database');

const JWT_SECRET = process.env.JWT_SECRET || 'ecc-dms-secret-key-change-in-production';

function generateToken(dealer) {
  return jwt.sign(
    { id: dealer.id, email: dealer.email, is_admin: dealer.is_admin },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const db = getDb();
    const dealer = db.prepare('SELECT id, company_name, contact_name, email, is_admin, is_active FROM dealers WHERE id = ?').get(decoded.id);

    if (!dealer || !dealer.is_active) {
      return res.status(401).json({ error: 'Invalid or inactive account' });
    }

    req.dealer = dealer;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.dealer || !req.dealer.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

module.exports = { generateToken, authenticateToken, requireAdmin, JWT_SECRET };
