// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

interface IMediToken {
    function mint(address to, uint256 amount) external;
}

/**
 * @title MedicineRegistry
 * @dev Registry for medicine batches with supply chain tracking and state channel support
 */
contract MedicineRegistry is AccessControl, ReentrancyGuard {
    using ECDSA for bytes32;

    bytes32 public constant MANUFACTURER_ROLE = keccak256("MANUFACTURER_ROLE");
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");
    bytes32 public constant CHANNEL_ROLE = keccak256("CHANNEL_ROLE");

    // Supply chain roles
    enum SupplyChainRole {
        NONE,
        TRANSPORTER,
        SUPPLIER,
        DISTRIBUTOR,
        WHOLESALER,
        RETAILER
    }

    struct SupplyChainParticipant {
        address participantAddress;
        SupplyChainRole role;
        bool hasVerified;
        uint256 verifiedAt;
        string location; // Optional: GPS or location data
        string additionalData; // Optional: temperature, handling notes, etc.
    }

    struct MedicineBatch {
        address manufacturer;
        string batchId;
        string drugName;
        string ingredients;
        uint256 expiryDate;
        uint256 registeredAt;
        bytes32 channelId;
        
        // Supply chain tracking
        SupplyChainParticipant[] supplyChainParticipants;
        mapping(address => bool) isParticipant;
        uint256 totalParticipants;
        uint256 verifiedCount;
        
        // Customer reward tracking
        bool rewardClaimed;
        address rewardClaimedBy;
        uint256 rewardClaimedAt;
        
        bool exists;
    }

    struct StateChannel {
        bytes32 id;
        address[] participants;
        uint256 nonce;
        bool isOpen;
        uint256 openedAt;
        uint256 closedAt;
    }

    struct BatchData {
        string batchId;
        string drugName;
        string ingredients;
        uint256 expiryDate;
        address[] supplyChainAddresses;
        SupplyChainRole[] supplyChainRoles;
    }

    // Storage
    mapping(string => MedicineBatch) public batches;
    mapping(bytes32 => StateChannel) public channels;
    mapping(address => uint256) public pendingRewards;
    mapping(address => mapping(string => uint256)) public lastVerification;
    
    // Supply chain specific mappings
    mapping(string => address[]) public batchParticipantsList;
    mapping(string => mapping(address => SupplyChainParticipant)) public batchParticipants;
    
    // Token contract
    IMediToken public mediToken;
    
    // Constants
    uint256 public constant CUSTOMER_REWARD = 1 ether; // 1 MEDI for customers
    uint256 public constant VERIFICATION_COOLDOWN = 24 hours;
    
    // Events
    event BatchRegistered(
        string indexed batchId,
        address indexed manufacturer,
        bytes32 indexed channelId,
        uint256 timestamp,
        uint256 participantCount
    );
    
    event SupplyChainVerification(
        string indexed batchId,
        address indexed verifier,
        SupplyChainRole role,
        uint256 timestamp,
        string location
    );
    
    event CustomerRewardClaimed(
        string indexed batchId,
        address indexed customer,
        uint256 reward,
        uint256 timestamp
    );
    
    event ChannelOpened(bytes32 indexed channelId, address[] participants);
    event ChannelClosed(bytes32 indexed channelId, uint256 timestamp);
    event BatchSettled(string indexed batchId, bytes32 channelId);

    constructor(address _mediToken) {
        mediToken = IMediToken(_mediToken);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MANUFACTURER_ROLE, msg.sender);
        _grantRole(CHANNEL_ROLE, msg.sender);
    }

    /**
     * @dev Check if address is a channel participant
     */
    function isChannelParticipant(bytes32 _channelId, address _participant) 
        public 
        view 
        returns (bool) 
    {
        address[] memory participants = channels[_channelId].participants;
        for (uint i = 0; i < participants.length; i++) {
            if (participants[i] == _participant) {
                return true;
            }
        }
        return false;
    }

    /**
     * @dev Register a new medicine batch with supply chain participants
     */
    function registerBatchWithSupplyChain(
        string memory _batchId,
        string memory _drugName,
        string memory _ingredients,
        uint256 _expiryDate,
        address[] memory _participants,
        SupplyChainRole[] memory _roles,
        bytes32 _channelId
    ) internal {
        require(!batches[_batchId].exists, "Batch already exists");
        require(_expiryDate > block.timestamp, "Expiry date must be in future");
        require(_participants.length == _roles.length, "Participants and roles mismatch");
        require(_participants.length > 0, "At least one participant required");
        
        MedicineBatch storage newBatch = batches[_batchId];
        newBatch.manufacturer = msg.sender;
        newBatch.batchId = _batchId;
        newBatch.drugName = _drugName;
        newBatch.ingredients = _ingredients;
        newBatch.expiryDate = _expiryDate;
        newBatch.registeredAt = block.timestamp;
        newBatch.channelId = _channelId;
        newBatch.totalParticipants = _participants.length;
        newBatch.verifiedCount = 0;
        newBatch.rewardClaimed = false;
        newBatch.exists = true;
        
        // Add supply chain participants
        batchParticipantsList[_batchId] = _participants;
        for (uint256 i = 0; i < _participants.length; i++) {
            require(_participants[i] != address(0), "Invalid participant address");
            require(!newBatch.isParticipant[_participants[i]], "Duplicate participant");
            
            SupplyChainParticipant memory participant;
            participant.participantAddress = _participants[i];
            participant.role = _roles[i];
            participant.hasVerified = false;
            participant.verifiedAt = 0;
            
            newBatch.supplyChainParticipants.push(participant);
            newBatch.isParticipant[_participants[i]] = true;
            batchParticipants[_batchId][_participants[i]] = participant;
        }
        
        emit BatchRegistered(
            _batchId,
            msg.sender,
            _channelId,
            block.timestamp,
            _participants.length
        );
    }

    /**
     * @dev Settle state channel and register batches
     */
    function settleChannel(
        bytes32 _channelId,
        bytes memory _finalState,
        bytes memory _signature
    ) external nonReentrant {
        StateChannel storage channel = channels[_channelId];
        require(channel.isOpen, "Channel not open");

        // Decode the final state
        BatchData[] memory batchDataArray = abi.decode(_finalState, (BatchData[]));

        // Verify signatures
        bytes32 stateHash = keccak256(_finalState);
        bytes32 ethSignedHash = MessageHashUtils.toEthSignedMessageHash(stateHash);
        address signer = ethSignedHash.recover(_signature);
        require(isChannelParticipant(_channelId, signer), "Invalid signer");
        require(hasRole(MANUFACTURER_ROLE, signer), "Signer not a manufacturer");

        // Register all batches from the channel
        for (uint256 i = 0; i < batchDataArray.length; i++) {
            BatchData memory data = batchDataArray[i];

            if (!batches[data.batchId].exists) {
                registerBatchWithSupplyChain(
                    data.batchId,
                    data.drugName,
                    data.ingredients,
                    data.expiryDate,
                    data.supplyChainAddresses,
                    data.supplyChainRoles,
                    _channelId
                );

                emit BatchSettled(data.batchId, _channelId);
            }
        }

        // Close the channel
        channel.isOpen = false;
        channel.closedAt = block.timestamp;
        channel.nonce++;

        emit ChannelClosed(_channelId, block.timestamp);
    }

    /**
     * @dev Supply chain participant verifies batch receipt with signature
     */
    function verifySupplyChainTransfer(
        string memory _batchId,
        string memory _location,
        string memory _additionalData,
        bytes memory _signature
    ) external {
        MedicineBatch storage batch = batches[_batchId];
        require(batch.exists, "Batch not found");
        require(batch.isParticipant[msg.sender], "Not authorized participant");
        require(!batch.rewardClaimed, "Batch already completed");
        
        // Verify signature
        bytes32 messageHash = keccak256(abi.encodePacked(_batchId, msg.sender, _location, _additionalData));
        bytes32 ethSignedHash = MessageHashUtils.toEthSignedMessageHash(messageHash);
        require(ethSignedHash.recover(_signature) == msg.sender, "Invalid signature");
        
        // Find and update participant
        for (uint256 i = 0; i < batch.supplyChainParticipants.length; i++) {
            if (batch.supplyChainParticipants[i].participantAddress == msg.sender) {
                require(!batch.supplyChainParticipants[i].hasVerified, "Already verified");
                
                batch.supplyChainParticipants[i].hasVerified = true;
                batch.supplyChainParticipants[i].verifiedAt = block.timestamp;
                batch.supplyChainParticipants[i].location = _location;
                batch.supplyChainParticipants[i].additionalData = _additionalData;
                
                batch.verifiedCount++;
                
                // Update mapping
                batchParticipants[_batchId][msg.sender].hasVerified = true;
                batchParticipants[_batchId][msg.sender].verifiedAt = block.timestamp;
                batchParticipants[_batchId][msg.sender].location = _location;
                batchParticipants[_batchId][msg.sender].additionalData = _additionalData;
                
                emit SupplyChainVerification(
                    _batchId,
                    msg.sender,
                    batch.supplyChainParticipants[i].role,
                    block.timestamp,
                    _location
                );
                
                break;
            }
        }
    }

    /**
     * @dev Customer claims reward after all supply chain verifications
     */
    function claimCustomerReward(string memory _batchId) external nonReentrant {
        MedicineBatch storage batch = batches[_batchId];
        require(batch.exists, "Batch not found");
        require(!batch.rewardClaimed, "Reward already claimed");
        require(batch.verifiedCount == batch.totalParticipants, "Supply chain verification incomplete");
        require(!batch.isParticipant[msg.sender], "Supply chain participants cannot claim rewards");
        
        // Mark reward as claimed
        batch.rewardClaimed = true;
        batch.rewardClaimedBy = msg.sender;
        batch.rewardClaimedAt = block.timestamp;
        
        // Mint reward tokens to customer
        mediToken.mint(msg.sender, CUSTOMER_REWARD);
        
        emit CustomerRewardClaimed(
            _batchId,
            msg.sender,
            CUSTOMER_REWARD,
            block.timestamp
        );
    }

    /**
     * @dev Check if batch is ready for customer claim
     */
    function isBatchReadyForCustomer(string memory _batchId) external view returns (bool) {
        MedicineBatch storage batch = batches[_batchId];
        return batch.exists && 
               !batch.rewardClaimed && 
               batch.verifiedCount == batch.totalParticipants;
    }

    /**
     * @dev Get batch supply chain status
     */
    function getBatchSupplyChainStatus(string memory _batchId) 
        external 
        view 
        returns (
            uint256 totalParticipants,
            uint256 verifiedCount,
            bool rewardClaimed,
            address rewardClaimedBy
        ) 
    {
        MedicineBatch storage batch = batches[_batchId];
        require(batch.exists, "Batch not found");
        
        return (
            batch.totalParticipants,
            batch.verifiedCount,
            batch.rewardClaimed,
            batch.rewardClaimedBy
        );
    }

    /**
     * @dev Get supply chain participant details
     */
    function getParticipantDetails(string memory _batchId, address _participant)
        external
        view
        returns (
            SupplyChainRole role,
            bool hasVerified,
            uint256 verifiedAt,
            string memory location,
            string memory additionalData
        )
    {
        require(batches[_batchId].exists, "Batch not found");
        SupplyChainParticipant memory participant = batchParticipants[_batchId][_participant];
        
        return (
            participant.role,
            participant.hasVerified,
            participant.verifiedAt,
            participant.location,
            participant.additionalData
        );
    }

    /**
     * @dev Get all participants for a batch
     */
    function getBatchParticipants(string memory _batchId) 
        external 
        view 
        returns (address[] memory) 
    {
        require(batches[_batchId].exists, "Batch not found");
        return batchParticipantsList[_batchId];
    }

    /**
     * @dev Check if address is a participant for a batch
     */
    function isParticipant(string memory _batchId, address _address) 
        external 
        view 
        returns (bool) 
    {
        return batches[_batchId].isParticipant[_address];
    }

    /**
     * @dev Get batch details
     */
    function getBatch(string memory _batchId) 
        external 
        view 
        returns (
            address manufacturer,
            string memory drugName,
            string memory ingredients,
            uint256 expiryDate,
            uint256 registeredAt,
            bool rewardClaimed
        ) 
    {
        MedicineBatch storage batch = batches[_batchId];
        require(batch.exists, "Batch not found");
        
        return (
            batch.manufacturer,
            batch.drugName,
            batch.ingredients,
            batch.expiryDate,
            batch.registeredAt,
            batch.rewardClaimed
        );
    }

    /**
     * @dev Open a new state channel
     */
    function openChannel(bytes32 _channelId, address[] memory _participants) 
        external 
        onlyRole(CHANNEL_ROLE) 
    {
        require(!channels[_channelId].isOpen, "Channel already open");
        
        channels[_channelId] = StateChannel({
            id: _channelId,
            participants: _participants,
            nonce: 0,
            isOpen: true,
            openedAt: block.timestamp,
            closedAt: 0
        });
        
        emit ChannelOpened(_channelId, _participants);
    }

    /**
     * @dev Close a state channel
     */
    function closeChannel(bytes32 _channelId) 
        external 
        onlyRole(CHANNEL_ROLE) 
    {
        require(channels[_channelId].isOpen, "Channel not open");
        
        channels[_channelId].isOpen = false;
        channels[_channelId].closedAt = block.timestamp;
        
        emit ChannelClosed(_channelId, block.timestamp);
    }


}