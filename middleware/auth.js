const jwt = require('jsonwebtoken');
const { getDb } = require('../database');

const JWT_SECRET = process.env.JWT_SECRET || 'ecc-dms-secret-key-change-in-production';

function generateToken(user, userType) {
  return jwt.sign(
    { id: user.id, email: user.email, is_admin: user.is_admin || false, user_type: userType || 'dealer' },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

// Authenticate dealer tokens (existing behavior)
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const db = getDb();

    // Check user_type to determine which table to query
    if (decoded.user_type === 'client') {
      const client = db.prepare('SELECT id, first_name, last_name, email, phone, is_active, current_dealer_id FROM clients WHERE id = ?').get(decoded.id);
      if (!client || !client.is_active) {
        return res.status(401).json({ error: 'Invalid or inactive client account' });
      }
      req.client = client;
      req.userType = 'client';
      // Also set req.dealer as null so route handlers can check
      req.dealer = null;
      next();
    } else {
      const dealer = db.prepare('SELECT id, company_name, contact_name, email, is_admin, is_active, role, parent_dealer_id, discount_pct FROM dealers WHERE id = ?').get(decoded.id);
      if (!dealer || !dealer.is_active) {
        return res.status(401).json({ error: 'Invalid or inactive account' });
      }
      req.dealer = dealer;
      req.userType = 'dealer';
      req.client = null;
      next();
    }
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}

// Middleware that requires dealer (not client) access
function requireDealer(req, res, next) {
  if (req.userType === 'client') {
    return res.status(403).json({ error: 'Dealer access required' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.dealer || !req.dealer.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

module.exports = { generateToken, authenticateToken, requireDealer, requireAdmin, JWT_SECRET };
