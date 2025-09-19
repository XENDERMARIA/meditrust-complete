require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

// Get private key from environment
const PRIVATE_KEY = process.env.PRIVATE_KEY || "";

module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  
  networks: {
    // Local development
    hardhat: {
      chainId: 31337
    },
    
    localhost: {
      url: "http://127.0.0.1:8545"
    },
    
    // Polygon networks
    polygon: {
      url: process.env.POLYGON_RPC || "https://polygon-rpc.com",
      chainId: 137,
      accounts: [PRIVATE_KEY],
      gasPrice: 50000000000
    },
    
    polygonMumbai: {
      url: process.env.POLYGON_MUMBAI_RPC || "https://rpc-amoy.polygon.technology",
      chainId: 80002,
      accounts: [PRIVATE_KEY],
      gasPrice: 30000000000
    },
    
    // Base networks
    base: {
      url: process.env.BASE_RPC || "https://mainnet.base.org",
      chainId: 8453,
      accounts: [PRIVATE_KEY],
      gasPrice: 1000000000
    },
    
    baseSepolia: {
      url: process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org",
      chainId: 84532,
      accounts: [PRIVATE_KEY],
      gasPrice: 1000000000
    },
    
    // Arbitrum networks
    arbitrum: {
      url: process.env.ARBITRUM_RPC || "https://arb1.arbitrum.io/rpc",
      chainId: 42161,
      accounts: [PRIVATE_KEY],
      gasPrice: 100000000
    },
    
    arbitrumSepolia: {
      url: process.env.ARBITRUM_SEPOLIA_RPC || "https://sepolia-rollup.arbitrum.io/rpc",
      chainId: 421614,
      accounts: [PRIVATE_KEY],
      gasPrice: 100000000
    }
  },
  
  etherscan: {
    apiKey: {
      polygon: process.env.POLYGONSCAN_API_KEY || "",
      polygonMumbai: process.env.POLYGONSCAN_API_KEY || "",
      base: process.env.BASESCAN_API_KEY || "",
      baseSepolia: process.env.BASESCAN_API_KEY || "",
      arbitrum: process.env.ARBISCAN_API_KEY || "",
      arbitrumSepolia: process.env.ARBISCAN_API_KEY || ""
    }
  },
  
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  }
};
