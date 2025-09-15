const axios = require('axios');

async function testMediTrust() {
  const API_URL = 'http://localhost:5000';
  const CHAIN_KEY = 'polygon'; // or any chain you want to test
  
  try {
    console.log('🏥 Testing MediTrust Backend...\n');
    
    // Test 1: Health Check
    console.log('1️⃣ Checking system health...');
    const health = await axios.get(`${API_URL}/health`);
    console.log('✅ System Status:', health.data);
    
    // Test 2: Register Batch (with chain key)
    console.log('\n2️⃣ Registering medicine batch...');
    const registerResponse = await axios.post(`${API_URL}/api/register/${CHAIN_KEY}`, {
      batchId: 'TEST-001',
      drugName: 'Aspirin',
      ingredients: 'Acetylsalicylic acid',
      expiryDate: '2025-12-31'
    });
    console.log('✅ Batch registered:', registerResponse.data);
    
    // Test 3: Verify Batch (with chain key)
    console.log('\n3️⃣ Verifying batch...');
    const verifyResponse = await axios.post(`${API_URL}/api/verify/${CHAIN_KEY}`, {
      batchId: 'TEST-001',
      scanner: '0x1234567890123456789012345678901234567890'
    });
    console.log('✅ Verification result:', verifyResponse.data);
    
    // Test 4: Get Sessions
    console.log('\n4️⃣ Getting active sessions...');
    const sessions = await axios.get(`${API_URL}/api/sessions`);
    console.log('✅ Active sessions:', sessions.data);
    
    // Test 5: Get Available Chains
    console.log('\n5️⃣ Getting available chains...');
    const chains = await axios.get(`${API_URL}/api/chains`);
    console.log('✅ Available chains:', chains.data);
    
    console.log('\n🎉 All tests passed!');
  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }
}

// Run the test
testMediTrust();