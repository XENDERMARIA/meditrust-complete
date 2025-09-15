// utils/crypto.js
// Cryptographic utilities for supply chain verification

const ethers = require('ethers');
const crypto = require('crypto');

/**
 * Generate a unique batch ID
 */
function generateBatchId(prefix = 'BATCH') {
  const timestamp = Date.now();
  const random = crypto.randomBytes(4).toString('hex');
  return `${prefix}-${timestamp}-${random}`.toUpperCase();
}

/**
 * Generate a signature for participant verification
 */
async function generateVerificationSignature(batchId, participantAddress, privateKey) {
  // Create message hash
  const timestamp = Math.floor(Date.now() / 1000);
  const messageHash = ethers.utils.solidityKeccak256(
    ['string', 'address', 'uint256'],
    [batchId, participantAddress, timestamp]
  );
  
  // Sign the message
  const wallet = new ethers.Wallet(privateKey);
  const signature = await wallet.signMessage(ethers.utils.arrayify(messageHash));
  
  return {
    signature,
    timestamp,
    messageHash
  };
}

/**
 * Verify a signature
 */
function verifySignature(message, signature, expectedAddress) {
  try {
    const recoveredAddress = ethers.utils.verifyMessage(message, signature);
    return recoveredAddress.toLowerCase() === expectedAddress.toLowerCase();
  } catch (error) {
    return false;
  }
}

/**
 * Hash batch data for integrity verification
 */
function hashBatchData(batchData) {
  const dataString = JSON.stringify(batchData, Object.keys(batchData).sort());
  return ethers.utils.keccak256(ethers.utils.toUtf8Bytes(dataString));
}

/**
 * Generate QR code data with verification hash
 */
function generateQRData(batchId, chainKey, contractAddress) {
  const data = {
    batchId,
    chain: chainKey,
    contract: contractAddress,
    timestamp: Date.now(),
    version: '2.0'
  };
  
  // Add integrity hash
  data.hash = hashBatchData(data);
  
  return JSON.stringify(data);
}

/**
 * Validate QR code data
 */
function validateQRData(qrDataString) {
  try {
    const data = JSON.parse(qrDataString);
    
    // Extract hash and verify
    const { hash, ...dataWithoutHash } = data;
    const expectedHash = hashBatchData(dataWithoutHash);
    
    if (hash !== expectedHash) {
      throw new Error('QR code data integrity check failed');
    }
    
    return {
      valid: true,
      data: dataWithoutHash
    };
  } catch (error) {
    return {
      valid: false,
      error: error.message
    };
  }
}

/**
 * Generate keypair for testing
 */
function generateTestKeypair() {
  const wallet = ethers.Wallet.createRandom();
  return {
    address: wallet.address,
    privateKey: wallet.privateKey,
    mnemonic: wallet.mnemonic.phrase
  };
}

/**
 * Encrypt sensitive data (for future use)
 */
function encryptData(data, password) {
  const algorithm = 'aes-256-gcm';
  const salt = crypto.randomBytes(32);
  const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
  const iv = crypto.randomBytes(16);
  
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  
  let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  return {
    encrypted,
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex')
  };
}

/**
 * Decrypt sensitive data (for future use)
 */
function decryptData(encryptedData, password) {
  const algorithm = 'aes-256-gcm';
  const salt = Buffer.from(encryptedData.salt, 'hex');
  const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
  const iv = Buffer.from(encryptedData.iv, 'hex');
  const authTag = Buffer.from(encryptedData.authTag, 'hex');
  
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return JSON.parse(decrypted);
}

module.exports = {
  generateBatchId,
  generateVerificationSignature,
  verifySignature,
  hashBatchData,
  generateQRData,
  validateQRData,
  generateTestKeypair,
  encryptData,
  decryptData
};