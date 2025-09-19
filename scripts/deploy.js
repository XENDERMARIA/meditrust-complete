// scripts/deploy.js
// Complete deployment script for MediTrust Supply Chain System

const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

// Network configurations
const NETWORKS = {
  polygon: {
    name: "Polygon",
    symbol: "MATIC",
    rpc: "https://polygon-rpc.com",
    chainId: 137,
    gasPrice: 50000000000
  },
  polygonAmoy: {
    name: "Polygon Amoy Testnet",
    symbol: "MATIC",
    rpc: "https://rpc-amoy.polygon.technology",
    chainId: 80002,
    gasPrice: 30000000000
  },
  base: {
    name: "Base",
    symbol: "ETH",
    rpc: "https://mainnet.base.org",
    chainId: 8453,
    gasPrice: 1000000000
  },
  baseSepolia: {
    name: "Base Sepolia Testnet",
    symbol: "ETH",
    rpc: "https://sepolia.base.org",
    chainId: 84532,
    gasPrice: 1000000000
  },
  arbitrum: {
    name: "Arbitrum One",
    symbol: "ETH",
    rpc: "https://arb1.arbitrum.io/rpc",
    chainId: 42161,
    gasPrice: 100000000
  },
  arbitrumSepolia: {
    name: "Arbitrum Sepolia",
    symbol: "ETH",
    rpc: "https://sepolia-rollup.arbitrum.io/rpc",
    chainId: 421614,
    gasPrice: 100000000
  },
  localhost: {
    name: "Localhost",
    symbol: "ETH",
    rpc: "http://127.0.0.1:8545",
    chainId: 31337,
    gasPrice: 0
  }
};

async function saveABIs() {
  console.log("\n📁 Saving ABIs...");
  
  const abiDir = path.join(__dirname, "../abi");
  if (!fs.existsSync(abiDir)) {
    fs.mkdirSync(abiDir, { recursive: true });
  }
  
  const MediToken = await hre.artifacts.readArtifact("MediToken");
  const MedicineRegistry = await hre.artifacts.readArtifact("MedicineRegistry");
  
  fs.writeFileSync(
    path.join(abiDir, "MediToken.json"),
    JSON.stringify(MediToken.abi, null, 2)
  );
  
  fs.writeFileSync(
    path.join(abiDir, "MedicineRegistry.json"),
    JSON.stringify(MedicineRegistry.abi, null, 2)
  );
  
  console.log("✅ ABIs saved to /abi directory");
}

