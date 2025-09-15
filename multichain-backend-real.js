// MediTrust Backend with Supply Chain Management
// Supports multi-chain deployment and state channels via Nitrolite/ClearNode

const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');
const WebSocket = require('ws');
const QRCode = require('qrcode');
require('dotenv').config();

// ==================== CONFIGURATION ====================
const PRIVATE_KEY = process.env.PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const CLEARNODE_URL = process.env.CLEARNODE_URL || 'wss://clearnet.yellow.com/ws';

// Multi-chain configuration
const CHAINS = {
  localhost: {
    name: 'Local Hardhat',
    rpc: 'http://127.0.0.1:8545',
    chainId: 31337,
    contracts: {
      token: process.env.LOCALHOST_TOKEN || '0x5FbDB2315678afecb367f032d93F642f64180aa3',
      registry: process.env.LOCALHOST_REGISTRY || '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512'
    }
  },
  polygon: {
    name: 'Polygon',
    rpc: 'https://polygon-rpc.com',
    chainId: 137,
    contracts: {
      token: process.env.POLYGON_TOKEN || '0x0000000000000000000000000000000000000000',
      registry: process.env.POLYGON_REGISTRY || '0x0000000000000000000000000000000000000000'
    }
  },
  base: {
    name: 'Base',
    rpc: 'https://mainnet.base.org',
    chainId: 8453,
    contracts: {
      token: process.env.BASE_TOKEN || '0x0000000000000000000000000000000000000000',
      registry: process.env.BASE_REGISTRY || '0x0000000000000000000000000000000000000000'
    }
  },
  arbitrum: {
    name: 'Arbitrum',
    rpc: 'https://arb1.arbitrum.io/rpc',
    chainId: 42161,
    contracts: {
      token: process.env.ARBITRUM_TOKEN || '0x0000000000000000000000000000000000000000',
      registry: process.env.ARBITRUM_REGISTRY || '0x0000000000000000000000000000000000000000'
    }
  }
};

// Supply chain role enum (matching contract)
const SupplyChainRoles = {
  NONE: 0,
  TRANSPORTER: 1,
  SUPPLIER: 2,
  DISTRIBUTOR: 3,
  WHOLESALER: 4,
  RETAILER: 5
};

// Contract ABIs (simplified - include full ABI in production)
const REGISTRY_ABI = [
  "function registerBatchWithSupplyChain(string _batchId, string _drugName, string _ingredients, uint256 _expiryDate, address[] _participants, uint8[] _roles, bytes32 _channelId)",
  "function verifySupplyChainTransfer(string _batchId, string _location, string _additionalData)",
  "function claimCustomerReward(string _batchId)",
  "function isBatchReadyForCustomer(string _batchId) view returns (bool)",
  "function getBatchSupplyChainStatus(string _batchId) view returns (uint256, uint256, bool, address)",
  "function getParticipantDetails(string _batchId, address _participant) view returns (uint8, bool, uint256, string, string)",
  "function getBatchParticipants(string _batchId) view returns (address[])",
  "function isParticipant(string _batchId, address _address) view returns (bool)",
  "function getBatch(string _batchId) view returns (address, string, string, uint256, uint256, bool)",
  "event BatchRegistered(string indexed batchId, address indexed manufacturer, bytes32 indexed channelId, uint256 timestamp, uint256 participantCount)",
  "event SupplyChainVerification(string indexed batchId, address indexed verifier, uint8 role, uint256 timestamp, string location)",
  "event CustomerRewardClaimed(string indexed batchId, address indexed customer, uint256 reward, uint256 timestamp)"
];

const TOKEN_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)"
];

// ==================== STATE CHANNEL MANAGER ====================
class StateChannelManager {
  constructor() {
    this.channels = new Map();
    this.providers = new Map();
    this.contracts = new Map();
    this.wallets = new Map();
    this.isConnected = false;
    
    this.initializeProviders();
  }

