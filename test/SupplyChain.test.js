// test/SupplyChain.test.js
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MediTrust Supply Chain System", function () {
  let MediToken, mediToken;
  let MedicineRegistry, medicineRegistry;
  let owner, manufacturer, transporter, supplier, distributor, customer, unauthorized;
  
  const ROLES = {
    TRANSPORTER: 1,
    SUPPLIER: 2,
    DISTRIBUTOR: 3,
    WHOLESALER: 4,
    RETAILER: 5
  };

  beforeEach(async function () {
    // Get signers
    [owner, manufacturer, transporter, supplier, distributor, customer, unauthorized] = 
      await ethers.getSigners();

    // Deploy MediToken
    MediToken = await ethers.getContractFactory("MediToken");
    mediToken = await MediToken.deploy();
    await mediToken.deployed();

    // Deploy MedicineRegistry
    MedicineRegistry = await ethers.getContractFactory("MedicineRegistry");
    medicineRegistry = await MedicineRegistry.deploy(mediToken.address);
    await medicineRegistry.deployed();

    // Setup roles
    await mediToken.addMinter(medicineRegistry.address);
    const MANUFACTURER_ROLE = await medicineRegistry.MANUFACTURER_ROLE();
    await medicineRegistry.grantRole(MANUFACTURER_ROLE, manufacturer.address);
  });

  describe("Supply Chain Registration", function () {
    it("Should register batch with multiple participants", async function () {
      const batchId = "TEST-001";
      const expiryDate = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
      
      const participants = [transporter.address, supplier.address, distributor.address];
      const roles = [ROLES.TRANSPORTER, ROLES.SUPPLIER, ROLES.DISTRIBUTOR];
      const locations = ["Mumbai", "Delhi", "Bangalore"];
      
      await medicineRegistry.connect(manufacturer).registerBatchWithSupplyChain(
        batchId,
        "Paracetamol",
        "Acetaminophen",
        expiryDate,
        participants,
        roles,
        locations
      );
      
      const status = await medicineRegistry.getBatchStatus(batchId);
      expect(status.exists).to.be.true;
      expect(status.requiredVerifications).to.equal(3);
      expect(status.completedVerifications).to.equal(0);
    });

    it("Should prevent duplicate participants", async function () {
      const batchId = "TEST-002";
      const expiryDate = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
      
      // Same participant twice
      const participants = [transporter.address, transporter.address];
      const roles = [ROLES.TRANSPORTER, ROLES.SUPPLIER];
      const locations = ["Mumbai", "Delhi"];
      
      await expect(
        medicineRegistry.connect(manufacturer).registerBatchWithSupplyChain(
          batchId,
          "Aspirin",
          "ASA",
          expiryDate,
          participants,
          roles,
          locations
        )
      ).to.be.revertedWith("Duplicate participant");
    });

    it("Should enforce maximum participants limit", async function () {
      const batchId = "TEST-003";
      const expiryDate = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
      
      // Create 21 participants (exceeds max of 20)
      const participants = [];
      const roles = [];
      const locations = [];
      
      for (let i = 0; i < 21; i++) {
        const wallet = ethers.Wallet.createRandom();
        participants.push(wallet.address);
        roles.push(ROLES.TRANSPORTER);
        locations.push(`Location ${i}`);
      }
      
      await expect(
        medicineRegistry.connect(manufacturer).registerBatchWithSupplyChain(
          batchId,
          "Medicine",
          "Ingredients",
          expiryDate,
          participants,
          roles,
          locations
        )
      ).to.be.revertedWith("Too many participants");
    });
  });

  describe("Participant Verification", function () {
    let batchId;
    let expiryDate;
    
    beforeEach(async function () {
      batchId = "VERIFY-001";
      expiryDate = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
      
      const participants = [transporter.address, supplier.address, distributor.address];
      const roles = [ROLES.TRANSPORTER, ROLES.SUPPLIER, ROLES.DISTRIBUTOR];
      const locations = ["Location A", "Location B", "Location C"];
      
      await medicineRegistry.connect(manufacturer).registerBatchWithSupplyChain(
        batchId,
        "Test Medicine",
        "Test Ingredients",
        expiryDate,
        participants,
        roles,
        locations
      );
    });

    it("Should allow participant to verify with valid signature", async function () {
      // Generate signature
      const messageHash = ethers.utils.solidityKeccak256(
        ['string', 'address', 'uint256'],
        [batchId, transporter.address, Math.floor(Date.now() / 1000)]
      );
      const signature = await transporter.signMessage(ethers.utils.arrayify(messageHash));
      
      await medicineRegistry.connect(transporter).verifyBatchAsParticipant(
        batchId,
        "Received in good condition",
        signature
      );
      
      const status = await medicineRegistry.getBatchStatus(batchId);
      expect(status.completedVerifications).to.equal(1);
    });

    it("Should prevent unauthorized verification", async function () {
      const messageHash = ethers.utils.solidityKeccak256(
        ['string', 'address', 'uint256'],
        [batchId, unauthorized.address, Math.floor(Date.now() / 1000)]
      );
      const signature = await unauthorized.signMessage(ethers.utils.arrayify(messageHash));
      
      await expect(
        medicineRegistry.connect(unauthorized).verifyBatchAsParticipant(
          batchId,
          "Unauthorized attempt",
          signature
        )
      ).to.be.revertedWith("Not authorized participant");
    });

    it("Should prevent double verification", async function () {
      // First verification
      const messageHash1 = ethers.utils.solidityKeccak256(
        ['string', 'address', 'uint256'],
        [batchId, transporter.address, Math.floor(Date.now() / 1000)]
      );
      const signature1 = await transporter.signMessage(ethers.utils.arrayify(messageHash1));
      
      await medicineRegistry.connect(transporter).verifyBatchAsParticipant(
        batchId,
        "First verification",
        signature1
      );
      
      // Attempt second verification
      const messageHash2 = ethers.utils.solidityKeccak256(
        ['string', 'address', 'uint256'],
        [batchId, transporter.address, Math.floor(Date.now() / 1000)]
      );
      const signature2 = await transporter.signMessage(ethers.utils.arrayify(messageHash2));
      
      await expect(
        medicineRegistry.connect(transporter).verifyBatchAsParticipant(
          batchId,
          "Second verification",
          signature2
        )
      ).to.be.revertedWith("Already verified");
    });

    it("Should mark batch as fully verified after all verifications", async function () {
      // Transporter verification
      const transporterMsg = ethers.utils.solidityKeccak256(
        ['string', 'address', 'uint256'],
        [batchId, transporter.address, Math.floor(Date.now() / 1000)]
      );
      const transporterSig = await transporter.signMessage(ethers.utils.arrayify(transporterMsg));
      await medicineRegistry.connect(transporter).verifyBatchAsParticipant(
        batchId, "Transporter notes", transporterSig
      );
      
      // Supplier verification
      const supplierMsg = ethers.utils.solidityKeccak256(
        ['string', 'address', 'uint256'],
        [batchId, supplier.address, Math.floor(Date.now() / 1000)]
      );
      const supplierSig = await supplier.signMessage(ethers.utils.arrayify(supplierMsg));
      await medicineRegistry.connect(supplier).verifyBatchAsParticipant(
        batchId, "Supplier notes", supplierSig
      );
      
      // Distributor verification
      const distributorMsg = ethers.utils.solidityKeccak256(
        ['string', 'address', 'uint256'],
        [batchId, distributor.address, Math.floor(Date.now() / 1000)]
      );
      const distributorSig = await distributor.signMessage(ethers.utils.arrayify(distributorMsg));
      await medicineRegistry.connect(distributor).verifyBatchAsParticipant(
        batchId, "Distributor notes", distributorSig
      );
      
      const status = await medicineRegistry.getBatchStatus(batchId);
      expect(status.isFullyVerified).to.be.true;
      expect(status.completedVerifications).to.equal(3);
    });
  });

  describe("Customer Reward System", function () {
    let batchId;
    
    beforeEach(async function () {
      batchId = "REWARD-001";
      const expiryDate = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
      
      // Register and fully verify batch
      await medicineRegistry.connect(manufacturer).registerBatchWithSupplyChain(
        batchId,
        "Reward Medicine",
        "Ingredients",
        expiryDate,
        [transporter.address, supplier.address],
        [ROLES.TRANSPORTER, ROLES.SUPPLIER],
        ["Location X", "Location Y"]
      );
      
      // Complete all verifications
      for (const participant of [transporter, supplier]) {
        const msg = ethers.utils.solidityKeccak256(
          ['string', 'address', 'uint256'],
          [batchId, participant.address, Math.floor(Date.now() / 1000)]
        );
        const sig = await participant.signMessage(ethers.utils.arrayify(msg));
        await medicineRegistry.connect(participant).verifyBatchAsParticipant(
          batchId, "Verified", sig
        );
      }
    });

    it("Should allow customer to claim reward after full verification", async function () {
      const initialBalance = await mediToken.balanceOf(customer.address);
      
      await medicineRegistry.connect(customer).claimCustomerReward(batchId);
      
      const finalBalance = await mediToken.balanceOf(customer.address);
      const reward = finalBalance.sub(initialBalance);
      
      expect(reward).to.equal(ethers.utils.parseEther("1")); // 1 MEDI token
      
      const status = await medicineRegistry.getBatchStatus(batchId);
      expect(status.rewardClaimed).to.be.true;
      expect(status.rewardClaimant).to.equal(customer.address);
    });

    it("Should prevent reward claim before full verification", async function () {
      const incompleteId = "INCOMPLETE-001";
      const expiryDate = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
      
      await medicineRegistry.connect(manufacturer).registerBatchWithSupplyChain(
        incompleteId,
        "Incomplete Medicine",
        "Ingredients",
        expiryDate,
        [transporter.address],
        [ROLES.TRANSPORTER],
        ["Location"]
      );
      
      // Don't verify - try to claim directly
      await expect(
        medicineRegistry.connect(customer).claimCustomerReward(incompleteId)
      ).to.be.revertedWith("Supply chain verification incomplete");
    });

    it("Should prevent duplicate reward claims", async function () {
      // First claim
      await medicineRegistry.connect(customer).claimCustomerReward(batchId);
      
      // Attempt second claim
      await expect(
        medicineRegistry.connect(customer).claimCustomerReward(batchId)
      ).to.be.revertedWith("Reward already claimed");
      
      // Try with different customer
      await expect(
        medicineRegistry.connect(unauthorized).claimCustomerReward(batchId)
      ).to.be.revertedWith("Reward already claimed");
    });

    it("Should prevent reward claim for expired medicine", async function () {
      const expiredId = "EXPIRED-001";
      const pastExpiry = Math.floor(Date.now() / 1000) - 1; // Already expired
      
      await medicineRegistry.connect(manufacturer).registerBatchWithSupplyChain(
        expiredId,
        "Expired Medicine",
        "Ingredients",
        pastExpiry,
        [transporter.address],
        [ROLES.TRANSPORTER],
        ["Location"]
      );
      
      // Verify
      const msg = ethers.utils.solidityKeccak256(
        ['string', 'address', 'uint256'],
        [expiredId, transporter.address, Math.floor(Date.now() / 1000)]
      );
      const sig = await transporter.signMessage(ethers.utils.arrayify(msg));
      await medicineRegistry.connect(transporter).verifyBatchAsParticipant(
        expiredId, "Verified", sig
      );
      
      // Try to claim reward
      await expect(
        medicineRegistry.connect(customer).claimCustomerReward(expiredId)
      ).to.be.revertedWith("Medicine expired");
    });
  });

  describe("View Functions", function () {
    let batchId;
    
    beforeEach(async function () {
      batchId = "VIEW-001";
      const expiryDate = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
      
      await medicineRegistry.connect(manufacturer).registerBatchWithSupplyChain(
        batchId,
        "View Medicine",
        "Ingredients",
        expiryDate,
        [transporter.address, supplier.address],
        [ROLES.TRANSPORTER, ROLES.SUPPLIER],
        ["Mumbai", "Delhi"]
      );
    });

    it("Should return supply chain participants", async function () {
      const result = await medicineRegistry.getSupplyChainParticipants(batchId);
      
      expect(result.participants).to.have.lengthOf(2);
      expect(result.participants[0]).to.equal(transporter.address);
      expect(result.participants[1]).to.equal(supplier.address);
      expect(result.roles[0]).to.equal(ROLES.TRANSPORTER);
      expect(result.roles[1]).to.equal(ROLES.SUPPLIER);
    });

    it("Should check if participant can verify", async function () {
      // Authorized participant
      const [canVerify, alreadyVerified] = await medicineRegistry.canVerifyBatch(
        batchId, 
        transporter.address
      );
      expect(canVerify).to.be.true;
      expect(alreadyVerified).to.be.false;
      
      // Unauthorized participant
      const [canVerifyUnauth, alreadyVerifiedUnauth] = await medicineRegistry.canVerifyBatch(
        batchId, 
        unauthorized.address
      );
      expect(canVerifyUnauth).to.be.false;
      expect(alreadyVerifiedUnauth).to.be.false;
    });

    it("Should return verification history", async function () {
      // Perform verification
      const msg = ethers.utils.solidityKeccak256(
        ['string', 'address', 'uint256'],
        [batchId, transporter.address, Math.floor(Date.now() / 1000)]
      );
      const sig = await transporter.signMessage(ethers.utils.arrayify(msg));
      await medicineRegistry.connect(transporter).verifyBatchAsParticipant(
        batchId, "Temperature: 25C", sig
      );
      
      const history = await medicineRegistry.getVerificationHistory(batchId);
      
      expect(history.verifiers).to.have.lengthOf(1);
      expect(history.verifiers[0]).to.equal(transporter.address);
      expect(history.notes[0]).to.equal("Temperature: 25C");
      expect(history.locations[0]).to.equal("Mumbai");
    });
  });

  describe("Gas Optimization Tests", function () {
    it("Should measure gas for different participant counts", async function () {
      const gasUsage = [];
      
      for (let participantCount of [1, 3, 5, 10]) {
        const batchId = `GAS-${participantCount}`;
        const expiryDate = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
        
        const participants = [];
        const roles = [];
        const locations = [];
        
        for (let i = 0; i < participantCount; i++) {
          const wallet = ethers.Wallet.createRandom();
          participants.push(wallet.address);
          roles.push(ROLES.TRANSPORTER);
          locations.push(`Location ${i}`);
        }
        
        const tx = await medicineRegistry.connect(manufacturer).registerBatchWithSupplyChain(
          batchId,
          "Gas Test Medicine",
          "Ingredients",
          expiryDate,
          participants,
          roles,
          locations
        );
        
        const receipt = await tx.wait();
        gasUsage.push({
          participants: participantCount,
          gasUsed: receipt.gasUsed.toString()
        });
      }
      
      console.log("\n⛽ Gas Usage by Participant Count:");
      gasUsage.forEach(({ participants, gasUsed }) => {
        console.log(`   ${participants} participants: ${gasUsed} gas`);
      });
    });
  });
});