async function main() {
  const network = process.env.NETWORK || hre.network.name || "localhost";
  const networkConfig = NETWORKS[network] || NETWORKS.localhost;
  
  console.log("\n========================================");
  console.log("🚀 MediTrust Supply Chain Deployment");
  console.log("========================================");
  console.log(`📍 Network: ${networkConfig.name}`);
  console.log(`🔗 Chain ID: ${networkConfig.chainId}`);
  console.log("========================================\n");
  
  // Get deployer account
  const [deployer, participant1, participant2, participant3] = await hre.ethers.getSigners();
  console.log("👤 Deployer Address:", deployer.address);
  
  // Check balance
  const balance = await deployer.getBalance();
  console.log("💰 Deployer Balance:", hre.ethers.utils.formatEther(balance), networkConfig.symbol);
  
  if (balance.eq(0)) {
    console.error("\n❌ Deployer has no balance!");
    console.log("💡 Get testnet tokens from:");
    console.log("   Polygon Amoy: https://faucet.polygon.technology/");
    console.log("   Base Sepolia: https://www.alchemy.com/faucets/base-sepolia");
    console.log("   Arbitrum Sepolia: https://faucet.quicknode.com/arbitrum/sepolia");
    process.exit(1);
  }
  
  // Deploy MediToken
  console.log("\n📦 Deploying MediToken...");
  const MediToken = await hre.ethers.getContractFactory("MediToken");
  const mediToken = await MediToken.deploy();
  await mediToken.deployed();
  console.log("✅ MediToken deployed to:", mediToken.address);
  console.log("   Transaction hash:", mediToken.deployTransaction.hash);
  
  // Deploy MedicineRegistry
  console.log("\n📦 Deploying MedicineRegistry...");
  const MedicineRegistry = await hre.ethers.getContractFactory("MedicineRegistry");
  const medicineRegistry = await MedicineRegistry.deploy(mediToken.address);
  await medicineRegistry.deployed();
  console.log("✅ MedicineRegistry deployed to:", medicineRegistry.address);
  console.log("   Transaction hash:", medicineRegistry.deployTransaction.hash);
  
  // Setup permissions
  console.log("\n🔐 Setting up permissions...");
  
  // Add registry as minter
  console.log("   Adding MedicineRegistry as MediToken minter...");
  const addMinterTx = await mediToken.addMinter(medicineRegistry.address);
  await addMinterTx.wait();
  console.log("   ✅ Minter role granted");
  
  // Grant manufacturer role to deployer for testing
  console.log("   Granting manufacturer role to deployer...");
  const MANUFACTURER_ROLE = await medicineRegistry.MANUFACTURER_ROLE();
  const grantRoleTx = await medicineRegistry.grantRole(MANUFACTURER_ROLE, deployer.address);
  await grantRoleTx.wait();
  console.log("   ✅ Manufacturer role granted");
  
  // Register test batch with supply chain
  console.log("\n🧪 Creating test batch with supply chain...");
  const testBatchId = `TEST-${network}-${Date.now()}`;
  const expiryDate = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60; // 1 year from now
  
  // Use available test accounts as supply chain participants
  const supplyChainParticipants = network === 'localhost' && participant1 
    ? [participant1.address, participant2.address, participant3.address]
    : [
        "0x1234567890123456789012345678901234567890",
        "0x2345678901234567890123456789012345678901",
        "0x3456789012345678901234567890123456789012"
      ];
  
  const supplyChainRoles = [1, 2, 3]; // TRANSPORTER, SUPPLIER, DISTRIBUTOR
  
  const registerTx = await medicineRegistry.registerBatchWithSupplyChain(
    testBatchId,
    "Test Medicine",
    "Test Ingredients",
    expiryDate,
    supplyChainParticipants,
    supplyChainRoles,
    hre.ethers.utils.formatBytes32String("test-channel")
  );
  
  const registerReceipt = await registerTx.wait();
  console.log(`   ✅ Test batch registered: ${testBatchId}`);
  console.log(`   📦 Supply chain participants: ${supplyChainParticipants.length}`);
  console.log(`   ⛽ Gas used: ${registerReceipt.gasUsed.toString()}`);
  
  // If localhost, perform test verifications
  if (network === 'localhost' && participant1) {
    console.log("\n🔍 Testing supply chain verification...");
    
    // Transporter verification
    const verifyTx1 = await medicineRegistry.connect(participant1).verifySupplyChainTransfer(
      testBatchId,
      "Test Location 1",
      "Temperature: 5°C"
    );
    await verifyTx1.wait();
    console.log("   ✅ Transporter verified");
    
    // Supplier verification
    const verifyTx2 = await medicineRegistry.connect(participant2).verifySupplyChainTransfer(
      testBatchId,
      "Test Location 2",
      "Condition: Good"
    );
    await verifyTx2.wait();
    console.log("   ✅ Supplier verified");
    
    // Distributor verification
    const verifyTx3 = await medicineRegistry.connect(participant3).verifySupplyChainTransfer(
      testBatchId,
      "Test Location 3",
      "Ready for delivery"
    );
    await verifyTx3.wait();
    console.log("   ✅ Distributor verified");
    
    // Check if ready for customer
    const isReady = await medicineRegistry.isBatchReadyForCustomer(testBatchId);
    console.log(`   📍 Ready for customer claim: ${isReady}`);
  }
  
  // Calculate deployment cost
  const deploymentCost = registerReceipt.gasUsed.mul(registerReceipt.effectiveGasPrice);
  
  // Save deployment information
  console.log("\n💾 Saving deployment information...");
  
  const deployment = {
    network: network,
    chainId: networkConfig.chainId,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      MediToken: {
        address: mediToken.address,
        transactionHash: mediToken.deployTransaction.hash,
        blockNumber: mediToken.deployTransaction.blockNumber
      },
      MedicineRegistry: {
        address: medicineRegistry.address,
        transactionHash: medicineRegistry.deployTransaction.hash,
        blockNumber: medicineRegistry.deployTransaction.blockNumber
      }
    },
    testBatch: {
      batchId: testBatchId,
      participants: supplyChainParticipants,
      roles: supplyChainRoles,
      transactionHash: registerTx.hash,
      gasUsed: registerReceipt.gasUsed.toString()
    },
    deploymentCost: hre.ethers.utils.formatEther(deploymentCost),
    supplyChainFeatures: {
      multiParticipantTracking: true,
      roleBasedVerification: true,
      customerRewardSystem: true,
      stateChannelSupport: true
    }
  };
  
  // Save deployment file
  const deploymentsDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }
  
  const deploymentFile = path.join(deploymentsDir, `${network}.json`);
  fs.writeFileSync(deploymentFile, JSON.stringify(deployment, null, 2));
  console.log(`✅ Deployment info saved to: deployments/${network}.json`);
  
  // Save ABIs
  await saveABIs();
  
  // Generate environment variables
  const envFile = path.join(__dirname, "../.env.example");
  const envContent = `# ${networkConfig.name} Deployment - ${new Date().toISOString()}
# MediTrust Supply Chain System

# Private Key (keep secret!)
PRIVATE_KEY=your_private_key_here

# Contract Addresses - ${networkConfig.name}
${network.toUpperCase()}_REGISTRY=${medicineRegistry.address}
${network.toUpperCase()}_TOKEN=${mediToken.address}

# RPC URLs
${network.toUpperCase()}_RPC=${networkConfig.rpc}

# ClearNode WebSocket
CLEARNODE_URL=wss://clearnet.yellow.com/ws

# Test Supply Chain Participants (for testing)
TEST_TRANSPORTER=${supplyChainParticipants[0]}
TEST_SUPPLIER=${supplyChainParticipants[1]}
TEST_DISTRIBUTOR=${supplyChainParticipants[2]}

# API Keys (optional)
POLYGONSCAN_API_KEY=
BASESCAN_API_KEY=
ARBISCAN_API_KEY=
`;
  
  fs.writeFileSync(envFile, envContent);
  console.log("\n📋 Environment variables saved to: .env.example");
  
  // Print summary
  console.log("\n========================================");
  console.log("✨ DEPLOYMENT COMPLETE!");
  console.log("========================================");
  console.log("\n📊 Summary:");
  console.log(`   Network: ${networkConfig.name}`);
  console.log(`   MediToken: ${mediToken.address}`);
  console.log(`   MedicineRegistry: ${medicineRegistry.address}`);
  console.log(`   Test Batch: ${testBatchId}`);
  console.log(`   Supply Chain Participants: ${supplyChainParticipants.length}`);
  console.log(`   Total Cost: ${hre.ethers.utils.formatEther(deploymentCost)} ${networkConfig.symbol}`);
  
  console.log("\n🎯 New Features Deployed:");
  console.log("   ✅ Multi-participant supply chain tracking");
  console.log("   ✅ Role-based verification system");
  console.log("   ✅ Customer reward mechanism");
  console.log("   ✅ QR code tamper-proof claiming");
  console.log("   ✅ State channel batch processing");
  
  console.log("\n📗 Next Steps:");
  console.log("   1. Copy addresses from .env.example to your .env file");
  console.log("   2. Update multichain-backend-real.js with the contract addresses");
  console.log("   3. Run: npm start");
  console.log("   4. Test supply chain flow with different wallets");
  
  console.log("\n🔗 View on Explorer:");
  if (network === "polygonAmoy") {
    console.log(`   https://amoy.polygonscan.com/address/${medicineRegistry.address}`);
  } else if (network === "baseSepolia") {
    console.log(`   https://sepolia.basescan.org/address/${medicineRegistry.address}`);
  } else if (network === "arbitrumSepolia") {
    console.log(`   https://sepolia.arbiscan.io/address/${medicineRegistry.address}`);
  }
  
  console.log("\n🎉 Supply Chain System Ready!");
}

// Execute deployment
main()
  .then(() => {
    console.log("\n✅ Script executed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Deployment failed!");
    console.error("Error:", error.message);
    console.error("Stack:", error.stack);
    process.exit(1);
  });