  initializeProviders() {
    for (const [chainKey, chainConfig] of Object.entries(CHAINS)) {
      try {
        const provider = new ethers.providers.JsonRpcProvider(chainConfig.rpc);
        const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
        
        this.providers.set(chainKey, provider);
        this.wallets.set(chainKey, wallet);
        
        // Initialize contracts
        if (chainConfig.contracts.registry !== '0x0000000000000000000000000000000000000000') {
          const registry = new ethers.Contract(
            chainConfig.contracts.registry,
            REGISTRY_ABI,
            wallet
          );
          this.contracts.set(`${chainKey}_registry`, registry);
        }
        
        console.log(`✅ Initialized ${chainConfig.name}`);
      } catch (error) {
        console.error(`❌ Failed to initialize ${chainConfig.name}:`, error.message);
      }
    }
  }

  async createChannel(chainKey) {
    const channelId = ethers.utils.id(Date.now().toString());
    
    this.channels.set(channelId, {
      id: channelId,
      chainKey: chainKey,
      status: 'open',
      state: {
        batches: [],
        verifications: [],
        supplyChainUpdates: []
      },
      nonce: 0,
      createdAt: Date.now(),
      settlementTx: null
    });
    
    return channelId;
  }

  async addBatchToChannel(channelId, batchData) {
    const channel = this.channels.get(channelId);
    if (!channel) throw new Error('Channel not found');
    
    channel.state.batches.push({
      ...batchData,
      timestamp: Date.now()
    });
    
    channel.nonce++;
    
    // Auto-settle after 10 batches
    if (channel.state.batches.length >= 10) {
      await this.closeAndSettleChannel(channelId);
    }
    
    return channel;
  }

  async closeAndSettleChannel(channelId) {
    const channel = this.channels.get(channelId);
    if (!channel) throw new Error('Channel not found');
    
    channel.status = 'settling';
    
    try {
      const registry = this.contracts.get(`${channel.chainKey}_registry`);
      if (!registry) throw new Error('Registry contract not found');
      
      // Prepare batch data for settlement
      const batchesData = channel.state.batches.map(batch => ({
        batchId: batch.batchId,
        drugName: batch.drugName,
        ingredients: batch.ingredients,
        expiryDate: Math.floor(new Date(batch.expiryDate).getTime() / 1000),
        supplyChainAddresses: batch.participants || [],
        supplyChainRoles: batch.roles || []
      }));
      
      // Create signature (simplified - use proper signing in production)
      const messageHash = ethers.utils.solidityKeccak256(
        ['bytes32', 'uint256'],
        [channelId, channel.nonce]
      );
      const signature = await this.wallets.get(channel.chainKey).signMessage(
        ethers.utils.arrayify(messageHash)
      );
      
      // Submit to blockchain
      const tx = await registry.settleChannel(channelId, batchesData, signature);
      await tx.wait();
      
      channel.status = 'settled';
      channel.settlementTx = tx.hash;
      
      return {
        channelId,
        settlementTx: tx.hash,
        batchCount: batchesData.length
      };
    } catch (error) {
      channel.status = 'failed';
      throw error;
    }
  }
}

// ==================== CLEARNODE CONNECTION ====================
class ClearNodeConnection {
  constructor(manager) {
    this.manager = manager;
    this.ws = null;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.manager.ws = new WebSocket(CLEARNODE_URL);
      
      this.manager.ws.on('open', () => {
        console.log('✅ Connected to ClearNode');
        this.manager.isConnected = true;
        resolve();
      });
      
      this.manager.ws.on('message', async (data) => {
        await this.handleMessage(data);
      });
      
      this.manager.ws.on('error', (err) => {
        console.error('❌ ClearNode error:', err.message);
      });
      
      this.manager.ws.on('close', () => {
        console.log('📌 ClearNode disconnected');
        this.manager.isConnected = false;
        setTimeout(() => this.connect(), 5000);
      });
    });
  }

  async handleMessage(data) {
    try {
      const msg = JSON.parse(data.toString());
      
      if (msg.method === 'channel_updated') {
        console.log('📝 Channel state updated');
      }
      
      if (msg.method === 'channel_closed') {
        console.log('🔒 Channel closed, triggering settlement');
        const channelId = msg.params?.channelId;
        if (channelId && this.manager.channels.has(channelId)) {
          await this.manager.closeAndSettleChannel(channelId);
        }
      }
    } catch (err) {
      // Ignore non-JSON messages
    }
  }
}

// ==================== EXPRESS SERVER ====================
const app = express();
app.use(cors());
app.use(express.json());

const manager = new StateChannelManager();
const clearNode = new ClearNodeConnection(manager);

// ==================== API ENDPOINTS ====================

// Health check
app.get('/health', (req, res) => {
  const chainStatuses = {};
  
  for (const [chainKey, chainConfig] of Object.entries(CHAINS)) {
    const hasContracts = chainConfig.contracts.registry !== '0x0000000000000000000000000000000000000000';
    const provider = manager.providers.get(chainKey);
    
    chainStatuses[chainKey] = {
      connected: provider ? true : false,
      contractsDeployed: hasContracts,
      status: hasContracts ? 'ready' : 'contracts-not-deployed'
    };
  }
  
  res.json({
    status: 'healthy',
    clearNode: manager.isConnected ? 'connected' : 'disconnected',
    chains: chainStatuses,
    activeChannels: manager.channels.size,
    timestamp: new Date().toISOString()
  });
});

// Get available chains
app.get('/api/chains', (req, res) => {
  const chains = Object.entries(CHAINS).map(([key, config]) => ({
    key,
    name: config.name,
    chainId: config.chainId,
    hasContracts: config.contracts.registry !== '0x0000000000000000000000000000000000000000'
  }));
  
  res.json(chains);
});

// Register batch with supply chain participants
app.post('/api/register/:chainKey', async (req, res) => {
  try {
    const { chainKey } = req.params;
    const { 
      batchId, 
      drugName, 
      ingredients, 
      expiryDate,
      participants,  // Array of participant objects: [{address, role}]
      useStateChannel = true 
    } = req.body;
    
    if (!CHAINS[chainKey]) {
      return res.status(400).json({ error: 'Invalid chain' });
    }
    
    // Validate participants
    if (!participants || !Array.isArray(participants) || participants.length === 0) {
      return res.status(400).json({ error: 'At least one supply chain participant required' });
    }
    
    // Prepare participant data
    const participantAddresses = participants.map(p => p.address);
    const participantRoles = participants.map(p => SupplyChainRoles[p.role] || 0);
    
    // Generate QR code data
    const qrData = {
      batchId,
      chain: chainKey,
      contractAddress: CHAINS[chainKey].contracts.registry,
      participants: participantAddresses
    };
    
    const qrCode = await QRCode.toDataURL(JSON.stringify(qrData));
    
    if (useStateChannel && CHAINS[chainKey].contracts.registry !== '0x0000000000000000000000000000000000000000') {
      // Use state channel for batch registration
      let channelId = null;
      
      // Find or create channel
      for (const [id, channel] of manager.channels) {
        if (channel.chainKey === chainKey && channel.status === 'open') {
          channelId = id;
          break;
        }
      }
      
      if (!channelId) {
        channelId = await manager.createChannel(chainKey);
      }
      
      // Add batch to channel
      await manager.addBatchToChannel(channelId, {
        batchId,
        drugName,
        ingredients,
        expiryDate,
        participants: participantAddresses,
        roles: participantRoles
      });
      
      res.json({
        success: true,
        message: 'Batch added to state channel',
        batchId,
        channelId,
        qrCode,
        chain: CHAINS[chainKey].name,
        participants: participants.length,
        status: 'pending_settlement'
      });
    } else {
      // Direct on-chain registration
      const registry = manager.contracts.get(`${chainKey}_registry`);
      if (!registry) {
        return res.status(400).json({ error: 'Registry contract not deployed on this chain' });
      }
      
      const channelId = ethers.utils.formatBytes32String('direct');
      const tx = await registry.registerBatchWithSupplyChain(
        batchId,
        drugName,
        ingredients,
        Math.floor(new Date(expiryDate).getTime() / 1000),
        participantAddresses,
        participantRoles,
        channelId
      );
      
      await tx.wait();
      
      res.json({
        success: true,
        message: 'Batch registered on-chain',
        batchId,
        transactionHash: tx.hash,
        qrCode,
        chain: CHAINS[chainKey].name,
        participants: participants.length,
        status: 'confirmed'
      });
    }
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Supply chain participant verification
app.post('/api/verify/supply-chain/:chainKey', async (req, res) => {
  try {
    const { chainKey } = req.params;
    const { batchId, verifier, location = '', additionalData = '' } = req.body;
    
    if (!CHAINS[chainKey]) {
      return res.status(400).json({ error: 'Invalid chain' });
    }
    
    const registry = manager.contracts.get(`${chainKey}_registry`);
    if (!registry) {
      return res.status(400).json({ error: 'Registry contract not deployed on this chain' });
    }
    
    // Check if verifier is authorized participant
    const isParticipant = await registry.isParticipant(batchId, verifier);
    if (!isParticipant) {
      return res.status(403).json({ error: 'Not authorized to verify this batch' });
    }
    
    // Get participant details
    const details = await registry.getParticipantDetails(batchId, verifier);
    if (details.hasVerified) {
      return res.status(400).json({ error: 'Already verified this batch' });
    }
    
    // Submit verification
    const tx = await registry.verifySupplyChainTransfer(batchId, location, additionalData);
    await tx.wait();
    
    // Get updated status
    const status = await registry.getBatchSupplyChainStatus(batchId);
    
    res.json({
      success: true,
      message: 'Supply chain verification recorded',
      batchId,
      verifier,
      role: details.role,
      transactionHash: tx.hash,
      progress: `${status[1]}/${status[0]}`, // verifiedCount/totalParticipants
      readyForCustomer: status[1].toString() === status[0].toString()
    });
  } catch (error) {
    console.error('Supply chain verification error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Customer reward claim
app.post('/api/claim/:chainKey', async (req, res) => {
  try {
    const { chainKey } = req.params;
    const { batchId, customer } = req.body;
    
    if (!CHAINS[chainKey]) {
      return res.status(400).json({ error: 'Invalid chain' });
    }
    
    const registry = manager.contracts.get(`${chainKey}_registry`);
    if (!registry) {
      return res.status(400).json({ error: 'Registry contract not deployed on this chain' });
    }
    
    // Check if batch is ready for customer
    const isReady = await registry.isBatchReadyForCustomer(batchId);
    if (!isReady) {
      const status = await registry.getBatchSupplyChainStatus(batchId);
      if (status[2]) {
        return res.status(400).json({ error: 'Rewards already claimed' });
      } else {
        return res.status(400).json({ 
          error: 'Supply chain verification incomplete',
          progress: `${status[1]}/${status[0]}`
        });
      }
    }
    
    // Claim reward
    const tx = await registry.claimCustomerReward(batchId);
    await tx.wait();
    
    res.json({
      success: true,
      message: 'Reward claimed successfully!',
      batchId,
      customer,
      reward: '1 MEDI',
      transactionHash: tx.hash
    });
  } catch (error) {
    console.error('Reward claim error:', error);
    
    // Check if reward already claimed
    if (error.message.includes('Reward already claimed')) {
      return res.status(400).json({ error: 'Rewards already claimed' });
    }
    
    res.status(500).json({ error: error.message });
  }
});

// Get batch details with supply chain status
app.get('/api/batch/:chainKey/:batchId', async (req, res) => {
  try {
    const { chainKey, batchId } = req.params;
    
    if (!CHAINS[chainKey]) {
      return res.status(400).json({ error: 'Invalid chain' });
    }
    
    const registry = manager.contracts.get(`${chainKey}_registry`);
    if (!registry) {
      return res.status(400).json({ error: 'Registry contract not deployed on this chain' });
    }
    
    // Get batch details
    const batch = await registry.getBatch(batchId);
    const status = await registry.getBatchSupplyChainStatus(batchId);
    const participants = await registry.getBatchParticipants(batchId);
    
    // Get participant details
    const participantDetails = [];
    for (const address of participants) {
      const details = await registry.getParticipantDetails(batchId, address);
      participantDetails.push({
        address,
        role: Object.keys(SupplyChainRoles).find(key => SupplyChainRoles[key] === details.role),
        hasVerified: details.hasVerified,
        verifiedAt: details.verifiedAt.toNumber(),
        location: details.location,
        additionalData: details.additionalData
      });
    }
    
    res.json({
      batchId,
      manufacturer: batch[0],
      drugName: batch[1],
      ingredients: batch[2],
      expiryDate: batch[3].toNumber(),
      registeredAt: batch[4].toNumber(),
      rewardClaimed: batch[5],
      supplyChain: {
        totalParticipants: status[0].toNumber(),
        verifiedCount: status[1].toNumber(),
        rewardClaimed: status[2],
        rewardClaimedBy: status[3],
        participants: participantDetails,
        progress: `${status[1]}/${status[0]}`,
        readyForCustomer: status[1].toString() === status[0].toString() && !status[2]
      }
    });
  } catch (error) {
    console.error('Get batch error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get active channels
app.get('/api/channels', (req, res) => {
  const channels = Array.from(manager.channels.entries()).map(([id, data]) => ({
    id,
    chain: CHAINS[data.chainKey]?.name,
    status: data.status,
    batchCount: data.state.batches.length,
    createdAt: data.createdAt,
    settlementTx: data.settlementTx
  }));
  
  res.json(channels);
});

// Manually settle a channel
app.post('/api/channels/:channelId/settle', async (req, res) => {
  try {
    const { channelId } = req.params;
    
    const result = await manager.closeAndSettleChannel(channelId);
    
    res.json({
      success: true,
      message: 'Channel settled on blockchain',
      ...result
    });
  } catch (error) {
    console.error('Settlement error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== START SERVER ====================
async function start() {
  try {
    console.log('🏥 Starting MediTrust Supply Chain Backend...');
    console.log('📜 Checking smart contract deployments...');
    
    // Wait for blockchain connections
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Check which chains have contracts
    let deployedChains = 0;
    for (const [chainKey, config] of Object.entries(CHAINS)) {
      if (config.contracts.registry !== '0x0000000000000000000000000000000000000000') {
        console.log(`✅ ${config.name}: Contracts deployed`);
        deployedChains++;
      } else {
        console.log(`⚠️ ${config.name}: Contracts NOT deployed`);
      }
    }
    
    if (deployedChains === 0) {
      console.log('\n⚠️ WARNING: No smart contracts deployed!');
      console.log('📌 To deploy contracts:');
      console.log('   1. Run: npm run compile');
      console.log('   2. Run: npm run deploy:polygon-testnet');
      console.log('   3. Update contract addresses in this file\n');
    }
    
    // Connect to ClearNode
    console.log('🌐 Connecting to ClearNode...');
    await clearNode.connect().catch(err => {
      console.log('⚠️ ClearNode connection failed, continuing without state channels');
    });
    
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
      console.log(`\n🚀 Supply Chain Backend running on port ${PORT}`);
      console.log('\n📊 Features:');
      console.log('  ✅ Supply chain participant management');
      console.log('  ✅ Multi-step verification workflow');
      console.log('  ✅ Customer reward system');
      console.log('  ✅ State channel batch processing');
      console.log('  ✅ Multi-chain support');
      console.log('\n📗 API Endpoints:');
      console.log('  POST /api/register/:chainKey - Register batch with participants');
      console.log('  POST /api/verify/supply-chain/:chainKey - Supply chain verification');
      console.log('  POST /api/claim/:chainKey - Customer reward claim');
      console.log('  GET  /api/batch/:chainKey/:batchId - Get batch details');
      console.log('  GET  /api/channels - View active channels');
      console.log('  POST /api/channels/:id/settle - Manually settle channel');
    });
  } catch (error) {
    console.error('Failed to start:', error);
    process.exit(1);
  }
}

start();